/* eslint-disable no-console */
/**
 * Estimate full-stack deploy gas cost on the connected Hardhat network (use robinhoodMainnet).
 * Does NOT broadcast transactions — only eth_estimateGas on deploy bytecode.
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const fee = await hre.ethers.provider.getFeeData();
  const gp = fee.gasPrice ?? fee.maxFeePerGas;
  if (!gp) throw new Error("Could not read gas price from RPC");

  const zero = hre.ethers.ZeroAddress;
  const specs = [
    { name: "MondaloreUSDC", args: [deployer.address] },
    { name: "USDG", args: [deployer.address] },
    { name: "MondaloreToken", args: [deployer.address, 100_000_000n * 10n ** 18n] },
    {
      name: "MondaloreFeeVault",
      args: [deployer.address, deployer.address, 604_800n, 604_800n],
    },
    {
      name: "MondaloreParimutuelMarketFactory",
      args: [deployer.address, deployer.address, zero, zero],
    },
    { name: "MondalorePriceMarketDeployer", args: [] },
    { name: "MondaloreEventMarketDeployer", args: [] },
    { name: "MondaloreParimutuelDeployer", args: [zero] },
    { name: "MondaloreOrderBook", args: [zero, deployer.address, deployer.address] },
    { name: "ZedkrCollateralRegistry", args: [deployer.address] },
    {
      name: "ZedkrFpmmMarketFactory",
      args: [deployer.address, deployer.address, deployer.address],
    },
    { name: "ZedkrFpmmDeployer", args: [zero] },
  ];

  let totalDeployGas = 0n;
  const rows = [];
  for (const spec of specs) {
    try {
      const F = await hre.ethers.getContractFactory(spec.name);
      const tx = await F.getDeployTransaction(...spec.args);
      const gas = await hre.ethers.provider.estimateGas(tx);
      totalDeployGas += gas;
      rows.push({ name: spec.name, gas: gas.toString() });
    } catch (e) {
      rows.push({ name: spec.name, error: (e.shortMessage || e.message).slice(0, 160) });
    }
  }

  // Config txs: setMarketDeployer, addCollateral, whitelist, setResolutionAdmins, etc.
  const setupGas = 450_000n * 28n;
  const grandGas = totalDeployGas + setupGas;
  const costWei = grandGas * gp;

  const bal = await hre.ethers.provider.getBalance(deployer.address);

  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        balanceEth: hre.ethers.formatEther(bal),
        gasPriceGwei: Number(gp) / 1e9,
        gasPriceWei: gp.toString(),
        contractDeployGas: totalDeployGas.toString(),
        setupTxGasAssumed: setupGas.toString(),
        totalGas: grandGas.toString(),
        estimatedCostEth: hre.ethers.formatEther(costWei),
        perContract: rows,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
