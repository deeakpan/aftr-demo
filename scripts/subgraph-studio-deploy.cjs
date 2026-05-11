/* eslint-disable no-console */
/** Deploy subgraph to Subgraph Studio (uses SUBGRAPH_DEPLOY_KEY + slug aftr). */
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
const versionLabel = process.env.SUBGRAPH_VERSION_LABEL ?? "v0.07";

/** Local CLI from subgraph/node_modules (.cmd on Windows). `npx` spawn often exits 1 with no output on Win. */
const graphBin = path.join(
  subgraphDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "graph.cmd" : "graph",
);

/** Studio: `graph auth` then `graph deploy` (omit custom --ipfs; wrong studio IPFS URLs 404). */
const auth = spawnSync(graphBin, ["auth", dk], { cwd: subgraphDir, stdio: "inherit", shell: true });
if (auth.status !== 0) process.exit(auth.status ?? 1);

const r = spawnSync(
  graphBin,
  ["deploy", slug, "subgraph.yaml", "--version-label", versionLabel],
  { cwd: subgraphDir, stdio: "inherit", shell: true },
);

process.exit(r.status === 0 ? 0 : (r.status ?? 1));
