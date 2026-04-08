/* eslint-disable no-console */
/**
 * Build UMIP-181 MULTIPLE_CHOICE_QUERY ancillary JSON for AFTR markets.
 * Option values are "0".."N-1" so on-chain settlement maps directly to outcome indices.
 *
 * Usage:
 *   node scripts/build-mcq-ancillary.cjs "Title" "Description line 1" "Opt A" "Opt B" "Opt C"
 *
 * Outputs UTF-8 JSON (paste into EventMarketParams.umaAncillary).
 */
const title = process.argv[2];
const description = process.argv[3];
const labels = process.argv.slice(4);

if (!title || !description || labels.length < 2) {
  console.error(
    'Usage: node scripts/build-mcq-ancillary.cjs "<title>" "<description>" <label0> <label1> [label2 ...]',
  );
  process.exit(1);
}

function esc(s) {
  return JSON.stringify(s).slice(1, -1);
}

const options = labels.map((label, i) => {
  return `["${esc(label)}","${i}"]`;
});

const json = `{"title":"${esc(title)}","description":"${esc(description)}","options":[${options.join(",")}]}`;

if (Buffer.byteLength(json, "utf8") > 8192) {
  console.error("Ancillary exceeds 8192 bytes (UMA limit).");
  process.exit(1);
}

console.log(json);
