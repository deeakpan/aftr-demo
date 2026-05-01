/* eslint-disable no-console */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const ETH_USD_COINGECKO =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

const WETH_ABI = [
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const DRP_ABI = [
  "function usdead() view returns (address)",
  "function depositAndMint(address _token, uint256 _colAmount, uint256 _mintAmount, address _user)",
  "function getUserVaultDetails(address _user, address _token) view returns (uint256 collateral,uint256 debt,uint256 pendingWithdrawalAmount,uint256 unlockTimestamp,bool isClosing,bool isLiquidated)",
];

const USDEAD_ABI = ["function balanceOf(address) view returns (uint256)"];

function req(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var ${name}`);
  return v.trim();
}

async function fetchEthUsdPrice() {
  const res = await fetch(ETH_USD_COINGECKO, { cache: "no-store" });
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const json = await res.json();
  const p = Number(json?.ethereum?.usd);
  if (!Number.isFinite(p) || p <= 0) throw new Error("Invalid ETH price from CoinGecko");
  return p;
}

function toEthWeiForUsd(ethers, usdAmount, ethUsd) {
  const ethAmount = usdAmount / ethUsd;
  return ethers.parseEther(ethAmount.toFixed(18));
}

function toUsdeadWeiForUsd(ethers, usdAmount) {
  // USDeAD uses 18 decimals.
  return ethers.parseUnits(usdAmount.toFixed(6), 18);
}

async function resolveDrpAddress() {
  const { ethers } = hre;
  const fromEnv = process.env.DRP_ADDRESS?.trim();
  if (fromEnv && ethers.isAddress(fromEnv)) return fromEnv;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(
    __dirname,
    "..",
    "deployments",
    `${hre.network.name}-${chainId}.json`,
  );
  if (!fs.existsSync(file)) throw new Error(`Deployment file missing: ${file}`);
  const drp = JSON.parse(fs.readFileSync(file, "utf8"))?.contracts?.DRP;
  if (!drp || !ethers.isAddress(drp)) throw new Error("DRP missing in deployment JSON.");
  return drp;
}

async function runForWallet({ signer, drpAddress, collateralUsd, borrowUsd, ethUsd, ethers }) {
  const addr = await signer.getAddress();
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
  const drp = new ethers.Contract(drpAddress, DRP_ABI, signer);
  const usdeadAddr = await drp.usdead();
  const usdead = new ethers.Contract(usdeadAddr, USDEAD_ABI, signer);

  const collateralWei = toEthWeiForUsd(ethers, collateralUsd, ethUsd);
  const mintWei = toUsdeadWeiForUsd(ethers, borrowUsd);
  const [wethBefore, usdeadBefore, vaultBefore] = await Promise.all([
    weth.balanceOf(addr),
    usdead.balanceOf(addr),
    drp.getUserVaultDetails(addr, WETH_ADDRESS),
  ]);

  console.log(`\nWallet: ${addr}`);
  console.log(`  Collateral target: $${collateralUsd} -> ${ethers.formatEther(collateralWei)} WETH`);
  console.log(`  Borrow target:     $${borrowUsd} -> ${ethers.formatUnits(mintWei, 18)} USDeAD`);

  console.log("  1) Wrapping ETH -> WETH...");
  const txWrap = await weth.deposit({ value: collateralWei });
  const wrapReceipt = await txWrap.wait();

  console.log("  2) Approving DRP to spend WETH...");
  const txApprove = await weth.approve(drpAddress, collateralWei);
  const approveReceipt = await txApprove.wait();

  console.log("  3) depositAndMint (WETH collateral, USDeAD borrow)...");
  const txBorrow = await drp.depositAndMint(WETH_ADDRESS, collateralWei, mintWei, addr);
  const receipt = await txBorrow.wait();

  console.log("  ✅ Done for wallet", addr);
  const [wethAfter, usdeadAfter, vaultAfter] = await Promise.all([
    weth.balanceOf(addr),
    usdead.balanceOf(addr),
    drp.getUserVaultDetails(addr, WETH_ADDRESS),
  ]);
  const debtDelta = vaultAfter.debt - vaultBefore.debt;
  const collateralDelta = vaultAfter.collateral - vaultBefore.collateral;
  const success =
    (receipt.status === 1 || receipt.status === 1n) &&
    debtDelta > 0n &&
    collateralDelta > 0n;

  return {
    wallet: addr,
    txHash: receipt.hash,
    collateral: {
      token: "WETH",
      targetUsd: collateralUsd,
      targetWei: collateralWei.toString(),
      wethWalletBefore: wethBefore.toString(),
      wethWalletAfter: wethAfter.toString(),
      vaultCollateralBefore: vaultBefore.collateral.toString(),
      vaultCollateralAfter: vaultAfter.collateral.toString(),
    },
    borrow: {
      token: "USDeAD",
      targetUsd: borrowUsd,
      targetWei: mintWei.toString(),
      walletBefore: usdeadBefore.toString(),
      walletAfter: usdeadAfter.toString(),
      walletDelta: (usdeadAfter - usdeadBefore).toString(),
    },
    debt: {
      before: vaultBefore.debt.toString(),
      after: vaultAfter.debt.toString(),
      delta: debtDelta.toString(),
    },
    success,
    txStatus: receipt.status?.toString?.() ?? "unknown",
    wrapTxStatus: wrapReceipt.status?.toString?.() ?? "unknown",
    approveTxStatus: approveReceipt.status?.toString?.() ?? "unknown",
  };
}

async function main() {
  const ethUsd = await fetchEthUsdPrice();
  console.log("ETH/USD (CoinGecko):", ethUsd);

  const { ethers } = hre;
  const provider = ethers.provider;

  const drpAddress = await resolveDrpAddress();
  console.log("DRP:", drpAddress);

  const [wallet1] = await ethers.getSigners(); // Uses PRIVATE_KEY from env/hardhat config
  const wallet2Pk = req("SECOND_PRIVATE_KEY");
  const wallet2 = new ethers.Wallet(
    wallet2Pk.startsWith("0x") ? wallet2Pk : `0x${wallet2Pk}`,
    provider,
  );

  // Conservative borrow sizes below protocol max (CR 1.25x):
  // $30 collateral -> borrow $20, $10 collateral -> borrow $6.
  const runOnlyWallet2 = process.env.RUN_ONLY_WALLET2 === "1";
  let result1 = null;
  if (!runOnlyWallet2) {
    result1 = await runForWallet({
      signer: wallet1,
      drpAddress,
      collateralUsd: 30,
      borrowUsd: 20,
      ethUsd,
      ethers,
    });
  }
  let result2 = null;
  const wallet2Runs = [];
  const wallet2Attempts = [6, 5, 4];
  for (const borrowUsd of wallet2Attempts) {
    const attempt = await runForWallet({
      signer: wallet2,
      drpAddress,
      collateralUsd: 10,
      borrowUsd,
      ethUsd,
      ethers,
    });
    wallet2Runs.push(attempt);
    if (attempt.success) {
      result2 = attempt;
      break;
    }
    console.log(`Wallet2 attempt with $${borrowUsd} borrow did not update vault, retrying...`);
  }
  if (!result2) result2 = wallet2Runs[wallet2Runs.length - 1];

  const output = {
    chainId: Number((await provider.getNetwork()).chainId),
    drpAddress,
    wethAddress: WETH_ADDRESS,
    ethUsd,
    executedAt: new Date().toISOString(),
    results: [result1, result2].filter(Boolean),
    wallet2Attempts: wallet2Runs,
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = process.env.OUTPUT_JSON
    ? path.resolve(process.cwd(), process.env.OUTPUT_JSON)
    : path.join(outDir, `drp-borrow-run-${Date.now()}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log("\nWrote run report:", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
