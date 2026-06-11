/* eslint-disable no-console */
/**
 * Poll CoinGecko BTC/USD and update MockChainlinkFeed via setAnswer().
 * Runs once immediately on start, then every 3 minutes.
 *
 * Usage:
 *   npm run mock-feed:sync
 *   node scripts/sync-mock-btc-feed.cjs
 *   node scripts/sync-mock-btc-feed.cjs --once
 *
 * Env:
 *   PRIVATE_KEY, RPC_URL
 *   MOCK_BTC_FEED_ADDRESS — override deployments JSON
 *   PRICE_SYNC_INTERVAL_MS — default 180000 (3 min)
 *   COINGECKO_API_KEY — optional (Demo/Pro API key header)
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const COINGECKO_BTC_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

const FEED_ABI = [
  "function setAnswer(int256 answer_) external",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;
const DEPLOYMENT_FILE = path.join(__dirname, "..", "deployments", "monadTestnet-10143.json");

function req(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var ${name}`);
  return v.trim();
}

function readFeedAddress() {
  const override = process.env.MOCK_BTC_FEED_ADDRESS?.trim();
  if (override) return override;

  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error(`Deployment file not found: ${DEPLOYMENT_FILE}`);
  }
  const dep = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  const address = dep.contracts?.MockBtcUsdFeed;
  if (!address) throw new Error("MockBtcUsdFeed missing in deployment file");
  return address;
}

async function fetchBtcUsdFromCoinGecko() {
  const headers = { Accept: "application/json" };
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  if (apiKey) {
    headers["x-cg-demo-api-key"] = apiKey;
    headers["x-cg-pro-api-key"] = apiKey;
  }

  const res = await fetch(COINGECKO_BTC_URL, { cache: "no-store", headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CoinGecko HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const json = await res.json();
  const usd = Number(json?.bitcoin?.usd);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error("Invalid BTC/USD from CoinGecko");
  }
  return usd;
}

function usdToFeedAnswer(usd, decimals) {
  return BigInt(Math.round(usd * 10 ** decimals));
}

function formatAnswer(answer, decimals) {
  const whole = answer / 10n ** BigInt(decimals);
  const frac = answer % 10n ** BigInt(decimals);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

async function createClients() {
  const { ethers } = require("ethers");
  const rpcUrl = process.env.RPC_URL?.trim() || "https://testnet-rpc.monad.xyz/";
  const pk = req("PRIVATE_KEY");
  const privateKey = pk.startsWith("0x") ? pk : `0x${pk}`;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const feedAddress = readFeedAddress();
  const feed = new ethers.Contract(feedAddress, FEED_ABI, wallet);

  return { ethers, feed, feedAddress, wallet };
}

async function syncOnce({ ethers, feed, feedAddress, wallet }) {
  const [usd, decimals, round] = await Promise.all([
    fetchBtcUsdFromCoinGecko(),
    feed.decimals(),
    feed.latestRoundData(),
  ]);

  const nextAnswer = usdToFeedAnswer(usd, Number(decimals));
  const currentAnswer = round.answer;

  const ts = new Date().toISOString();
  if (currentAnswer === nextAnswer) {
    console.log(
      `[${ts}] BTC $${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })} — unchanged (${formatAnswer(currentAnswer, Number(decimals))}), skip tx`,
    );
    return;
  }

  console.log(
    `[${ts}] BTC $${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })} → setAnswer(${formatAnswer(nextAnswer, Number(decimals))})`,
  );
  console.log(`  feed ${feedAddress} signer ${wallet.address}`);

  const tx = await feed.setAnswer(nextAnswer);
  console.log(`  tx ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  confirmed block ${receipt.blockNumber} (round ${Number(round.roundId) + 1})`);
}

async function runLoop(once) {
  const clients = await createClients();
  const intervalMs = Number(process.env.PRICE_SYNC_INTERVAL_MS?.trim() || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs < 10_000) {
    throw new Error("PRICE_SYNC_INTERVAL_MS must be >= 10000");
  }

  let running = false;

  async function tick() {
    if (running) {
      console.warn(`[${new Date().toISOString()}] Previous sync still running, skipping tick`);
      return;
    }
    running = true;
    try {
      await syncOnce(clients);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Sync failed:`, err.shortMessage ?? err.message ?? err);
    } finally {
      running = false;
    }
  }

  await tick();

  if (once) return;

  console.log(`Polling CoinGecko every ${Math.round(intervalMs / 1000)}s (Ctrl+C to stop)`);
  const timer = setInterval(tick, intervalMs);

  const shutdown = () => {
    clearInterval(timer);
    console.log("\nStopped mock feed sync");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const once = process.argv.includes("--once");

runLoop(once).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
