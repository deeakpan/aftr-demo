/**
 * Unit tests for NAD outcome evaluation (no network).
 */
const { expect } = require("chai");

require("../scripts/lib/register-ts.cjs");

const {
  evaluateNadOutcome,
  snapshotFromMarketInfo,
  firstChartCrossingUnix,
} = require("../lib/nad/evaluate-outcome.ts");

function snap(address, symbol, stats, mcapChart = null) {
  return snapshotFromMarketInfo(
    { address, symbol, name: symbol, imageUri: "" },
    {
      market_cap_usd: stats.marketCapUsd != null ? String(stats.marketCapUsd) : undefined,
      price_usd: stats.priceUsd != null ? String(stats.priceUsd) : undefined,
      holder_count: stats.holderCount ?? undefined,
    },
    { mcapChart },
  );
}

function baseCfg(overrides = {}) {
  return {
    version: 1,
    questionType: "mcap_usd_above",
    mode: "binary",
    tokens: [{ address: "0x1", symbol: "AAA", name: "A", imageUri: "" }],
    params: { thresholdUsd: "100000" },
    apiBaseUrl: "https://api.nad.fun",
    resolveAfterUnix: 1_700_000_000,
    stakeEndUnix: 1_699_000_000,
    resolutionEndpoints: [],
    cardBackgroundSeed: "0x1",
    duplicateKey: "test",
    ...overrides,
  };
}

describe("evaluateNadOutcome", function () {
  it("mcap_usd_above → Yes when at threshold", function () {
    const cfg = baseCfg();
    const snapshots = [snap("0x1", "AAA", { marketCapUsd: 150_000, priceUsd: 1, holderCount: 10 })];
    const r = evaluateNadOutcome(cfg, snapshots, 1_700_000_001);
    expect(r.outcomeIndex).to.equal(0);
    expect(r.outcomeLabel).to.equal("Yes");
  });

  it("mcap_usd_above → No when below threshold", function () {
    const cfg = baseCfg();
    const snapshots = [snap("0x1", "AAA", { marketCapUsd: 50_000, priceUsd: 1, holderCount: 10 })];
    const r = evaluateNadOutcome(cfg, snapshots, 1_700_000_001);
    expect(r.outcomeIndex).to.equal(1);
    expect(r.outcomeLabel).to.equal("No");
  });

  it("mcap_highest picks highest mcap token", function () {
    const cfg = baseCfg({
      questionType: "mcap_highest",
      mode: "comparison",
      tokens: [
        { address: "0x1", symbol: "AAA", name: "A", imageUri: "" },
        { address: "0x2", symbol: "BBB", name: "B", imageUri: "" },
      ],
    });
    const snapshots = [
      snap("0x1", "AAA", { marketCapUsd: 100_000, priceUsd: 1, holderCount: 1 }),
      snap("0x2", "BBB", { marketCapUsd: 250_000, priceUsd: 2, holderCount: 1 }),
    ];
    const r = evaluateNadOutcome(cfg, snapshots, 1_700_000_001);
    expect(r.outcomeIndex).to.equal(1);
    expect(r.outcomeLabel).to.equal("BBB");
  });

  it("mcap_threshold_first → Neither when no crossing", function () {
    const cfg = baseCfg({
      questionType: "mcap_threshold_first",
      mode: "comparison",
      params: { thresholdUsd: "1000000" },
      tokens: [
        { address: "0x1", symbol: "AAA", name: "A", imageUri: "" },
        { address: "0x2", symbol: "BBB", name: "B", imageUri: "" },
      ],
    });
    const snapshots = [
      snap("0x1", "AAA", { marketCapUsd: 50_000, priceUsd: 1, holderCount: 1 }),
      snap("0x2", "BBB", { marketCapUsd: 60_000, priceUsd: 2, holderCount: 1 }),
    ];
    const r = evaluateNadOutcome(cfg, snapshots, 1_700_000_001);
    expect(r.outcomeIndex).to.equal(2);
    expect(r.outcomeLabel).to.equal("Neither");
  });

  it("firstChartCrossingUnix finds earliest hit", function () {
    const chart = {
      k: "t",
      t: [100, 200, 300],
      c: ["10", "50", "200"],
      o: [],
      h: ["10", "200", "200"],
      l: [],
      v: [],
      s: "ok",
    };
    expect(firstChartCrossingUnix(chart, 100, 500)).to.equal(200);
  });
});
