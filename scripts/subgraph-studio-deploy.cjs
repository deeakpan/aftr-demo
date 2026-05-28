/* eslint-disable no-console */
/**
 * Deploy subgraph to Subgraph Studio.
 *
 * Requires in .env:
 *   SUBGRAPH_DEPLOY_KEY
 *
 * Optional:
 *   STUDIO_SUBGRAPH_SLUG (default aftr)
 *   SUBGRAPH_VERSION_LABEL (default v0.08)
 *
 * Runs: graph deploy <slug> subgraph.yaml --version-label <version>
 */
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const dk = process.env.SUBGRAPH_DEPLOY_KEY?.trim();
if (!dk) {
  console.error("Set SUBGRAPH_DEPLOY_KEY in .env");
  process.exit(1);
}

const subgraphDir = path.join(__dirname, "..", "subgraph");
const slug = process.env.STUDIO_SUBGRAPH_SLUG ?? "aftr";
const versionLabel = process.env.SUBGRAPH_VERSION_LABEL ?? "v0.08";
const maxAttempts = Number(process.env.SUBGRAPH_DEPLOY_ATTEMPTS || 3);

const graphBin = path.join(
  subgraphDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "graph.cmd" : "graph",
);

/** Prefer IPv4 on Windows — reduces intermittent EAI_AGAIN to Studio. */
const childEnv = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
    .filter(Boolean)
    .join(" "),
};

function runGraph(args) {
  return spawnSync(graphBin, args, {
    cwd: subgraphDir,
    stdio: "inherit",
    shell: true,
    env: childEnv,
  });
}

console.log(`Deploying slug="${slug}" version="${versionLabel}"`);

const auth = runGraph(["auth", dk]);
if (auth.status !== 0) process.exit(auth.status ?? 1);

const deployArgs = ["deploy", slug, "subgraph.yaml", "--version-label", versionLabel];

function sleep(ms) {
  spawnSync(
    process.platform === "win32" ? "powershell" : "sleep",
    process.platform === "win32" ? ["-Command", `Start-Sleep -Seconds ${Math.ceil(ms / 1000)}`] : [String(Math.ceil(ms / 1000))],
    { stdio: "ignore" },
  );
}

let deployed = false;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  if (attempt > 1) {
    const waitSec = 8 * attempt;
    console.log(`\nRetry ${attempt}/${maxAttempts} in ${waitSec}s (DNS/network)…`);
    sleep(waitSec * 1000);
  }

  const r = runGraph(deployArgs);
  if (r.status === 0) {
    deployed = true;
    console.log(`\nDeployed ${slug} @ ${versionLabel}`);
    console.log(
      `Query URL: https://api.studio.thegraph.com/query/1749057/${slug}/${versionLabel}`,
    );
    console.log("Set SUBGRAPH_QUERY_URL in .env to that URL after Studio shows Synced.");
    break;
  }
}

if (deployed) process.exit(0);

console.error(`
Deploy failed after ${maxAttempts} attempt(s) (often EAI_AGAIN = DNS/network).

Try:
  1. ipconfig /flushdns
  2. Set DNS to 1.1.1.1 or 8.8.8.8, disable VPN, retry
  3. PowerShell:
       $env:NODE_OPTIONS="--dns-result-order=ipv4first"
       $env:STUDIO_SUBGRAPH_SLUG="aftr"
       $env:SUBGRAPH_VERSION_LABEL="v0.08"
       npm run subgraph:deploy-studio

  4. Or deploy from subgraph folder:
       cd subgraph
       npx graph auth --studio <SUBGRAPH_DEPLOY_KEY>
       npx graph deploy aftr subgraph.yaml --version-label v0.08

  5. Studio UI: https://thegraph.com/studio/ → your subgraph → Deploy new version
     (upload after local \`npm run subgraph:build\` if CLI keeps failing)
`);
process.exit(1);
