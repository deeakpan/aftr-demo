/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const deploymentPath = path.join(__dirname, "..", "deployments", `${net}-${chainId}.json`);
  if (!fs.existsSync(deploymentPath)) throw new Error(`Missing deployment file: ${deploymentPath}`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const factory = deployment?.contracts?.AFTRParimutuelMarketFactory;
  const drp = process.env.DRP_ADDRESS?.trim() || "0x34a31ccc2bc660d17Ea91eBc5868397dd732fA64";
  if (!factory || !hre.ethers.isAddress(factory)) throw new Error("Invalid AFTRParimutuelMarketFactory in deployment json");
  if (!drp || !hre.ethers.isAddress(drp)) throw new Error("Invalid DRP address");

  console.log("Deployer:", deployer.address);
  console.log("Factory:", factory);
  console.log("DRP:", drp);

  const Router = await hre.ethers.getContractFactory("AFTRMarketDebtRouter");
  const router = await Router.deploy(factory, drp);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("AFTRMarketDebtRouter:", routerAddress);

  deployment.contracts = deployment.contracts || {};
  deployment.contracts.AFTRMarketDebtRouter = routerAddress;
  deployment.contracts.DRP = drp;
  fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");
  console.log("Updated deployment file:", deploymentPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
