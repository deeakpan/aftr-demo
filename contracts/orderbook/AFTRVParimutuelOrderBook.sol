// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import {OrderBookLinkedList} from "../libraries/OrderBookLinkedList.sol";
import {OrderPriceVolumeSet} from "../libraries/OrderPriceVolumeSet.sol";

interface IAFTRBookFactory {
    function isMarket(address market) external view returns (bool);
    function isOutcomeTokenForMarket(address market, address token) external view returns (bool);
}

interface IAFTRMarketCollateral {
    function collateralAddress() external view returns (address);
    function collateralDecimals() external view returns (uint8);
}

/// @title AFTRVParimutuelOrderBook
/// @notice Secondary trading for any outcome token registered on AFTRParimutuelMarketFactory (replaces bound/break-only books).
/// @dev Collateral is read per market (ERC20 or native ETH). Price × amount uses outcome token decimals.
contract AFTRVParimutuelOrderBook is Ownable {
    using SafeERC20 for IERC20;
    using OrderBookLinkedList for OrderBookLinkedList.LinkedList;
    using OrderPriceVolumeSet for OrderPriceVolumeSet.OPVset;

    IAFTRBookFactory public immutable marketFactory;

    uint16 public feeRate;
    mapping(address => uint256) public accumulatedFeeErc20;
    uint256 public accumulatedFeeNative;

    mapping(address => mapping(address => mapping(uint256 => OrderBookLinkedList.LinkedList))) public sellOrderBook;
    mapping(address => mapping(address => mapping(uint256 => OrderBookLinkedList.LinkedList))) public buyOrderBook;

    mapping(address => mapping(address => OrderPriceVolumeSet.OPVset)) private _sellOrders;
    mapping(address => mapping(address => OrderPriceVolumeSet.OPVset)) private _buyOrders;

    mapping(address => mapping(address => uint256[])) private _sellPrices;
    mapping(address => mapping(address => uint256[])) private _buyPrices;
    mapping(address => mapping(address => mapping(uint256 => bool))) private _activePrices;

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

    constructor(address _marketFactory, address _owner) Ownable(_owner) {
        marketFactory = IAFTRBookFactory(_marketFactory);
        feeRate = 50;
    }

    function setFeeRate(uint16 _feeRate) external onlyOwner {
        require(_feeRate <= 1000, "Fee too high");
        feeRate = _feeRate;
    }

    function placeSellOrder(address market, address token, uint256 price, uint256 amount) external returns (bytes32 orderId) {
        _validate(market, token);
        require(price > 0 && amount > 0, "Args");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 remainingAmount = _matchSellOrder(market, token, price, amount);

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

    function placeBuyOrder(address market, address token, uint256 price, uint256 amount) external payable returns (bytes32 orderId) {
        _validate(market, token);
        require(price > 0 && amount > 0, "Args");

        (address collateral, uint8 td) = _marketAndTokenDecimals(market, token);
        uint256 quote = _quote(amount, price, td);
        uint256 fee = (quote * feeRate) / 10000;
        uint256 need = quote + fee;

        if (collateral == address(0)) {
            require(msg.value >= need, "ETH");
            if (msg.value > need) {
                Address.sendValue(payable(msg.sender), msg.value - need);
            }
            accumulatedFeeNative += fee;
        } else {
            require(msg.value == 0, "No ETH");
            IERC20(collateral).safeTransferFrom(msg.sender, address(this), need);
            accumulatedFeeErc20[collateral] += fee;
        }

        uint256 remainingAmount = _matchBuyOrder(market, token, price, amount, collateral);

        if (remainingAmount > 0) {
            uint256 remQuote = _quote(remainingAmount, price, td);
            if (buyOrderBook[market][token][price].length == 0) {
                orderId = buyOrderBook[market][token][price].initHead(msg.sender, remQuote);
                _addBuyPrice(market, token, price);
            } else {
                orderId = buyOrderBook[market][token][price].addNode(msg.sender, remQuote);
            }
            _buyOrders[market][token]._add(msg.sender, orderId, price, remQuote);
            emit OrderPlaced(market, token, msg.sender, price, remainingAmount, orderId, true);
        }
    }

    function cancelSellOrder(address market, address token, uint256 price, bytes32 orderId) external {
        OrderBookLinkedList.Order memory o = sellOrderBook[market][token][price].nodes[orderId].order;
        require(msg.sender == o.seller, "Not owner");

        IERC20(token).safeTransfer(msg.sender, o.amount);
        sellOrderBook[market][token][price].deleteNode(orderId);
        _sellOrders[market][token]._remove(msg.sender, orderId);
        _removePrice(market, token, price, true);
        emit OrderCancelled(market, token, msg.sender, price, orderId);
    }

    function cancelBuyOrder(address market, address token, uint256 price, bytes32 orderId) external {
        OrderBookLinkedList.Order memory o = buyOrderBook[market][token][price].nodes[orderId].order;
        require(msg.sender == o.seller, "Not owner");

        (address collateral, ) = _marketCollateral(market);
        if (collateral == address(0)) {
            Address.sendValue(payable(msg.sender), o.amount);
        } else {
            IERC20(collateral).safeTransfer(msg.sender, o.amount);
        }

        buyOrderBook[market][token][price].deleteNode(orderId);
        _buyOrders[market][token]._remove(msg.sender, orderId);
        _removePrice(market, token, price, false);
        emit OrderCancelled(market, token, msg.sender, price, orderId);
    }

    function collectFees(address collateralAsset) external onlyOwner {
        if (collateralAsset == address(0)) {
            uint256 f = accumulatedFeeNative;
            accumulatedFeeNative = 0;
            Address.sendValue(payable(owner()), f);
        } else {
            uint256 f = accumulatedFeeErc20[collateralAsset];
            accumulatedFeeErc20[collateralAsset] = 0;
            IERC20(collateralAsset).safeTransfer(owner(), f);
        }
    }

    function getBestBid(address market, address token) external view returns (uint256) {
        uint256[] storage prices = _buyPrices[market][token];
        if (prices.length == 0) return 0;
        for (uint256 i = 0; i < prices.length; i++) {
            if (buyOrderBook[market][token][prices[i]].length > 0) return prices[i];
        }
        return 0;
    }

    function getBestAsk(address market, address token) external view returns (uint256) {
        uint256[] storage prices = _sellPrices[market][token];
        if (prices.length == 0) return 0;
        for (uint256 i = 0; i < prices.length; i++) {
            if (sellOrderBook[market][token][prices[i]].length > 0) return prices[i];
        }
        return 0;
    }

    function _validate(address market, address token) internal view {
        require(marketFactory.isMarket(market), "Market");
        require(marketFactory.isOutcomeTokenForMarket(market, token), "Outcome");
    }

    function _marketCollateral(address market) internal view returns (address, uint8) {
        IAFTRMarketCollateral m = IAFTRMarketCollateral(market);
        return (m.collateralAddress(), m.collateralDecimals());
    }

    function _marketAndTokenDecimals(address market, address token) internal view returns (address collateral, uint8 tokenDec) {
        (collateral, ) = _marketCollateral(market);
        tokenDec = IERC20Metadata(token).decimals();
    }

    function _quote(uint256 amount, uint256 price, uint8 tokenDecimals) internal pure returns (uint256) {
        return (amount * price) / (10 ** uint256(tokenDecimals));
    }

    function _matchSellOrder(address market, address token, uint256 price, uint256 sellAmount)
        internal
        returns (uint256 remainingAmount)
    {
        remainingAmount = sellAmount;
        (address collateral, uint8 td) = _marketAndTokenDecimals(market, token);
        IERC20 tokenContract = IERC20(token);

        for (uint256 i = 0; i < buyOrderBook[market][token][price].length && remainingAmount > 0; ) {
            bytes32 head_ = buyOrderBook[market][token][price].head;
            uint256 buyCollateral = buyOrderBook[market][token][price].nodes[head_].order.amount;
            uint256 buyAmount = (buyCollateral * (10 ** uint256(td))) / price;

            OrderBookLinkedList.Order memory buyOrder = buyOrderBook[market][token][price].nodes[head_].order;

            if (remainingAmount >= buyAmount) {
                buyOrderBook[market][token][price].popHead();
                _buyOrders[market][token]._remove(buyOrder.seller, head_);
                _removePrice(market, token, price, false);

                tokenContract.safeTransfer(buyOrder.seller, buyAmount);
                _payCollateral(collateral, msg.sender, buyCollateral);

                emit OrderMatched(market, token, buyOrder.seller, msg.sender, price, buyAmount);
                remainingAmount -= buyAmount;
            } else {
                uint256 matchedCollateral = _quote(remainingAmount, price, td);
                buyOrderBook[market][token][price].nodes[head_].order.amount -= matchedCollateral;
                _buyOrders[market][token]._subVolume(buyOrder.seller, head_, matchedCollateral);

                tokenContract.safeTransfer(buyOrder.seller, remainingAmount);
                _payCollateral(collateral, msg.sender, matchedCollateral);

                emit OrderMatched(market, token, buyOrder.seller, msg.sender, price, remainingAmount);
                remainingAmount = 0;
            }
        }
    }

    function _matchBuyOrder(address market, address token, uint256 price, uint256 buyAmount, address collateral)
        internal
        returns (uint256 remainingAmount)
    {
        remainingAmount = buyAmount;
        (, uint8 td) = _marketAndTokenDecimals(market, token);
        IERC20 tokenContract = IERC20(token);

        for (uint256 i = 0; i < sellOrderBook[market][token][price].length && remainingAmount > 0; ) {
            bytes32 head_ = sellOrderBook[market][token][price].head;
            uint256 sellAmt = sellOrderBook[market][token][price].nodes[head_].order.amount;

            OrderBookLinkedList.Order memory sellOrder = sellOrderBook[market][token][price].nodes[head_].order;

            if (remainingAmount >= sellAmt) {
                uint256 matchedCollateral = _quote(sellAmt, price, td);

                sellOrderBook[market][token][price].popHead();
                _sellOrders[market][token]._remove(sellOrder.seller, head_);
                _removePrice(market, token, price, true);

                tokenContract.safeTransfer(msg.sender, sellAmt);
                _payCollateral(collateral, sellOrder.seller, matchedCollateral);

                emit OrderMatched(market, token, sellOrder.seller, msg.sender, price, sellAmt);
                remainingAmount -= sellAmt;
            } else {
                uint256 matchedCollateral = _quote(remainingAmount, price, td);

                sellOrderBook[market][token][price].nodes[head_].order.amount -= remainingAmount;
                _sellOrders[market][token]._subVolume(sellOrder.seller, head_, remainingAmount);

                tokenContract.safeTransfer(msg.sender, remainingAmount);
                _payCollateral(collateral, sellOrder.seller, matchedCollateral);

                emit OrderMatched(market, token, sellOrder.seller, msg.sender, price, remainingAmount);
                remainingAmount = 0;
            }
        }
    }

    function _payCollateral(address collateral, address to, uint256 amount) internal {
        if (collateral == address(0)) {
            Address.sendValue(payable(to), amount);
        } else {
            IERC20(collateral).safeTransfer(to, amount);
        }
    }

    function _addSellPrice(address market, address token, uint256 price) internal {
        if (!_activePrices[market][token][price]) {
            _activePrices[market][token][price] = true;
            _insertSorted(_sellPrices[market][token], price, true);
        }
    }

    function _addBuyPrice(address market, address token, uint256 price) internal {
        if (!_activePrices[market][token][price]) {
            _activePrices[market][token][price] = true;
            _insertSorted(_buyPrices[market][token], price, false);
        }
    }

    function _removePrice(address market, address token, uint256 price, bool isSell) internal {
        if (sellOrderBook[market][token][price].length == 0 && buyOrderBook[market][token][price].length == 0) {
            _activePrices[market][token][price] = false;
            if (isSell) {
                _removeFromArray(_sellPrices[market][token], price);
            } else {
                _removeFromArray(_buyPrices[market][token], price);
            }
        }
    }

    function _insertSorted(uint256[] storage arr, uint256 price, bool ascending) internal {
        uint256 i = 0;
        while (i < arr.length && (ascending ? arr[i] < price : arr[i] > price)) {
            i++;
        }
        arr.push(0);
        for (uint256 j = arr.length - 1; j > i; j--) {
            arr[j] = arr[j - 1];
        }
        arr[i] = price;
    }

    function _removeFromArray(uint256[] storage arr, uint256 price) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == price) {
                arr[i] = arr[arr.length - 1];
                arr.pop();
                return;
            }
        }
    }

    receive() external payable {}
}
