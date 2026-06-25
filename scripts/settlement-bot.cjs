/* eslint-disable no-console */
/**
 * settlement-bot.cjs
 *
 * Queries the subgraph for due PRICE/NAD markets (not a full factory scan).
 * Falls back to on-chain factory loop only if subgraph is unavailable.
 *   - PRICE  → settlePrice() (anyone with gas)
 *   - NAD_TOKEN → resolveNadToken() (nadResolutionAdmin only)
 * Event markets are skipped (need 3-of-10 admin signatures).
 *
 * Usage:
 *   npm run bot:settle
 *   npm run bot:settle -- --once
 *   npm run bot:settle -- --market 3 --dry-run
 *   npm run bot:settle -- --network monadTestnet --interval 60
 */
const fs = require("fs");
const path = require("path");

require("./lib/register-ts.cjs");

const { evaluateNadOutcome } = require("../lib/nad/evaluate-outcome.ts");
const { fetchNadResolutionSnapshots } = require("../lib/nad/resolution-snapshot.ts");
const { parseNadMarketFromMetadata } = require("../lib/nad/parse-config.ts");
const { fetchIpfsMetadataNoCache } = require("../lib/ipfs-metadata.ts");
const { fetchSettlementCandidates, getSubgraphUrl } = require("./lib/subgraph-settlement.cjs");

const MARKET_KIND_PRICE = 0;
const MARKET_KIND_EVENT = 1;
const MARKET_KIND_NAD_TOKEN = 2;
const MARKET_STATE_OPEN = 0;

function parseArgs() {
  const args = process.argv.slice(2);
  let network;
  let marketId;
  let intervalSec = 60;
  let once = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[++i];
    } else if (arg === "--market") {
      marketId = Number(args[++i]);
    } else if (arg === "--interval") {
      intervalSec = Number(args[++i]);
    } else if (arg === "--once") {
      once = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { network, marketId, intervalSec, once, dryRun };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Deployment file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.MondaloreParimutuelMarketFactory;
  if (!factoryAddress || !hre.ethers.isAddress(factoryAddress)) {
    throw new Error("MondaloreParimutuelMarketFactory missing in deployment file.");
  }
  return { factoryAddress, nadResolutionAdmin: parsed.nadResolutionAdmin, file };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kindLabel(kind) {
  if (kind === MARKET_KIND_PRICE) return "PRICE";
  if (kind === MARKET_KIND_NAD_TOKEN) return "NAD_TOKEN";
  return "EVENT";
}

async function loadResolvableMarketsFromFactory(factory, hre, filterMarketId) {
  const total = Number(await factory.marketsLength());
  const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
  const rows = [];

  for (let id = 0; id < total; id += 1) {
    if (filterMarketId != null && id !== filterMarketId) continue;

    const marketAddress = await factory.markets(BigInt(id));
    const row = await buildMarketRow(hre, id, marketAddress, now);
    if (row) rows.push(row);
  }

  return rows;
}

async function buildMarketRow(hre, id, marketAddress, now) {
  const market = await hre.ethers.getContractAt("MondaloreVParimutuelMarket", marketAddress);
  const [kind, state, resolveAfter, metadataURI] = await Promise.all([
    market.marketKind(),
    market.state(),
    market.resolveAfterTimestamp(),
    market.metadataURI(),
  ]);

  const kindNum = Number(kind);
  if (kindNum === MARKET_KIND_EVENT) return null;
  if (kindNum !== MARKET_KIND_PRICE && kindNum !== MARKET_KIND_NAD_TOKEN) return null;
  if (Number(state) !== MARKET_STATE_OPEN) return null;
  if (Number(resolveAfter) > now) return null;

  return {
    id,
    kind: kindNum,
    address: marketAddress,
    market,
    resolveAfter: Number(resolveAfter),
    metadataURI: String(metadataURI),
  };
}

async function loadResolvableMarkets(factory, hre, filterMarketId) {
  const now = Number((await hre.ethers.provider.getBlock("latest")).timestamp);

  if (filterMarketId != null) {
    const marketAddress = await factory.markets(BigInt(filterMarketId));
    const row = await buildMarketRow(hre, filterMarketId, marketAddress, now);
    return row ? [row] : [];
  }

  try {
    const { source, rows: candidates } = await fetchSettlementCandidates(now);
    if (candidates.length === 0) {
      console.log(`  candidates: 0 (${source} @ ${getSubgraphUrl()})`);
      return [];
    }

    console.log(`  candidates: ${candidates.length} from ${source}`);
    const verified = [];
    for (const c of candidates) {
      const row = await buildMarketRow(hre, null, c.address, now);
      if (row) {
        if (c.metadataURI && !row.metadataURI) row.metadataURI = c.metadataURI;
        verified.push(row);
      }
    }
    return verified;
  } catch (err) {
    console.warn(
      `  subgraph unavailable (${err instanceof Error ? err.message : err}) — falling back to factory scan`,
    );
    return loadResolvableMarketsFromFactory(factory, hre, filterMarketId);
  }
}

async function settlePriceMarket(ctx, row) {
  const { signer, dryRun } = ctx;
  console.log(`\n── Market ${row.id != null ? `#${row.id} ` : ""}${row.address} (PRICE) ──`);

  if (dryRun) {
    console.log("  [dry-run] would call settlePrice()");
    return { resolved: false, dryRun: true };
  }

  const tx = await row.market.connect(signer).settlePrice();
  console.log(`  tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  mined block ${receipt.blockNumber}`);
  return { resolved: true, txHash: tx.hash };
}

async function settleNadMarket(ctx, row) {
  const { signer, dryRun, nadAdmin } = ctx;
  console.log(`\n── Market ${row.id != null ? `#${row.id} ` : ""}${row.address} (NAD_TOKEN) ──`);

  if (nadAdmin.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not nadResolutionAdmin (${nadAdmin}). Use the admin key for NAD markets.`,
    );
  }

  const metadataURI = (row.metadataURI || "").trim();
  if (!metadataURI) {
    throw new Error("metadataURI is empty on-chain — cannot resolve NAD market");
  }

  console.log(`  metadata: ${metadataURI}`);
  const md = await fetchIpfsMetadataNoCache(metadataURI, {
    attempts: 3,
    timeoutMs: 10_000,
    delayMs: 2000,
    onAttempt: (info) => {
      if (info.phase === "attempt") {
        console.log(`  ipfs attempt ${info.attempt}/${info.maxAttempts}…`);
      } else if (info.phase === "gateway") {
        const host = info.url.replace(/^https?:\/\//, "").split("/")[0];
        console.log(`    gateway ${host}`);
      } else if (info.phase === "retry") {
        console.log(`  ipfs retry ${info.attempt}/${info.maxAttempts}: ${info.reason}`);
      }
    },
  });
  if (!md) throw new Error(`Could not load metadata after retries: ${metadataURI}`);

  const nadMarket = parseNadMarketFromMetadata(md);
  if (!nadMarket) throw new Error("Metadata has no valid nadMarket block");

  console.log(`  question: ${nadMarket.questionType}`);
  console.log(`  tokens: ${nadMarket.tokens.map((t) => t.symbol).join(", ")}`);

  console.log("  fetching Nad.fun stats…");
  const snapshots = await fetchNadResolutionSnapshots(nadMarket, (msg) => console.log(`    ${msg}`));
  const evaluation = evaluateNadOutcome(nadMarket, snapshots);

  console.log(`  outcome: ${evaluation.outcomeIndex} (${evaluation.outcomeLabel})`);
  console.log(`  reason: ${evaluation.evidence.reasoning}`);
  console.log(
    "  stats:",
    snapshots
      .map((s) => `${s.symbol} mcap=${s.stats.marketCapUsd} price=${s.stats.priceUsd} holders=${s.stats.holderCount}`)
      .join(" | "),
  );

  if (dryRun) {
    console.log("  [dry-run] skipped on-chain tx");
    return { resolved: false, dryRun: true, evaluation };
  }

  const tx = await row.market.connect(signer).resolveNadToken(evaluation.outcomeIndex);
  console.log(`  tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  mined block ${receipt.blockNumber}`);

  return { resolved: true, txHash: tx.hash, evaluation };
}

async function settleOneMarket(ctx, row) {
  if (row.kind === MARKET_KIND_PRICE) return settlePriceMarket(ctx, row);
  if (row.kind === MARKET_KIND_NAD_TOKEN) return settleNadMarket(ctx, row);
  throw new Error(`Unsupported kind ${row.kind}`);
}

async function runTick(ctx) {
  const { factory, hre, filterMarketId } = ctx;
  const pending = await loadResolvableMarkets(factory, hre, filterMarketId);

  if (pending.length === 0) {
    console.log(`[${new Date().toISOString()}] no PRICE/NAD markets ready to settle`);
    return 0;
  }

  console.log(
    `[${new Date().toISOString()}] ${pending.length} market(s) ready:`,
    pending.map((p) => `${p.id != null ? `#${p.id}` : p.address} ${kindLabel(p.kind)}`).join(", "),
  );

  let resolved = 0;
  for (const row of pending) {
    try {
      const result = await settleOneMarket(ctx, row);
      if (result.resolved) resolved += 1;
    } catch (err) {
      console.error(`  ERROR market ${row.id != null ? `#${row.id}` : row.address}:`, err?.message ?? err);
    }
  }

  return resolved;
}

async function main() {
  const { network, marketId, intervalSec, once, dryRun } = parseArgs();
  if (network) process.env.HARDHAT_NETWORK = network;
  else if (!process.env.HARDHAT_NETWORK) process.env.HARDHAT_NETWORK = "monadTestnet";

  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const networkName = hre.network.name;

  const { factoryAddress, nadResolutionAdmin, file } = readDeployment(hre, networkName, chainId);
  const factory = await hre.ethers.getContractAt("MondaloreParimutuelMarketFactory", factoryAddress);
  const onChainAdmin = await factory.nadResolutionAdmin();

  console.log("Settlement bot (PRICE + NAD_TOKEN)");
  console.log("  network:", networkName, chainId);
  console.log("  signer:", signer.address);
  console.log("  factory:", factoryAddress);
  console.log("  deployment:", file);
  console.log("  nadResolutionAdmin (chain):", onChainAdmin);
  if (nadResolutionAdmin) console.log("  nadResolutionAdmin (json):", nadResolutionAdmin);
  console.log("  dry-run:", dryRun);
  console.log("  mode:", once ? "once" : `poll every ${intervalSec}s`);
  console.log("  note: EVENT markets need npm run market:resolve-admins (multisig)");
  console.log("  subgraph:", getSubgraphUrl());

  const ctx = {
    hre,
    signer,
    factory,
    dryRun,
    nadAdmin: onChainAdmin,
    filterMarketId: Number.isInteger(marketId) ? marketId : null,
  };

  do {
    await runTick(ctx);
    if (once) break;
    await sleep(Math.max(15, intervalSec) * 1000);
  } while (true);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
