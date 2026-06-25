/**
 * Registers ts-node so scripts can import lib/nad/*.ts and lib/ipfs-metadata.ts.
 */
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    esModuleInterop: true,
    target: "ES2020",
    strict: false,
    skipLibCheck: true,
    baseUrl: projectRoot,
    paths: { "@/*": ["./*"] },
  },
});
