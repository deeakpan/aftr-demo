/* eslint-disable no-console */
/**
 * Send ~$0.30 ETH + mock USDG from deployer to a recipient on Robinhood.
 * Usage: node scripts/fund-wallet-robinhood.cjs [recipient]
 */
require("dotenv").config();
const { ethers } = require("ethers");
const dep = require("../deployments/robinhoodMainnet-4663.json");

const RECIPIENT = (process.argv[2] || "0x5315A39D5B93E8BAd827BdfBbdae9d09331FB232").trim();
const ETH_USD = Number(process.env.ETH_USD_PRICE || "2400");
const USD_ETH = 0.3;
const USDG_AMOUNT = process.env.USDG_AMOUNT || "100"; // mock stable for testing

async function main() {
  const rpc = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  const pkRaw = process.env.PRIVATE_KEY;
  if (!rpc || !pkRaw) throw new Error("Need RPC_URL and PRIVATE_KEY");
  const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;

  const provider = new ethers.JsonRpcProvider(rpc);
  // Retry network detect
  for (let i = 0; i < 5; i++) {
    try {
      await provider.getBlockNumber();
      break;
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }

  const wallet = new ethers.Wallet(pk, provider);
  const ethAmount = ethers.parseEther((USD_ETH / ETH_USD).toFixed(18));
  const usdgAddr = dep.contracts.USDG;
  const usdg = new ethers.Contract(
    usdgAddr,
    [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function transfer(address to, uint256 amount) returns (bool)",
      "function mint(address to, uint256 amount)",
    ],
    wallet,
  );
  const decimals = await usdg.decimals();
  const usdgAmount = ethers.parseUnits(USDG_AMOUNT, decimals);

  console.log("Deployer:", wallet.address);
  console.log("Recipient:", RECIPIENT);
  console.log(`ETH: ${ethers.formatEther(ethAmount)} (~$${USD_ETH} @ $${ETH_USD}/ETH)`);
  console.log(`USDG: ${USDG_AMOUNT} (${usdgAddr})`);

  const ethBal = await provider.getBalance(wallet.address);
  let usdgBal = await usdg.balanceOf(wallet.address);
  console.log("Deployer ETH bal:", ethers.formatEther(ethBal));
  console.log("Deployer USDG bal:", ethers.formatUnits(usdgBal, decimals));

  if (usdgBal < usdgAmount) {
    console.log("Minting USDG to deployer...");
    const mintTx = await usdg.mint(wallet.address, usdgAmount - usdgBal);
    console.log("  mint tx:", mintTx.hash);
    await mintTx.wait();
    usdgBal = await usdg.balanceOf(wallet.address);
  }

  if (ethBal < ethAmount) throw new Error("Insufficient ETH on deployer");

  const feeData = await provider.getFeeData();
  // Robinhood is cheap; keep a small tip.
  const gasOverrides = {
    maxFeePerGas: feeData.maxFeePerGas ?? ethers.parseUnits("0.1", "gwei"),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? ethers.parseUnits("0.01", "gwei"),
  };

  console.log("Sending ETH...");
  const ethTx = await wallet.sendTransaction({
    to: RECIPIENT,
    value: ethAmount,
    ...gasOverrides,
  });
  console.log("  eth tx:", ethTx.hash);
  await ethTx.wait();

  console.log("Sending USDG...");
  const usdgTx = await usdg.transfer(RECIPIENT, usdgAmount, gasOverrides);
  console.log("  usdg tx:", usdgTx.hash);
  await usdgTx.wait();

  const rEth = await provider.getBalance(RECIPIENT);
  const rUsdg = await usdg.balanceOf(RECIPIENT);
  console.log("Done.");
  console.log("Recipient ETH:", ethers.formatEther(rEth));
  console.log("Recipient USDG:", ethers.formatUnits(rUsdg, decimals));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
