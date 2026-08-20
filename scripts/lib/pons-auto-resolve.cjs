/* eslint-disable no-console */
/**
 * Shared Pons bonded-token auto-resolution for CLI settle + bot.
 */
const path = require("path");

function loadPonsLib() {
  require(path.join(__dirname, "register-ts.cjs"));
  return {
    evaluatePonsOutcome: require("../../lib/pons/evaluate-outcome.ts").evaluatePonsOutcome,
    fetchPonsResolutionSnapshots: require("../../lib/pons/resolution-snapshot.ts").fetchPonsResolutionSnapshots,
    parsePonsMarketFromMetadata: require("../../lib/pons/parse-config.ts").parsePonsMarketFromMetadata,
    fetchIpfsMetadataNoCache: require("../../lib/ipfs-metadata.ts").fetchIpfsMetadataNoCache,
  };
}

/**
 * @returns {{ outcomeIndex: number, outcomeLabel: string, reasoning: string, ponsMarket: object, snapshots: object[] }}
 */
async function evaluatePonsMarketFromUri(metadataURI) {
  const {
    evaluatePonsOutcome,
    fetchPonsResolutionSnapshots,
    parsePonsMarketFromMetadata,
    fetchIpfsMetadataNoCache,
  } = loadPonsLib();

  const md = await fetchIpfsMetadataNoCache(metadataURI, { attempts: 3, timeoutMs: 10_000 });
  if (!md) throw new Error(`Could not load metadata: ${metadataURI}`);

  const ponsMarket = parsePonsMarketFromMetadata(md);
  if (!ponsMarket) throw new Error("Metadata has no valid ponsMarket block");

  const snapshots = await fetchPonsResolutionSnapshots(ponsMarket);
  const evaluation = evaluatePonsOutcome(ponsMarket, snapshots);

  return {
    outcomeIndex: evaluation.outcomeIndex,
    outcomeLabel: evaluation.outcomeLabel,
    reasoning: evaluation.evidence.reasoning,
    ponsMarket,
    snapshots,
  };
}

module.exports = { evaluatePonsMarketFromUri, loadPonsLib };
