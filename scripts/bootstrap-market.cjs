/* eslint-disable no-console */
/**
 * Bootstrap vPari market liquidity with pool collateral (one-time).
 * Usage: npm run market:bootstrap -- <marketId> [--amount <humanAmount>] [--network baseSepolia]
 * Default humanAmount is "40" (override with --amount).
 */
const fs = require("fs");
const path = require("path");

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const MARKET_ABI = [
  "function bootstrapLiquidity(uint256 totalAmount, address shareRecipient)",
  "function collateralAddress() view returns (address)",
  "function bootstrapped() view returns (bool)",
  "function minBootstrapTotal() view returns (uint256)",
  "function numOutcomes() view returns (uint8)",
  "function state() view returns (uint8)",
  "function stakeEndTimestamp() view returns (uint256)",
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  let marketIdRaw;
  let amountHuman = "40";
  let network;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[++i];
      continue;
    }
    if (arg === "--amount") {
      amountHuman = args[++i];
      continue;
    }
    if (!marketIdRaw) marketIdRaw = arg;
  }
  if (!marketIdRaw) {
    throw new Error(
      "Missing market id. Usage: npm run market:bootstrap -- <id> [--amount 40] [--network baseSepolia]",
    );
  }
  const marketId = Number(marketIdRaw);
  if (!Number.isInteger(marketId) || marketId < 0) throw new Error(`Invalid market id: ${marketIdRaw}`);
  return { marketId, amountHuman, network };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Deployment file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.AFTRParimutuelMarketFactory;
  const aftrUsdc = parsed?.contracts?.AFTRUSDC;
  return { factoryAddress, file, aftrUsdc, parsed };
}

async function main() {
  const { marketId, amountHuman, network: networkArg } = parseCliArgs();
  if (networkArg) process.env.HARDHAT_NETWORK = networkArg;

  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const { factoryAddress, file, aftrUsdc } = readDeployment(hre, networkName, chainId);
  if (!hre.ethers.isAddress(factoryAddress)) throw new Error("AFTRParimutuelMarketFactory missing in deployment.");

  const factory = await hre.ethers.getContractAt("AFTRParimutuelMarketFactory", factoryAddress);
  const total = Number(await factory.marketsLength());
  if (marketId >= total) throw new Error(`Market id ${marketId} out of range (total ${total}).`);

  const marketAddress = await factory.markets(BigInt(marketId));
  const market = new hre.ethers.Contract(marketAddress, MARKET_ABI, hre.ethers.provider);
  const marketWrite = market.connect(signer);

  const [bootstrapped, minBt, numOutcomes, collateralAddress, decimals, stakeEnd, tokenState] =
    await Promise.all([
      market.bootstrapped(),
      market.minBootstrapTotal(),
      market.numOutcomes(),
      market.collateralAddress(),
      (async () => {
        const c = await market.collateralAddress();
        if (c.toLowerCase() === hre.ethers.ZeroAddress.toLowerCase()) return 18;
        const erc = new hre.ethers.Contract(c, ERC20_ABI, signer);
        return erc.decimals();
      })(),
      market.stakeEndTimestamp(),
      market.state(),
    ]);

  const na = Number(stakeEnd) * 1000;
  if (Date.now() >= na) throw new Error("Stake period ended; cannot bootstrap.");
  if (Number(tokenState) !== 0) throw new Error(`Market must be OPEN (state 0); got ${tokenState}`);
  if (bootstrapped) throw new Error("Market already bootstrapped.");

  if (aftrUsdc && collateralAddress.toLowerCase() !== aftrUsdc.toLowerCase()) {
    console.warn(
      "Warning: market collateral",
      collateralAddress,
      "differs from deployment AFTRUSDC",
      aftrUsdc,
    );
  }

  let desired = hre.ethers.parseUnits(amountHuman, Number(decimals));
  const n = BigInt(numOutcomes);
  const rem = desired % n;
  if (rem !== 0n) {
    desired -= rem;
    console.log(
      `Adjusted amount to divisible total (÷${numOutcomes} outcomes): −${rem} base units (${Number(rem) / 10 ** Number(decimals)} token)`,
    );
  }
  if (desired < minBt) throw new Error(`Bootstrap amount ${desired} < minBootstrapTotal ${minBt}. Increase --amount.`);

  console.log("Network:", networkName, chainId);
  console.log("Deployment:", file);
  console.log("Signer:", signer.address);
  console.log("Market:", marketAddress);
  console.log(`Total bootstrap (÷${numOutcomes} outcomes):`, desired.toString(), `(~${hre.ethers.formatUnits(desired, decimals)} collateral)`);

  const isEth = collateralAddress.toLowerCase() === hre.ethers.ZeroAddress.toLowerCase();

  if (isEth) {
    const bal = await hre.ethers.provider.getBalance(signer.address);
    if (bal < desired) throw new Error("Insufficient ETH for bootstrap.");
    console.log("Calling bootstrapLiquidity (native)...");
    const tx = await marketWrite.bootstrapLiquidity(desired, signer.address, { value: desired });
    console.log("Tx:", tx.hash);
    await tx.wait();
    console.log("Done.");
    return;
  }

  const token = new hre.ethers.Contract(collateralAddress, ERC20_ABI, signer);
  const sym = await token.symbol();
  const bal = await token.balanceOf(signer.address);
  if (bal < desired) throw new Error(`Insufficient ${sym}. Need ${desired}, have ${bal}.`);

  const allowance = await token.allowance(signer.address, marketAddress);
  if (allowance < desired) {
    const txA = await token.approve(marketAddress, desired);
    console.log("Approve tx:", txA.hash);
    await txA.wait();
  }

  console.log("Calling bootstrapLiquidity...");
  const tx = await marketWrite.bootstrapLiquidity(desired, signer.address);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Bootstrap complete. Share recipient:", signer.address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
