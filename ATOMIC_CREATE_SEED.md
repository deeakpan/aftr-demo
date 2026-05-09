# Atomic Market Creation + Bootstrap Seeding

## Summary

Market creation now **requires** bootstrap liquidity in a single atomic transaction. This prevents markets from being created without initial liquidity.

### Key Changes:

1. **Factory pulls bootstrap collateral** from `msg.sender` during market creation
2. **Factory seeds the market** immediately after deployment via `bootstrapLiquidity()`
3. **No separate bootstrap step** — markets are always seeded at creation
4. **New params** — `bootstrapAmount` and `shareRecipient` added to `PriceMarketParams` and `EventMarketParams`

---

## Contract Changes

### `AFTRParimutuelMarketFactory.sol`

**New Imports:**
```solidity
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AFTRParimutuelMarketFactory is Ownable2Step {
    using SafeERC20 for IERC20;
```

**New Error:**
```solidity
error InvalidBootstrap();
```

**Updated Structs — added `bootstrapAmount` and `shareRecipient`:**
```solidity
struct PriceMarketParams {
    // ... existing fields ...
    uint256 minBootstrapTotal;
    uint256 bootstrapAmount;      // NEW: must be >= minBootstrapTotal and divisible by numOutcomes
    address shareRecipient;       // NEW: recipient of bootstrap shares (typically msg.sender)
}

struct EventMarketParams {
    // ... existing fields ...
    uint256 minBootstrapTotal;
    uint256 bootstrapAmount;      // NEW
    address shareRecipient;       // NEW
}
```

**Public Functions — now `payable` for ETH markets:**
```solidity
function createPriceMarket(PriceMarketParams calldata p) external payable returns (address market) {
    market = _createPriceMarket(p, msg.sender);
}

function createEventMarket(EventMarketParams calldata p) external payable returns (address market) {
    market = _createEventMarket(p, msg.sender);
}
```

**Internal Flow — added `_seedMarket` call:**
```solidity
function _createPriceMarket(PriceMarketParams calldata p, address creator) internal returns (address) {
    // ... validation and deployment ...
    
    _wireMarket(market, tokens, p.metadataURI, new bytes(0), p.priceBinLower, p.priceBinUpper);
    _seedMarket(market, p.collateralToken, p.bootstrapAmount, p.shareRecipient, uint8(p.outcomeLabels.length));  // NEW
    _register(market, ...);
    return market;
}

function _createEventMarket(EventMarketParams calldata p, address creator) internal returns (address) {
    // ... validation and deployment ...
    
    _wireMarket(market, tokens, p.metadataURI, anc, _emptyBins(), _emptyBins());
    _seedMarket(market, p.collateralToken, p.bootstrapAmount, p.shareRecipient, uint8(p.outcomeLabels.length));  // NEW
    _register(market, ...);
    return market;
}
```

**New Helper — `_seedMarket`:**
```solidity
/// @notice Pull bootstrap collateral from msg.sender and seed the market atomically.
/// @dev For ERC20 markets the caller must have pre-approved this factory for `bootstrapAmount`.
///      For native ETH markets the caller must send exactly `bootstrapAmount` as msg.value.
function _seedMarket(
    address market,
    address collateralToken,
    uint256 bootstrapAmount,
    address shareRecipient,
    uint8 numOutcomes
) internal {
    if (bootstrapAmount == 0) revert InvalidBootstrap();
    if (shareRecipient == address(0)) revert InvalidBootstrap();
    if (bootstrapAmount % uint256(numOutcomes) != 0) revert InvalidBootstrap();

    if (collateralToken == address(0)) {
        // Native ETH: msg.value must equal bootstrapAmount.
        if (msg.value != bootstrapAmount) revert InvalidBootstrap();
        AFTRVParimutuelMarket(payable(market)).bootstrapLiquidity{value: bootstrapAmount}(
            bootstrapAmount,
            shareRecipient
        );
    } else {
        // ERC20: pull from caller, approve market, then call bootstrap.
        if (msg.value != 0) revert InvalidBootstrap();
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), bootstrapAmount);
        IERC20(collateralToken).forceApprove(market, bootstrapAmount);
        AFTRVParimutuelMarket(payable(market)).bootstrapLiquidity(bootstrapAmount, shareRecipient);
    }
}
```

---

### `AFTRParimutuelBatchFactory.sol`

**Updated for ERC20-only batch creation:**
```solidity
/// @notice Deploy multiple price markets, one per collateral token.
/// @dev Caller must pre-approve this contract for `templateParams.bootstrapAmount` per collateral token.
///      All markets share the same bootstrapAmount and shareRecipient from the template.
///      Only supports ERC20 collateral (not native ETH) due to per-market bootstrap amounts.
function createPriceMarketsBatch(
    AFTRParimutuelMarketFactory.PriceMarketParams calldata templateParams,
    address[] calldata collateralTokens
) external onlyOwner returns (address[] memory deployed) {
    deployed = new address[](collateralTokens.length);
    for (uint256 i = 0; i < collateralTokens.length; i++) {
        address token = collateralTokens[i];
        require(token != address(0), "ETH not supported in batch");

        AFTRParimutuelMarketFactory.PriceMarketParams memory p = _copyPrice(templateParams);
        p.collateralToken = token;
        p.collateralDecimals = templateParams.collateralDecimals;

        // Pull bootstrap collateral from caller and approve factory.
        IERC20(token).safeTransferFrom(msg.sender, address(this), p.bootstrapAmount);
        IERC20(token).forceApprove(address(coreFactory), p.bootstrapAmount);

        deployed[i] = coreFactory.createPriceMarket(p);
    }
}
```

**Updated Copy Helpers:**
```solidity
function _copyPrice(...) internal pure returns (...) {
    // ... existing fields ...
    q.minBootstrapTotal = p.minBootstrapTotal;
    q.bootstrapAmount = p.bootstrapAmount;      // NEW
    q.shareRecipient = p.shareRecipient;        // NEW
}

function _copyEvent(...) internal pure returns (...) {
    // ... existing fields ...
    q.minBootstrapTotal = p.minBootstrapTotal;
    q.bootstrapAmount = p.bootstrapAmount;      // NEW
    q.shareRecipient = p.shareRecipient;        // NEW
}
```

---

## Usage Examples

### Creating an ERC20 Market

```solidity
// 1. Approve factory for bootstrap amount
IERC20(usdcAddress).approve(factoryAddress, 1000e6); // 1000 USDC

// 2. Create market with bootstrap
AFTRParimutuelMarketFactory.PriceMarketParams memory params = AFTRParimutuelMarketFactory.PriceMarketParams({
    collateralToken: usdcAddress,
    collateralDecimals: 6,
    virtualReserve: 1000e6,
    stakeEndTimestamp: block.timestamp + 7 days,
    resolveAfterTimestamp: block.timestamp + 14 days,
    metadataHash: keccak256("market-metadata"),
    outcomeLabels: ["Yes", "No"],
    metadataURI: "ipfs://...",
    chainlinkFeed: btcUsdFeed,
    priceThreshold: 100000e6,  // $100k
    priceKind: AFTRVParimutuelMarket.PriceThresholdKind.ABOVE,
    priceUpperBound: 0,
    maxPriceStaleness: 1 hours,
    priceBinLower: new uint256[](0),
    priceBinUpper: new uint256[](0),
    minBootstrapTotal: 1000e6,
    bootstrapAmount: 1000e6,      // NEW: must match approval
    shareRecipient: msg.sender    // NEW: receive bootstrap shares
});

address market = factory.createPriceMarket(params);
// Market is now deployed AND seeded with 1000 USDC (500 per outcome)
```

### Creating a Native ETH Market

```solidity
AFTRParimutuelMarketFactory.PriceMarketParams memory params = AFTRParimutuelMarketFactory.PriceMarketParams({
    collateralToken: address(0),  // Native ETH
    collateralDecimals: 18,
    // ... other fields ...
    minBootstrapTotal: 1 ether,
    bootstrapAmount: 1 ether,
    shareRecipient: msg.sender
});

// Send ETH as msg.value
address market = factory.createPriceMarket{value: 1 ether}(params);
// Market is now deployed AND seeded with 1 ETH (0.5 per outcome)
```

---

## Migration Notes

### Breaking Changes:

1. **`createPriceMarket` and `createEventMarket` now require bootstrap params**
   - Old: `createPriceMarket(params)` — market created but not seeded
   - New: `createPriceMarket(params)` — market created AND seeded atomically
   - Must include `bootstrapAmount` and `shareRecipient` in params

2. **Functions are now `payable`**
   - Required for native ETH markets
   - ERC20 markets must send `msg.value == 0`

3. **Caller must approve factory for ERC20 bootstrap amount**
   - Factory pulls collateral from `msg.sender`
   - Factory approves market for the same amount
   - Market pulls from factory during `bootstrapLiquidity()`

4. **Batch factory only supports ERC20**
   - Native ETH batch creation removed (complex per-market amounts)
   - Caller must approve batch factory for `bootstrapAmount * numMarkets`

### For Existing Deployments:

- **Redeploy factory** — new `_seedMarket` logic and `payable` functions
- **Redeploy batch factory** — updated copy helpers and ERC20-only logic
- **Update frontend** — add `bootstrapAmount` and `shareRecipient` to market creation forms
- **Update scripts** — approve factory before calling `createPriceMarket` / `createEventMarket`

---

## Benefits

1. **No orphaned markets** — every market has initial liquidity
2. **Atomic operation** — create + seed cannot be separated
3. **Simpler UX** — one transaction instead of two
4. **Gas efficient** — single approval + single transaction
5. **Safer** — no window where market exists but is unseeded

---

## Testing Checklist

- [ ] Create ERC20 market with bootstrap (approve factory first)
- [ ] Create native ETH market with bootstrap (send msg.value)
- [ ] Verify `bootstrapAmount` must be divisible by `numOutcomes`
- [ ] Verify `bootstrapAmount` must be >= `minBootstrapTotal`
- [ ] Verify `shareRecipient` receives bootstrap shares
- [ ] Verify market is immediately tradeable after creation
- [ ] Test batch creation with multiple ERC20 collaterals
- [ ] Verify batch factory rejects native ETH markets
- [ ] Test revert cases (insufficient approval, wrong msg.value, etc.)

---

## Fee Flow Reminder

With the new per-trade fee model (1.5% per trade):
- **Bootstrap liquidity is fee-exempt** (fair seeding)
- **Subsequent deposits pay 1.5% fee** (0.3% creator, 1.2% protocol)
- **Settlement distributes 100% of loser pools** to winners (no additional fee)

---

## Questions?

Review the updated contracts:
- `contracts/factory/AFTRParimutuelMarketFactory.sol`
- `contracts/factory/AFTRParimutuelBatchFactory.sol`
