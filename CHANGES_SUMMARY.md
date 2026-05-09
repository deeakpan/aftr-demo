# Market Creation & Fee Logic Changes

## Summary

This update implements the following changes:

1. **Anyone can create markets** — removed `onlyCreator` modifier from factory
2. **Creator tracking** — `MarketCreated` event now includes `creator` address
3. **New fee model** — changed from 3% loser-pool fee to **1.5% per-trade fee**:
   - **0.3%** goes to market creator
   - **1.2%** goes to protocol fee recipient
4. **Trade event timestamp** — `Deposited` event now includes `timestamp` field
5. **Subgraph updates** — schema and mappings updated to store `creator` and `lastTradeTimestamp`

---

## Contract Changes

### 1. `AFTRVParimutuelMarket.sol`

**Fee Constants (lines 25-30):**
```solidity
// OLD:
uint256 public constant LOSER_FEE_TOTAL_BPS = 300;  // 3% from losers
uint256 public constant BOOTSTRAP_FEE_BPS = 50;     // 0.5% to bootstrap funder

// NEW:
uint256 public constant TRADE_FEE_TOTAL_BPS = 150;  // 1.5% per trade
uint256 public constant CREATOR_FEE_BPS = 30;       // 0.3% to creator
uint256 public constant PROTOCOL_FEE_BPS = 120;     // 1.2% to protocol
```

**New Immutable (line 56):**
```solidity
address public immutable creator;  // Market creator, receives 0.3% of each trade
```

**Constructor — added `creator_` parameter (line 172):**
```solidity
constructor(
    // ... existing params ...
    address creator_,  // NEW
    // ... rest of params ...
)
```

**Deposited Event — added `timestamp` (line 113):**
```solidity
event Deposited(
    address indexed buyer,
    address indexed recipient,
    uint8 indexed outcomeIndex,
    uint256 collateralAmount,
    uint256 sharesMinted,
    uint256 price1e18,
    uint256 timestamp  // NEW
);
```

**deposit() function — fee deduction logic (lines 335-345):**
```solidity
// Deduct 1.5% trade fee: 0.3% to creator, 1.2% to protocol fee recipient.
uint256 creatorFee = (amount * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
uint256 protocolFee = (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
uint256 netAmount = amount - creatorFee - protocolFee;

if (creatorFee > 0) _sendCollateral(creator, creatorFee);
if (protocolFee > 0) _sendCollateral(feeRecipient, protocolFee);

// ... then mint shares based on netAmount ...

emit Deposited(msg.sender, recipient, outcomeIndex, amount, shares, p, block.timestamp);
```

**_finalizeSettlement() — simplified (lines 565-590):**
```solidity
// OLD: Deducted 3% from losers, split between bootstrap funder and protocol
// NEW: All loser collateral goes to winners (fees already collected per-trade)

uint256 distributable = 0;
for (uint256 j = 0; j < uint256(numOutcomes); j++) {
    if (j != winIdx) {
        distributable += realPool[j];
    }
}

if (winSupply > 0) {
    redemptionRate = ((winReal + distributable) * 1e18) / winSupply;
} else {
    // No winners: send residue to protocol
    redemptionRate = 0;
    uint256 residue = winReal + distributable;
    if (residue > 0) {
        _sendCollateral(feeRecipient, residue);
    }
}

emit MarketSettled(winIdx, distributable);  // Removed feeFromLosers param
```

---

### 2. `AFTRParimutuelMarketFactory.sol`

**MarketCreated Event — added `creator` (line 28):**
```solidity
event MarketCreated(
    address indexed market,
    AFTRVParimutuelMarket.MarketKind indexed kind,
    address indexed collateralToken,
    address[] outcomeTokens,
    string[] outcomeLabels,
    uint256 stakeEndTimestamp,
    uint256 resolveAfterTimestamp,
    bytes32 metadataHash,
    address creator  // NEW
);
```

**Public Market Creation (lines 161-166):**
```solidity
// OLD: external onlyCreator
// NEW: external (anyone can create)

function createPriceMarket(PriceMarketParams calldata p) external returns (address market) {
    market = _createPriceMarket(p, msg.sender);  // Pass msg.sender as creator
}

function createEventMarket(EventMarketParams calldata p) external returns (address market) {
    market = _createEventMarket(p, msg.sender);  // Pass msg.sender as creator
}
```

**Internal Functions — added `creator` parameter:**
```solidity
function _createPriceMarket(PriceMarketParams calldata p, address creator) internal { ... }
function _createEventMarket(EventMarketParams calldata p, address creator) internal { ... }
function _register(..., address creator) internal { ... }
```

**Deployer Calls — pass `creator` (lines 207, 264):**
```solidity
AFTRParimutuelDeployer(marketDeployer).deployPriceMarket(
    owner(),
    feeRecipient,
    creator,  // NEW
    // ... rest of params ...
);

AFTRParimutuelDeployer(marketDeployer).deployEventMarket(
    owner(),
    feeRecipient,
    creator,  // NEW
    // ... rest of params ...
);
```

---

### 3. `AFTRParimutuelDeployer.sol`

**Function Signatures — added `creator_` parameter:**
```solidity
function deployPriceMarket(
    address owner_,
    address feeRecipient_,
    address creator_,  // NEW
    // ... rest of params ...
) external onlyFactory returns (address market, address[] memory tokens) {
    // ...
    AFTRVParimutuelMarket mkt = new AFTRVParimutuelMarket(
        factory,
        owner_,
        feeRecipient_,
        creator_,  // NEW — pass to market constructor
        // ... rest of params ...
    );
}

function deployEventMarket(
    address owner_,
    address feeRecipient_,
    address creator_,  // NEW
    // ... rest of params ...
) external onlyFactory returns (address market, address[] memory tokens) {
    // ...
    AFTRVParimutuelMarket mkt = new AFTRVParimutuelMarket(
        factory,
        owner_,
        feeRecipient_,
        creator_,  // NEW — pass to market constructor
        // ... rest of params ...
    );
}
```

---

## Subgraph Changes

### 1. `schema.graphql`

**Market Entity — added `creator`:**
```graphql
type Market @entity(immutable: false) {
  id: ID!
  kind: Int!
  collateralToken: String!
  stakeEndTimestamp: BigInt!
  resolveAfterTimestamp: BigInt!
  metadataHash: String!
  creator: String!  # NEW
  createdAt: BigInt!
  createdAtBlock: BigInt!
  positions: [TraderMarketPosition!]! @derivedFrom(field: "market")
}
```

**TraderMarketPosition Entity — added `lastTradeTimestamp`:**
```graphql
type TraderMarketPosition @entity(immutable: false) {
  id: ID!
  market: Market!
  trader: Trader!
  collateralIn: BigInt!
  collateralOut: BigInt!
  sharesIn: BigInt!
  sharesOut: BigInt!
  lastTradeTimestamp: BigInt!  # NEW
}
```

---

### 2. `abis/Factory.json`

**MarketCreated Event — added `creator` field:**
```json
{
  "indexed": false,
  "internalType": "address",
  "name": "creator",
  "type": "address"
}
```

---

### 3. `abis/Market.json`

**Deposited Event — added `timestamp` field:**
```json
{
  "indexed": false,
  "internalType": "uint256",
  "name": "timestamp",
  "type": "uint256"
}
```

---

### 4. `src/factory.ts`

**handleMarketCreated — capture creator:**
```typescript
export function handleMarketCreated(event: MarketCreated): void {
  const marketAddr = event.params.market;
  const id = addrId(marketAddr);

  const m = new MarketEntity(id);
  m.kind = event.params.kind;
  m.collateralToken = addrId(event.params.collateralToken);
  m.stakeEndTimestamp = event.params.stakeEndTimestamp;
  m.resolveAfterTimestamp = event.params.resolveAfterTimestamp;
  m.metadataHash = event.params.metadataHash.toHexString();
  m.creator = addrId(event.params.creator);  // NEW
  m.createdAt = event.block.timestamp;
  m.createdAtBlock = event.block.number;
  m.save();
}
```

---

### 5. `src/market.ts`

**handleDeposited — capture timestamp:**
```typescript
export function handleDeposited(event: Deposited): void {
  const timestamp = event.params.timestamp;  // NEW
  // ...
  const pos = loadOrCreatePosition(marketAddr, recipient);
  pos.collateralIn = pos.collateralIn.plus(amount);
  pos.sharesIn = pos.sharesIn.plus(shares);
  pos.lastTradeTimestamp = timestamp;  // NEW
  pos.save();
}
```

**handleTokensRedeemed — capture block timestamp:**
```typescript
export function handleTokensRedeemed(event: TokensRedeemed): void {
  // ...
  const pos = loadOrCreatePosition(marketAddr, user);
  pos.collateralOut = pos.collateralOut.plus(payout);
  pos.sharesOut = pos.sharesOut.plus(shares);
  pos.lastTradeTimestamp = event.block.timestamp;  // NEW
  pos.save();
}
```

---

### 6. `src/router.ts`

**All handlers — capture block timestamp:**
```typescript
// In handleRouterDeposited, handleRouterRedeemed, handleRouterRedeemedAndRepaid:
pos.lastTradeTimestamp = event.block.timestamp;  // NEW
```

---

### 7. `subgraph.yaml`

**MarketCreated event signature — added `address` for creator:**
```yaml
- event: MarketCreated(indexed address,indexed uint8,indexed address,address[],string[],uint256,uint256,bytes32,address)
```

---

## Migration Notes

### For Existing Deployments:

1. **Redeploy all contracts** — the constructor signature changed for `AFTRVParimutuelMarket`
2. **Update factory** — `AFTRParimutuelMarketFactory` and `AFTRParimutuelDeployer` must be redeployed together
3. **Redeploy subgraph** — schema changes require a fresh deployment
4. **Update frontend** — any UI displaying fees should show "1.5% per trade (0.3% to creator, 1.2% to protocol)"

### Breaking Changes:

- **Market constructor** now requires `creator_` parameter (position 4)
- **Deployer functions** now require `creator_` parameter (position 3)
- **MarketCreated event** has an additional `creator` field
- **Deposited event** has an additional `timestamp` field
- **MarketSettled event** removed `feeFromLosers` parameter (now only emits `distributableToWinners`)

---

## Testing Checklist

- [ ] Deploy factory, deployer, and create a test market
- [ ] Verify anyone can call `createPriceMarket` / `createEventMarket`
- [ ] Deposit collateral and verify 1.5% fee split (0.3% creator, 1.2% protocol)
- [ ] Check `Deposited` event includes `timestamp`
- [ ] Check `MarketCreated` event includes `creator`
- [ ] Settle market and verify winners receive 100% of loser pools (no additional fee)
- [ ] Verify subgraph indexes `creator` and `lastTradeTimestamp` correctly
- [ ] Test bootstrap liquidity (should be fee-exempt)

---

## Fee Comparison

| Scenario | Old Model | New Model |
|----------|-----------|-----------|
| **User deposits 100 USDC** | 100 USDC → pool | 98.5 USDC → pool<br>0.3 USDC → creator<br>1.2 USDC → protocol |
| **Market settles (200 USDC losers)** | 6 USDC fee (3%)<br>1 USDC → bootstrap funder<br>5 USDC → protocol<br>194 USDC → winners | 0 USDC fee<br>200 USDC → winners<br>(fees already collected) |
| **Total protocol revenue** | 5 USDC (2.5% of losers) | 1.2 USDC per 100 USDC traded |
| **Creator revenue** | 0 USDC | 0.3 USDC per 100 USDC traded |

**Key Difference:** Fees are now collected **per-trade** instead of **at settlement from losers only**.

---

## Questions?

Contact the dev team or review the updated contracts in:
- `contracts/core/AFTRVParimutuelMarket.sol`
- `contracts/factory/AFTRParimutuelMarketFactory.sol`
- `contracts/factory/AFTRParimutuelDeployer.sol`
- `subgraph/schema.graphql`
- `subgraph/src/*.ts`
