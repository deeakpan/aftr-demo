/* eslint-disable no-console */
/**
 * Shared NAD auto-resolution for CLI settle + bot.
 */
const path = require("path");

function loadNadLib() {
  require(path.join(__dirname, "register-ts.cjs"));
  return {
    evaluateNadOutcome: require("../../lib/nad/evaluate-outcome.ts").evaluateNadOutcome,
    fetchNadResolutionSnapshots: require("../../lib/nad/resolution-snapshot.ts").fetchNadResolutionSnapshots,
    parseNadMarketFromMetadata: require("../../lib/nad/parse-config.ts").parseNadMarketFromMetadata,
    fetchIpfsMetadataNoCache: require("../../lib/ipfs-metadata.ts").fetchIpfsMetadataNoCache,
  };
}

/**
 * @returns {{ outcomeIndex: number, outcomeLabel: string, reasoning: string }}
 */
async function evaluateNadMarketFromUri(metadataURI) {
  const {
    evaluateNadOutcome,
    fetchNadResolutionSnapshots,
    parseNadMarketFromMetadata,
    fetchIpfsMetadataNoCache,
  } = loadNadLib();

  const md = await fetchIpfsMetadataNoCache(metadataURI, { attempts: 3, timeoutMs: 10_000 });
  if (!md) throw new Error(`Could not load metadata: ${metadataURI}`);

  const nadMarket = parseNadMarketFromMetadata(md);
  if (!nadMarket) throw new Error("Metadata has no valid nadMarket block");

  const snapshots = await fetchNadResolutionSnapshots(nadMarket);
  const evaluation = evaluateNadOutcome(nadMarket, snapshots);

  return {
    outcomeIndex: evaluation.outcomeIndex,
    outcomeLabel: evaluation.outcomeLabel,
    reasoning: evaluation.evidence.reasoning,
    nadMarket,
    snapshots,
  };
}

module.exports = { evaluateNadMarketFromUri, loadNadLib };
