/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toBytes,
} = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { defineChain } = require("viem");

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

const ROOT = path.join(__dirname, "..", "..");
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "monadTestnet-10143.json");
const WALLETS_PATH = path.join(ROOT, "wallets.json");
const LAST_MARKET_PATH = path.join(ROOT, "scripts", "last-price-market.json");
const LIGHTHOUSE_ADD_URL = "https://upload.lighthouse.storage/api/v0/add";

const CHAINLINK_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

const FACTORY_ABI = parseAbi([
  "function createPriceMarket((address collateralToken,uint8 collateralDecimals,uint256 virtualReserve,uint256 stakeEndTimestamp,uint256 resolveAfterTimestamp,bytes32 metadataHash,string[] outcomeLabels,string metadataURI,bytes32 priceAssetKey,uint256 priceThreshold,uint8 priceKind,uint256 priceUpperBound,uint256 maxPriceStaleness,uint256[] priceBinLower,uint256[] priceBinUpper,uint256 minBootstrapTotal,uint256 bootstrapAmount,address shareRecipient) p) payable returns (address market)",
  "function priceFeeds(bytes32 assetKey) view returns (address)",
  "function setPriceFeed(bytes32 assetKey, address feed)",
  "event MarketCreated(address indexed market, uint8 indexed kind, address indexed collateralToken, address[] outcomeTokens, string[] outcomeLabels, uint256 stakeEndTimestamp, uint256 resolveAfterTimestamp, bytes32 metadataHash, address creator)",
]);

const MARKET_ABI = parseAbi([
  "function bootstrapLiquidity(uint256 totalAmount, address shareRecipient)",
  "function bootstrapped() view returns (bool)",
  "function priceOf(uint8 outcomeIndex) view returns (uint256)",
]);

const ROUTER_ABI = parseAbi([
  "function depositForSelf(address market, uint8 outcomeIndex, uint256 amount, uint256 minSharesOut)",
]);

const WAD = 10n ** 18n;

function normalizePrivateKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.startsWith("0x") ? s : `0x${s}`;
}

function readDeployment() {
  const j = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
  return j;
}

function getRpcUrl() {
  return process.env.RPC_URL || "https://testnet-rpc.monad.xyz/";
}

function makeClients(privateKey) {
  const pk = normalizePrivateKey(privateKey);
  if (!pk) throw new Error("Missing private key");
  const account = privateKeyToAccount(pk);
  const transport = http(getRpcUrl());
  const publicClient = createPublicClient({ chain: monadTestnet, transport });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport });
  return { account, publicClient, walletClient };
}

function getFunderClients() {
  const pk = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  return makeClients(pk);
}

function formatResolveUtcLabel(resolveMs) {
  const d = new Date(resolveMs);
  if (Number.isNaN(d.getTime())) return "the specified resolve time (UTC)";
  const readableUtc = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return `${readableUtc} UTC`;
}

function buildPriceTitle({ asset, comparison, thresholdDisplay, resolveMs }) {
  const dir = comparison === "ABOVE" ? "above" : "below";
  const t = thresholdDisplay ? `$${thresholdDisplay}` : "the selected threshold";
  return `Will ${asset} settle ${dir} ${t} at ${formatResolveUtcLabel(resolveMs)}?`;
}

async function fetchBtcSpot(publicClient, feedAddress) {
  const [round, decimals] = await Promise.all([
    publicClient.readContract({
      address: feedAddress,
      abi: CHAINLINK_ABI,
      functionName: "latestRoundData",
    }),
    publicClient.readContract({
      address: feedAddress,
      abi: CHAINLINK_ABI,
      functionName: "decimals",
    }),
  ]);
  const answer = Number(formatUnits(round[1], decimals));
  if (!Number.isFinite(answer) || answer <= 0) {
    throw new Error("Invalid BTC feed price");
  }
  return { spot: answer, decimals };
}

async function uploadToLighthouseOnce(buffer, filename, contentType, apiKey) {
  const payload = new FormData();
  payload.append("file", new Blob([buffer], { type: contentType }), filename);

  const res = await fetch(LIGHTHOUSE_ADD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: payload,
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  if (!res.ok) {
    throw new Error(`Lighthouse upload failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  const cid = data?.Hash;
  if (!cid) throw new Error("Lighthouse returned no CID");
  return `ipfs://${cid}`;
}

async function uploadToLighthouse(buffer, filename, contentType) {
  const apiKey = process.env.LIGHTHOUSE_API_KEY?.trim();
  if (!apiKey) throw new Error("Set LIGHTHOUSE_API_KEY in .env");
  try {
    return await uploadToLighthouseOnce(buffer, filename, contentType, apiKey);
  } catch (first) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await uploadToLighthouseOnce(buffer, filename, contentType, apiKey);
    } catch {
      throw first;
    }
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUsdcAmount(min = 20, max = 47) {
  return String(randomInt(min, max));
}

function estimateMinSharesOut(amountUnits, price, slippageBps = 500) {
  const creatorFeeEst = (amountUnits * 30n) / 10000n;
  const protocolFeeEst = (amountUnits * 120n) / 10000n;
  const netAmountEst = amountUnits - creatorFeeEst - protocolFeeEst;
  const estSharesNet = (netAmountEst * WAD) / price;
  const slip = BigInt(Math.min(5000, Math.max(1, slippageBps)));
  return (estSharesNet * (10000n - slip)) / 10000n;
}

async function ensureErc20Allowance(publicClient, walletClient, token, ownerAddress, spender, amount) {
  const account = walletClient.account;
  if (!account) throw new Error("walletClient missing account");
  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [ownerAddress, spender],
  });
  if (allowance >= amount) return null;
  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    account,
    chain: monadTestnet,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

function parseMarketCreatedAddress(receipt, factoryAddress) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factoryAddress.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({
        abi: FACTORY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (parsed.eventName === "MarketCreated") {
        return parsed.args.market;
      }
    } catch {
      // skip
    }
  }
  return null;
}

function loadWalletsFile() {
  if (!fs.existsSync(WALLETS_PATH)) {
    throw new Error(`Missing ${WALLETS_PATH} — run npm run wallets:generate first`);
  }
  return JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8"));
}

function saveWalletsFile(data) {
  fs.writeFileSync(WALLETS_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function loadLastMarket() {
  if (!fs.existsSync(LAST_MARKET_PATH)) {
    throw new Error(`Missing ${LAST_MARKET_PATH} — run npm run market:create-btc first`);
  }
  return JSON.parse(fs.readFileSync(LAST_MARKET_PATH, "utf8"));
}

function saveLastMarket(data) {
  fs.writeFileSync(LAST_MARKET_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

module.exports = {
  ROOT,
  DEPLOYMENT_PATH,
  WALLETS_PATH,
  LAST_MARKET_PATH,
  CHAINLINK_ABI,
  ERC20_ABI,
  FACTORY_ABI,
  MARKET_ABI,
  ROUTER_ABI,
  WAD,
  monadTestnet,
  normalizePrivateKey,
  readDeployment,
  getRpcUrl,
  makeClients,
  getFunderClients,
  formatResolveUtcLabel,
  buildPriceTitle,
  fetchBtcSpot,
  uploadToLighthouse,
  randomInt,
  randomUsdcAmount,
  estimateMinSharesOut,
  ensureErc20Allowance,
  parseMarketCreatedAddress,
  loadWalletsFile,
  saveWalletsFile,
  loadLastMarket,
  saveLastMarket,
  generatePrivateKey,
  parseUnits,
  parseAbi,
  keccak256,
  toBytes,
  formatUnits,
};
