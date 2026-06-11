/* eslint-disable no-console */
const { TypedDataEncoder } = require("ethers");

const DOMAIN_NAME = "Mondalore Market";
const DOMAIN_VERSION = "1";

function resolutionTypedData(marketAddress, outcomeIndex, chainId) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      EventResolution: [
        { name: "market", type: "address" },
        { name: "outcomeIndex", type: "uint8" },
        { name: "chainId", type: "uint256" },
      ],
    },
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: Number(chainId),
      verifyingContract: marketAddress,
    },
    primaryType: "EventResolution",
    message: {
      market: marketAddress,
      outcomeIndex: Number(outcomeIndex),
      chainId: BigInt(chainId),
    },
  };
}

function resolutionDigest(marketAddress, outcomeIndex, chainId) {
  const td = resolutionTypedData(marketAddress, outcomeIndex, chainId);
  return TypedDataEncoder.hash(td.domain, { EventResolution: td.types.EventResolution }, td.message);
}

async function signResolution(signer, marketAddress, outcomeIndex, chainId) {
  const td = resolutionTypedData(marketAddress, outcomeIndex, chainId);
  return signer.signTypedData(td.domain, { EventResolution: td.types.EventResolution }, td.message);
}

module.exports = {
  DOMAIN_NAME,
  DOMAIN_VERSION,
  resolutionTypedData,
  resolutionDigest,
  signResolution,
};
