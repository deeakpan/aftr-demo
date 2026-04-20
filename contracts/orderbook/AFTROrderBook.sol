// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OrderBookLinkedList} from "../libraries/OrderBookLinkedList.sol";
import {OrderPriceVolumeSet} from "../libraries/OrderPriceVolumeSet.sol";

interface IAFTROrderBookFactory {
    function isMarket(address market) external view returns (bool);
    function isOutcomeTokenForMarket(address market, address token) external view returns (bool);
}

interface IAFTRMarketCollateral {
    function collateralAddress() external view returns (address);
    function collateralDecimals() external view returns (uint8);
}

/// @title AFTROrderBook
/// @notice On-chain CLOB for trading any outcome token registered on AFTRParimutuelMarketFactory.
/// @dev No minting — only transfers existing tokens between users.
///      Matching crosses price levels (CLOB-style): incoming sell hits bids at >= limit;
///      incoming buy hits asks at <= limit. Per-fill fees apply to buyer and seller (same bps).
///      Collateral is resolved per-market and supports both ERC20 and native ETH.
contract AFTROrderBook is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using OrderBookLinkedList for OrderBookLinkedList.LinkedList;
    using OrderPriceVolumeSet for OrderPriceVolumeSet.OPVset;

    IAFTROrderBookFactory public immutable marketFactory;
    /// @notice Receives all accumulated fees via `withdrawFees` (immutable; set at deploy).
    address public immutable treasury;

    /// @notice Fee in basis points ( / 10_000 ) applied to **each side** on matched notional.
    uint16 public feeRate;
    mapping(address => uint256) public accumulatedFeeErc20;
    uint256 public accumulatedFeeNative;

    // Order book: market => token => price => orders
    mapping(address => mapping(address => mapping(uint256 => OrderBookLinkedList.LinkedList)))
        public sellOrderBook;
    mapping(address => mapping(address => mapping(uint256 => OrderBookLinkedList.LinkedList)))
        public buyOrderBook;

    // User orders: market => token => user => [orders]
    mapping(address => mapping(address => OrderPriceVolumeSet.OPVset)) private _sellOrders;
    mapping(address => mapping(address => OrderPriceVolumeSet.OPVset)) private _buyOrders;

    // Active prices — unsorted sets, sorted in memory at match time.
    mapping(address => mapping(address => uint256[])) private _sellPrices;
    mapping(address => mapping(address => uint256[])) private _buyPrices;
    mapping(address => mapping(address => mapping(uint256 => bool))) private _activePrices;

    // Events
    event OrderPlaced(
        address indexed market,
        address indexed token,
        address indexed user,
        uint256 price,
        uint256 amount,
        bytes32 orderId,
        bool isBuy
    );

    event OrderMatched(
        address indexed market,
        address indexed token,
        address indexed maker,
        address taker,
        uint256 price,
        uint256 amount
    );

    event OrderCancelled(
        address indexed market,
        address indexed token,
        address indexed user,
        uint256 price,
        bytes32 orderId
    );

    event FeesWithdrawn(address indexed collateral, address indexed recipient, uint256 amount);

    error ZeroAddress();
    error OnlyTreasury();

    constructor(
        address _marketFactory,
        address _owner,
        address _treasury
    ) Ownable(_owner) {
        if (_marketFactory == address(0) || _owner == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        marketFactory = IAFTROrderBookFactory(_marketFactory);
        treasury = _treasury;
        feeRate = 50; // 0.5% per side (basis points / 10_000)
    }

    /// @notice Set per-side fee in basis points. Owner only.
    function setFeeRate(uint16 _feeRate) external onlyOwner {
        require(_feeRate <= 1000, "Fee too high");
        feeRate = _feeRate;
    }

    // ─── Escrow helpers ───────────────────────────────────────────────────────

    /// @notice Max collateral escrow required to buy `tokenAmount` tokens at `limitPrice`.
    /// @param tokenDec Decimals of the outcome token being purchased.
    function _escrowForBuy(uint256 tokenAmount, uint256 limitPrice, uint8 tokenDec) internal view returns (uint256) {
        uint256 maxNotional = (tokenAmount * limitPrice) / (10 ** uint256(tokenDec));
        return maxNotional + (maxNotional * feeRate) / 10000;
    }

    /// @notice Collateral escrow the buyer pays for `matchTok` tokens at `price`.
    function _buyerEscrowForTokens(
        uint256 matchTok,
        uint256 price,
        uint16 _feeRate,
        uint8 tokenDec
    ) internal pure returns (uint256) {
        uint256 n = (matchTok * price) / (10 ** uint256(tokenDec));
        return n + (n * _feeRate) / 10000;
    }

    /// @notice Largest `matchTok` in [0, cap] such that `_buyerEscrowForTokens <= escrowLimit`.
    /// @dev Binary search — avoids stacked floor-division undercount.
    function _maxMatchTokUnderEscrow(
        uint256 escrowLimit,
        uint256 price,
        uint256 cap,
        uint16 _feeRate,
        uint8 tokenDec
    ) internal pure returns (uint256) {
        if (cap == 0 || escrowLimit == 0 || price == 0) return 0;
        uint256 hi = cap;
        unchecked {
            uint256 mulCap = type(uint256).max / price;
            if (hi > mulCap) hi = mulCap;
        }
        uint256 lo = 0;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_buyerEscrowForTokens(mid, price, _feeRate, tokenDec) <= escrowLimit) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    // ─── Collateral helpers ───────────────────────────────────────────────────

    function _marketCollateral(address market) internal view returns (address collateral, uint8 colDec) {
        IAFTRMarketCollateral m = IAFTRMarketCollateral(market);
        collateral = m.collateralAddress();
        colDec = m.collateralDecimals();
    }

    function _pullCollateral(address collateral, address from, uint256 amount) internal {
        if (collateral == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
            if (msg.value > amount) {
                Address.sendValue(payable(from), msg.value - amount);
            }
        } else {
            require(msg.value == 0, "No ETH for ERC20 market");
            IERC20(collateral).safeTransferFrom(from, address(this), amount);
        }
    }

    function _sendCollateral(address collateral, address to, uint256 amount) internal {
        if (collateral == address(0)) {
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(collateral).safeTransfer(to, amount);
        }
    }

    // ─── Order placement ──────────────────────────────────────────────────────

    /// @notice Place a sell order.
    function placeSellOrder(
        address market,
        address token,
        uint256 price,
        uint256 amount
    ) external returns (bytes32 orderId) {
        require(marketFactory.isMarket(market), "Invalid market");
        require(marketFactory.isOutcomeTokenForMarket(market, token), "Invalid token for market");
        require(price > 0, "Price must be > 0");
        require(amount > 0, "Amount must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint8 tokenDec = IERC20Metadata(token).decimals();
        uint256 remainingAmount = _matchSellOrder(market, token, price, amount, tokenDec);

        if (remainingAmount > 0) {
            if (sellOrderBook[market][token][price].length == 0) {
                orderId = sellOrderBook[market][token][price].initHead(msg.sender, remainingAmount);
                _addSellPrice(market, token, price);
            } else {
                orderId = sellOrderBook[market][token][price].addNode(msg.sender, remainingAmount);
            }

            _sellOrders[market][token]._add(msg.sender, orderId, price, remainingAmount);
            emit OrderPlaced(market, token, msg.sender, price, remainingAmount, orderId, false);
        }
    }

    /// @notice Place a buy order. Send ETH for native-collateral markets; approve ERC20 otherwise.
    function placeBuyOrder(
        address market,
        address token,
        uint256 price,
        uint256 amount
    ) external payable returns (bytes32 orderId) {
        require(marketFactory.isMarket(market), "Invalid market");
        require(marketFactory.isOutcomeTokenForMarket(market, token), "Invalid token for market");
        require(price > 0, "Price must be > 0");
        require(amount > 0, "Amount must be > 0");

        (address collateral, ) = _marketCollateral(market);
        uint8 tokenDec = IERC20Metadata(token).decimals();
        uint256 escrowTotal = _escrowForBuy(amount, price, tokenDec);

        _pullCollateral(collateral, msg.sender, escrowTotal);

        (uint256 remainingTokens, uint256 escrowLeft) = _matchBuyOrder(
            market, token, price, amount, escrowTotal, collateral, tokenDec
        );

        // Refund price-improvement surplus.
        uint256 escrowNeeded = remainingTokens > 0 ? _escrowForBuy(remainingTokens, price, tokenDec) : 0;
        if (escrowLeft > escrowNeeded) {
            _sendCollateral(collateral, msg.sender, escrowLeft - escrowNeeded);
            escrowLeft = escrowNeeded;
        }

        if (remainingTokens > 0) {
            if (buyOrderBook[market][token][price].length == 0) {
                orderId = buyOrderBook[market][token][price].initHead(msg.sender, escrowLeft);
                _addBuyPrice(market, token, price);
            } else {
                orderId = buyOrderBook[market][token][price].addNode(msg.sender, escrowLeft);
            }

            _buyOrders[market][token]._add(msg.sender, orderId, price, escrowLeft);
            emit OrderPlaced(market, token, msg.sender, price, remainingTokens, orderId, true);
        }
    }

    // ─── Order cancellation ───────────────────────────────────────────────────

    /// @notice Cancel a sell order; returns escrowed outcome tokens.
    function cancelSellOrder(
        address market,
        address token,
        uint256 price,
        bytes32 orderId
    ) external {
        OrderBookLinkedList.Order memory o = sellOrderBook[market][token][price]
            .nodes[orderId]
            .order;
        require(msg.sender == o.seller, "Not order owner");

        IERC20(token).safeTransfer(msg.sender, o.amount);

        sellOrderBook[market][token][price].deleteNode(orderId);
        _sellOrders[market][token]._remove(msg.sender, orderId);
        _removePrice(market, token, price, true);

        emit OrderCancelled(market, token, msg.sender, price, orderId);
    }

    /// @notice Cancel a buy order; returns escrowed collateral.
    function cancelBuyOrder(
        address market,
        address token,
        uint256 price,
        bytes32 orderId
    ) external {
        OrderBookLinkedList.Order memory o = buyOrderBook[market][token][price]
            .nodes[orderId]
            .order;
        require(msg.sender == o.seller, "Not order owner");

        (address collateral, ) = _marketCollateral(market);
        _sendCollateral(collateral, msg.sender, o.amount);

        buyOrderBook[market][token][price].deleteNode(orderId);
        _buyOrders[market][token]._remove(msg.sender, orderId);
        _removePrice(market, token, price, false);

        emit OrderCancelled(market, token, msg.sender, price, orderId);
    }

    // ─── Matching ─────────────────────────────────────────────────────────────

    /// @notice Match incoming sell against resting bids at >= sellLimitPrice (FIFO per level).
    function _matchSellOrder(
        address market,
        address token,
        uint256 sellLimitPrice,
        uint256 sellAmount,
        uint8 tokenDec
    ) internal returns (uint256 remainingAmount) {
        remainingAmount = sellAmount;
        (address collateral, ) = _marketCollateral(market);
        IERC20 tokenContract = IERC20(token);
        uint256[] memory bids = _loadSortedDesc(_buyPrices[market][token]);

        for (uint256 idx = 0; idx < bids.length && remainingAmount > 0; idx++) {
            uint256 bidPrice = bids[idx];
            if (bidPrice < sellLimitPrice) break;

            while (buyOrderBook[market][token][bidPrice].length > 0 && remainingAmount > 0) {
                bytes32 head_ = buyOrderBook[market][token][bidPrice].head;
                uint256 buyEscrow = buyOrderBook[market][token][bidPrice].nodes[head_].order.amount;
                OrderBookLinkedList.Order memory buyOrder = buyOrderBook[market][token][bidPrice]
                    .nodes[head_]
                    .order;

                uint256 matchTok = _maxMatchTokUnderEscrow(buyEscrow, bidPrice, remainingAmount, feeRate, tokenDec);
                if (matchTok == 0) return remainingAmount;

                uint256 n = (matchTok * bidPrice) / (10 ** uint256(tokenDec));
                uint256 buyerFee = (n * feeRate) / 10000;
                uint256 sellerFee = (n * feeRate) / 10000;

                uint256 escrowDec = n + buyerFee;
                if (collateral == address(0)) {
                    accumulatedFeeNative += buyerFee + sellerFee;
                } else {
                    accumulatedFeeErc20[collateral] += buyerFee + sellerFee;
                }

                if (escrowDec >= buyEscrow) {
                    buyOrderBook[market][token][bidPrice].popHead();
                    _buyOrders[market][token]._remove(buyOrder.seller, head_);
                    _removePrice(market, token, bidPrice, false);
                } else {
                    buyOrderBook[market][token][bidPrice].nodes[head_].order.amount = buyEscrow - escrowDec;
                    _buyOrders[market][token]._subVolume(buyOrder.seller, head_, escrowDec);
                }

                tokenContract.safeTransfer(buyOrder.seller, matchTok);
                _sendCollateral(collateral, msg.sender, n - sellerFee);

                emit OrderMatched(market, token, buyOrder.seller, msg.sender, bidPrice, matchTok);

                remainingAmount -= matchTok;
            }
        }
    }

    /// @notice Match incoming buy against resting asks at <= buyLimitPrice (FIFO per level).
    function _matchBuyOrder(
        address market,
        address token,
        uint256 buyLimitPrice,
        uint256 buyTokenAmount,
        uint256 buyerEscrowIn,
        address collateral,
        uint8 tokenDec
    ) internal returns (uint256 remainingTokens, uint256 escrowOut) {
        remainingTokens = buyTokenAmount;
        escrowOut = buyerEscrowIn;
        IERC20 tokenContract = IERC20(token);
        uint256[] memory asks = _loadSortedAsc(_sellPrices[market][token]);

        for (uint256 idx = 0; idx < asks.length && remainingTokens > 0 && escrowOut > 0; idx++) {
            uint256 askPrice = asks[idx];
            if (askPrice > buyLimitPrice) break;

            while (sellOrderBook[market][token][askPrice].length > 0 && remainingTokens > 0 && escrowOut > 0) {
                bytes32 head_ = sellOrderBook[market][token][askPrice].head;
                uint256 sellTokAvail = sellOrderBook[market][token][askPrice].nodes[head_].order.amount;
                OrderBookLinkedList.Order memory sellOrder = sellOrderBook[market][token][askPrice]
                    .nodes[head_]
                    .order;

                uint256 cap = remainingTokens < sellTokAvail ? remainingTokens : sellTokAvail;
                uint256 matchTok = _maxMatchTokUnderEscrow(escrowOut, askPrice, cap, feeRate, tokenDec);
                if (matchTok == 0) return (remainingTokens, escrowOut);

                uint256 n = (matchTok * askPrice) / (10 ** uint256(tokenDec));
                uint256 buyerFee = (n * feeRate) / 10000;
                uint256 sellerFee = (n * feeRate) / 10000;

                uint256 escrowDec = n + buyerFee;
                if (collateral == address(0)) {
                    accumulatedFeeNative += buyerFee + sellerFee;
                } else {
                    accumulatedFeeErc20[collateral] += buyerFee + sellerFee;
                }
                escrowOut -= escrowDec;

                if (matchTok == sellTokAvail) {
                    sellOrderBook[market][token][askPrice].popHead();
                    _sellOrders[market][token]._remove(sellOrder.seller, head_);
                    _removePrice(market, token, askPrice, true);
                } else {
                    sellOrderBook[market][token][askPrice].nodes[head_].order.amount = sellTokAvail - matchTok;
                    _sellOrders[market][token]._subVolume(sellOrder.seller, head_, matchTok);
                }

                tokenContract.safeTransfer(msg.sender, matchTok);
                _sendCollateral(collateral, sellOrder.seller, n - sellerFee);

                emit OrderMatched(market, token, sellOrder.seller, msg.sender, askPrice, matchTok);

                remainingTokens -= matchTok;
            }
        }
    }

    // ─── Price set management ─────────────────────────────────────────────────

    function _addSellPrice(address market, address token, uint256 price) internal {
        if (!_activePrices[market][token][price]) {
            _activePrices[market][token][price] = true;
            _sellPrices[market][token].push(price);
        }
    }

    function _addBuyPrice(address market, address token, uint256 price) internal {
        if (!_activePrices[market][token][price]) {
            _activePrices[market][token][price] = true;
            _buyPrices[market][token].push(price);
        }
    }

    function _removePrice(address market, address token, uint256 price, bool isSell) internal {
        if (sellOrderBook[market][token][price].length == 0 &&
            buyOrderBook[market][token][price].length == 0) {
            _activePrices[market][token][price] = false;
            if (isSell) {
                _removeFromArray(_sellPrices[market][token], price);
            } else {
                _removeFromArray(_buyPrices[market][token], price);
            }
        }
    }

    /// @dev Swap-pop removal — O(n) SLOADs, 1 SSTORE, no shifting.
    function _removeFromArray(uint256[] storage arr, uint256 price) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == price) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
    }

    /// @dev Copy storage array to memory and insertion-sort descending. No SSTOREs.
    function _loadSortedDesc(uint256[] storage src) internal view returns (uint256[] memory arr) {
        arr = new uint256[](src.length);
        for (uint256 i = 0; i < src.length; i++) arr[i] = src[i];
        for (uint256 i = 1; i < arr.length; i++) {
            uint256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] < key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }

    /// @dev Copy storage array to memory and insertion-sort ascending. No SSTOREs.
    function _loadSortedAsc(uint256[] storage src) internal view returns (uint256[] memory arr) {
        arr = new uint256[](src.length);
        for (uint256 i = 0; i < src.length; i++) arr[i] = src[i];
        for (uint256 i = 1; i < arr.length; i++) {
            uint256 key = arr[i];
            uint256 j = i;
            while (j > 0 && arr[j - 1] > key) {
                arr[j] = arr[j - 1];
                j--;
            }
            arr[j] = key;
        }
    }

    // ─── Fee withdrawal ───────────────────────────────────────────────────────

    /// @notice Pull accumulated fees to `treasury`. Callable **only** by `treasury`.
    /// @param collateralAsset ERC20 address, or address(0) for native ETH.
    function withdrawFees(address collateralAsset) external nonReentrant {
        if (msg.sender != treasury) revert OnlyTreasury();
        uint256 fee;
        if (collateralAsset == address(0)) {
            fee = accumulatedFeeNative;
            accumulatedFeeNative = 0;
            if (fee > 0) Address.sendValue(payable(treasury), fee);
        } else {
            fee = accumulatedFeeErc20[collateralAsset];
            accumulatedFeeErc20[collateralAsset] = 0;
            if (fee > 0) IERC20(collateralAsset).safeTransfer(treasury, fee);
        }
        emit FeesWithdrawn(collateralAsset, treasury, fee);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /// @notice Best bid price (highest active bid).
    function getBestBid(address market, address token) external view returns (uint256 best) {
        uint256[] storage prices = _buyPrices[market][token];
        for (uint256 i = 0; i < prices.length; i++) {
            if (buyOrderBook[market][token][prices[i]].length > 0 && prices[i] > best) {
                best = prices[i];
            }
        }
    }

    /// @notice Best ask price (lowest active ask).
    function getBestAsk(address market, address token) external view returns (uint256 best) {
        uint256[] storage prices = _sellPrices[market][token];
        for (uint256 i = 0; i < prices.length; i++) {
            if (sellOrderBook[market][token][prices[i]].length > 0 && (best == 0 || prices[i] < best)) {
                best = prices[i];
            }
        }
    }

    /// @notice All open sell orders for a user on a given market/token pair.
    function getUserSellOrders(address market, address token, address user)
        external
        view
        returns (OrderPriceVolumeSet.OPVnode[] memory)
    {
        return _sellOrders[market][token]._orders[user];
    }

    /// @notice All open buy orders for a user on a given market/token pair.
    function getUserBuyOrders(address market, address token, address user)
        external
        view
        returns (OrderPriceVolumeSet.OPVnode[] memory)
    {
        return _buyOrders[market][token]._orders[user];
    }

    /// @notice Snapshot of the order book — all active price levels with aggregated volume.
    function getOrderBookSnapshot(address market, address token)
        external
        view
        returns (
            uint256[] memory bidPrices,
            uint256[] memory bidVolumes,
            uint256[] memory askPrices,
            uint256[] memory askVolumes
        )
    {
        uint256[] storage bps = _buyPrices[market][token];
        uint256[] storage aps = _sellPrices[market][token];

        bidPrices  = new uint256[](bps.length);
        bidVolumes = new uint256[](bps.length);
        askPrices  = new uint256[](aps.length);
        askVolumes = new uint256[](aps.length);

        for (uint256 i = 0; i < bps.length; i++) {
            bidPrices[i] = bps[i];
            bytes32 curr = buyOrderBook[market][token][bps[i]].head;
            while (curr != bytes32(0)) {
                bidVolumes[i] += buyOrderBook[market][token][bps[i]].nodes[curr].order.amount;
                curr = buyOrderBook[market][token][bps[i]].nodes[curr].next;
            }
        }

        for (uint256 i = 0; i < aps.length; i++) {
            askPrices[i] = aps[i];
            bytes32 curr = sellOrderBook[market][token][aps[i]].head;
            while (curr != bytes32(0)) {
                askVolumes[i] += sellOrderBook[market][token][aps[i]].nodes[curr].order.amount;
                curr = sellOrderBook[market][token][aps[i]].nodes[curr].next;
            }
        }
    }

    receive() external payable {}
}
