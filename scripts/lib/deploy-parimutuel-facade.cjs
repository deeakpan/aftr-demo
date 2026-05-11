/**
 * Deploy AFTRParimutuelDeployer + sub-deployers in 3 txs (avoids EIP-3860 max initcode on L2s).
 *
 * @param {import("hardhat").HardhatRuntimeEnvironment} hre
 * @param {import("ethers").Signer} deploySigner
 * @param {string} factoryAddress
 * @param {(factory: import("ethers").ContractFactory, ...args: unknown[]) => Promise<{ address: string, blockNumber: number }>} deployAndTrack
 */
async function deployParimutuelFacade(hre, deploySigner, factoryAddress, deployAndTrack) {
  const from = deploySigner.address;
  const nonce = await hre.ethers.provider.getTransactionCount(from, "pending");
  // Facade is the 3rd deployment (price deployer, event deployer, then facade).
  const predictedFacade = hre.ethers.getCreateAddress({
    from,
    nonce: BigInt(nonce) + 2n,
  });

  const PriceDF = await hre.ethers.getContractFactory("AFTRPriceMarketDeployer");
  const { address: priceDep, blockNumber: priceBlock } = await deployAndTrack(
    PriceDF,
    predictedFacade,
    factoryAddress,
  );

  const EventDF = await hre.ethers.getContractFactory("AFTREventMarketDeployer");
  const { address: eventDep, blockNumber: eventBlock } = await deployAndTrack(
    EventDF,
    predictedFacade,
    factoryAddress,
  );

  const FacadeF = await hre.ethers.getContractFactory("AFTRParimutuelDeployer");
  const { address: facadeAddr, blockNumber: facadeBlock } = await deployAndTrack(
    FacadeF,
    factoryAddress,
    priceDep,
    eventDep,
  );

  if (facadeAddr.toLowerCase() !== predictedFacade.toLowerCase()) {
    throw new Error(
      `Parimutuel facade CREATE mismatch: predicted ${predictedFacade}, deployed ${facadeAddr}`,
    );
  }

  return {
    marketDeployerAddress: facadeAddr,
    facadeBlock,
    priceDep,
    eventDep,
    priceBlock,
    eventBlock,
  };
}

module.exports = { deployParimutuelFacade };
