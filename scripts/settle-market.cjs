/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  let marketIdRaw;
  let network;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--network") {
      network = args[i + 1];
      i += 1;
      continue;
    }
    if (!marketIdRaw) {
      marketIdRaw = arg;
      continue;
    }
  }

  if (!marketIdRaw) {
    throw new Error("Missing market id. Usage: npm run market:settle -- <id> [--network <name>]");
  }
  const id = Number(marketIdRaw);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`Invalid market id: ${marketIdRaw}`);
  }
  if (network && typeof network !== "string") {
    throw new Error("Invalid network name.");
  }

  return { marketId: id, network };
}

function readDeployment(hre, networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment file not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const factoryAddress = parsed?.contracts?.AFTRParimutuelMarketFactory;
  if (!factoryAddress || !hre.ethers.isAddress(factoryAddress)) {
    throw new Error("AFTRParimutuelMarketFactory missing in deployment file.");
  }
  return { factoryAddress, file };
}

async function main() {
  const { marketId, network: networkArg } = parseCliArgs();
  if (networkArg) {
    process.env.HARDHAT_NETWORK = networkArg;
  }
  const hre = require("hardhat");
  const [signer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = hre.network.name;

  const { factoryAddress, file } = readDeployment(hre, networkName, chainId);
  const factory = await hre.ethers.getContractAt("AFTRParimutuelMarketFactory", factoryAddress);
  const total = Number(await factory.marketsLength());
  if (marketId >= total) {
    throw new Error(`Market id ${marketId} out of range. Total markets: ${total}`);
  }

  const marketAddress = await factory.markets(BigInt(marketId));
  const market = await hre.ethers.getContractAt("AFTRVParimutuelMarket", marketAddress);
  const kind = Number(await market.marketKind()); // 0=PRICE, 1=EVENT
  const state = Number(await market.state()); // 0=OPEN, 1=AWAITING_UMA, 2=SETTLED

  console.log("Network:", networkName, chainId);
  console.log("Signer:", signer.address);
  console.log("Deployment:", file);
  console.log("Factory:", factoryAddress);
  console.log("Market id:", marketId);
  console.log("Market:", marketAddress);
  console.log("Kind:", kind === 0 ? "PRICE" : "EVENT");
  console.log("State:", state);

  if (state === 2) {
    const winningOutcomeIndex = await market.winningOutcomeIndex();
    console.log("Market already settled. winningOutcomeIndex:", winningOutcomeIndex.toString());
    return;
  }

  let tx;
  if (kind === 0) {
    if (state !== 0) throw new Error(`Unexpected PRICE market state: ${state}`);
    console.log("Calling settlePrice()...");
    tx = await market.settlePrice();
  } else {
    if (state === 0) {
      // Preflight UMA funding: if market balance is short, approve + fund before requesting resolution.
      const [umaReward, rewardCurrency] = await Promise.all([market.umaReward(), market.umaRewardCurrency()]);
      if (umaReward > 0n) {
        const rewardToken = new hre.ethers.Contract(rewardCurrency, ERC20_ABI, signer);
        const marketRewardBal = await rewardToken.balanceOf(marketAddress);
        const missing = umaReward > marketRewardBal ? umaReward - marketRewardBal : 0n;
        let symbol = "TOKEN";
        try {
          symbol = await rewardToken.symbol();
        } catch {
          // Non-standard ERC20 metadata; keep generic symbol.
        }

        console.log("UMA reward token:", rewardCurrency, `(${symbol})`);
        console.log("Market bond balance:", marketRewardBal.toString());
        console.log("Required umaReward:", umaReward.toString());
        if (missing > 0n) {
          console.log("Shortfall detected, funding:", missing.toString(), symbol);
          const signerBal = await rewardToken.balanceOf(signer.address);
          if (signerBal < missing) {
            throw new Error(
              `Insufficient ${symbol} on signer. Need ${missing.toString()}, have ${signerBal.toString()}.`,
            );
          }
          const allowance = await rewardToken.allowance(signer.address, marketAddress);
          if (allowance < missing) {
            console.log("Approving market to pull UMA reward token...");
            const approveTx = await rewardToken.approve(marketAddress, missing);
            console.log("Approve tx:", approveTx.hash);
            await approveTx.wait();
          }
          console.log("Funding market UMA bond...");
          const fundTx = await market.fundUmaBond(missing);
          console.log("fundUmaBond tx:", fundTx.hash);
          await fundTx.wait();
        }
      }

      console.log("Calling requestEventResolution()...");
      tx = await market.requestEventResolution();
    } else if (state === 1) {
      console.log("Calling settleWithUmaResult()...");
      tx = await market.settleWithUmaResult();
    } else {
      throw new Error(`Unexpected EVENT market state: ${state}`);
    }
  }

  console.log("Submitted:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mined in block:", receipt.blockNumber);

  const newState = Number(await market.state());
  console.log("New state:", newState);
  if (newState === 2) {
    const winningOutcomeIndex = await market.winningOutcomeIndex();
    console.log("winningOutcomeIndex:", winningOutcomeIndex.toString());
  } else if (kind === 1 && state === 0 && newState === 1) {
    console.log("UMA request submitted. Run this same command again later to finalize.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
