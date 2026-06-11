/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DRP_ABI = [
  "function trustedManagers(address) view returns (bool)",
  "function pendingOps(uint8) view returns (address addr,uint256 value,uint256 validAt,bool exists)",
  "function schedule(uint8 _op, address _addr, uint256 _value)",
  "function executeOp(uint8 _op)",
];

const SET_VAULT_MANAGER_OP = 2; // TimelockOp.SetVaultManager

function unpackPendingOp(op) {
  return {
    addr: op.addr ?? op[0],
    value: op.value ?? op[1],
    validAt: op.validAt ?? op[2],
    exists: op.exists ?? op[3],
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let executeOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--execute-only") {
      executeOnly = true;
    }
  }
  return { executeOnly };
}

function readDeployment(networkName, chainId) {
  const file = path.join(__dirname, "..", "deployments", `${networkName}-${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Deployment file not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const drp = parsed?.contracts?.DRP;
  const router = parsed?.contracts?.MondaloreMarketDebtRouter;
  if (!drp || !hre.ethers.isAddress(drp)) throw new Error("DRP missing in deployment file.");
  if (!router || !hre.ethers.isAddress(router)) {
    throw new Error("MondaloreMarketDebtRouter missing in deployment file.");
  }
  return { drp, router, file };
}

async function main() {
  const { executeOnly } = parseArgs();

  const [signer] = await hre.ethers.getSigners();
  const chain = await hre.ethers.provider.getNetwork();
  const chainId = Number(chain.chainId);
  const networkName = hre.network.name;
  const { drp, router, file } = readDeployment(networkName, chainId);
  const c = new hre.ethers.Contract(drp, DRP_ABI, signer);

  console.log("Network:", networkName, chainId);
  console.log("Signer:", signer.address);
  console.log("Deployment:", file);
  console.log("DRP:", drp);
  console.log("Router:", router);

  const alreadyTrusted = await c.trustedManagers(router);
  if (alreadyTrusted) {
    console.log("Router is already trusted in DRP.");
    return;
  }

  const pending = unpackPendingOp(await c.pendingOps(SET_VAULT_MANAGER_OP));
  const now = Math.floor(Date.now() / 1000);
  const samePending =
    pending.exists &&
    pending.addr.toLowerCase() === router.toLowerCase() &&
    pending.value === 1n;

  if (!samePending && executeOnly) {
    throw new Error("No matching pending SetVaultManager op for router. Run without --execute-only first.");
  }

  if (!samePending) {
    console.log("Scheduling SetVaultManager(router,1) timelock op...");
    const tx = await c.schedule(SET_VAULT_MANAGER_OP, router, 1);
    console.log("schedule tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("Matching pending SetVaultManager op already exists.");
  }

  const latestPending = unpackPendingOp(await c.pendingOps(SET_VAULT_MANAGER_OP));
  if (!latestPending.exists) {
    console.log("No pending op found after schedule; check DRP.");
    return;
  }

  if (Number(latestPending.validAt) > now) {
    const waitSec = Number(latestPending.validAt) - now;
    console.log("Timelock not ready yet.");
    console.log("validAt:", Number(latestPending.validAt), `(in ~${waitSec}s)`);
    console.log("Run this script again later with --execute-only.");
    return;
  }

  console.log("Executing SetVaultManager op...");
  const execTx = await c.executeOp(SET_VAULT_MANAGER_OP);
  console.log("executeOp tx:", execTx.hash);
  await execTx.wait();

  const trustedNow = await c.trustedManagers(router);
  console.log("Router trusted after execute:", trustedNow);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

