/* eslint-disable no-console */
/**
 * Auto-resolve NAD_TOKEN markets from IPFS — Pons bonded first, legacy Nad fallback.
 */
const { evaluatePonsMarketFromUri } = require("./pons-auto-resolve.cjs");
const { evaluateNadMarketFromUri } = require("./nad-auto-resolve.cjs");

async function evaluateLaunchpadMarketFromUri(metadataURI) {
  try {
    return { ...await evaluatePonsMarketFromUri(metadataURI), launchpad: "pons" };
  } catch (ponsErr) {
    try {
      return { ...await evaluateNadMarketFromUri(metadataURI), launchpad: "nad" };
    } catch (nadErr) {
      throw new Error(
        `Could not auto-resolve launchpad market.\nPons: ${ponsErr.message ?? ponsErr}\nNad: ${nadErr.message ?? nadErr}`,
      );
    }
  }
}

module.exports = { evaluateLaunchpadMarketFromUri };
