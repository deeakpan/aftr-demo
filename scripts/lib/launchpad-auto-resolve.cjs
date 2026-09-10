/* eslint-disable no-console */
/**
 * Auto-resolve kind-2 markets from IPFS — token-link first, then legacy Pons / Nad.
 */
const { evaluateTokenMarketFromUri } = require("./token-auto-resolve.cjs");
const { evaluatePonsMarketFromUri } = require("./pons-auto-resolve.cjs");
const { evaluateNadMarketFromUri } = require("./nad-auto-resolve.cjs");

async function evaluateLaunchpadMarketFromUri(metadataURI) {
  try {
    return { ...(await evaluateTokenMarketFromUri(metadataURI)), launchpad: "token" };
  } catch (tokenErr) {
    try {
      return { ...(await evaluatePonsMarketFromUri(metadataURI)), launchpad: "pons" };
    } catch (ponsErr) {
      try {
        return { ...(await evaluateNadMarketFromUri(metadataURI)), launchpad: "nad" };
      } catch (nadErr) {
        throw new Error(
          `Could not auto-resolve launchpad market.\nToken: ${tokenErr.message ?? tokenErr}\nPons: ${ponsErr.message ?? ponsErr}\nNad: ${nadErr.message ?? nadErr}`,
        );
      }
    }
  }
}

module.exports = { evaluateLaunchpadMarketFromUri };
