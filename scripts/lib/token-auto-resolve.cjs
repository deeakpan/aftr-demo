/* eslint-disable no-console */
/**
 * Token-link markets: resolve from Dexscreener / GeckoTerminal via IPFS tokenMarket.
 */
const path = require("path");

function loadTokenLib() {
  require(path.join(__dirname, "register-ts.cjs"));
  return {
    evaluateTokenOutcome: require("../../lib/token-market/evaluate-outcome.ts").evaluateTokenOutcome,
    fetchTokenResolutionSnapshots: require("../../lib/token-market/resolution-snapshot.ts")
      .fetchTokenResolutionSnapshots,
    parseTokenMarketFromMetadata: require("../../lib/token-market/parse-config.ts")
      .parseTokenMarketFromMetadata,
    fetchIpfsMetadataNoCache: require("../../lib/ipfs-metadata.ts").fetchIpfsMetadataNoCache,
  };
}

/**
 * @returns {{ outcomeIndex: number, outcomeLabel: string, reasoning: string, tokenMarket: object, snapshots: object[] }}
 */
async function evaluateTokenMarketFromUri(metadataURI) {
  const {
    evaluateTokenOutcome,
    fetchTokenResolutionSnapshots,
    parseTokenMarketFromMetadata,
    fetchIpfsMetadataNoCache,
  } = loadTokenLib();

  const md = await fetchIpfsMetadataNoCache(metadataURI, { attempts: 3, timeoutMs: 10_000 });
  if (!md) throw new Error(`Could not load metadata: ${metadataURI}`);

  const tokenMarket = parseTokenMarketFromMetadata(md);
  if (!tokenMarket) throw new Error("Metadata has no valid tokenMarket block");

  const snapshots = await fetchTokenResolutionSnapshots(tokenMarket);
  const evaluation = evaluateTokenOutcome(tokenMarket, snapshots);

  return {
    outcomeIndex: evaluation.outcomeIndex,
    outcomeLabel: evaluation.outcomeLabel,
    reasoning: evaluation.reasoning,
    tokenMarket,
    snapshots,
  };
}

module.exports = { evaluateTokenMarketFromUri, loadTokenLib };
