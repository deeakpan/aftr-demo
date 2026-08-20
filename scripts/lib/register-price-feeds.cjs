/**
 * Register deployment JSON chainlinkFeeds on MondaloreParimutuelMarketFactory (owner-only setPriceFeed).
 */
function assetKey(ethers, symbol) {
  return ethers.keccak256(ethers.toUtf8Bytes(symbol.trim().toUpperCase()));
}

/**
 * @param {import('ethers').Contract} factory
 * @param {import('ethers').ContractRunner} signer
 * @param {{ asset: string; address: string }[]} feeds
 */
async function registerPriceFeedsOnFactory(factory, feeds, ethers) {
  let registered = 0;
  let skipped = 0;
  for (const feed of feeds) {
    const sym = feed.asset?.trim();
    const addr = feed.address?.trim();
    if (!sym || !addr || !ethers.isAddress(addr)) {
      skipped++;
      continue;
    }
    const key = assetKey(ethers, sym);
    const existing = await factory.priceFeeds(key);
    if (existing.toLowerCase() === addr.toLowerCase()) {
      console.log(`  priceFeeds[${sym}] already ${addr} ✓`);
      skipped++;
      continue;
    }
    const tx = await factory.setPriceFeed(key, addr);
    await tx.wait();
    console.log(`  priceFeeds[${sym}] = ${addr} ✓`);
    registered++;
  }
  return { registered, skipped };
}

module.exports = { assetKey, registerPriceFeedsOnFactory };
