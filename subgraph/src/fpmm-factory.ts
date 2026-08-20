import { MarketCreated, PriceFeedUpdated } from "../generated/FpmmFactory/FpmmFactory";
import { FpmmMarket as FpmmMarketTemplate } from "../generated/templates";
import { Market as MarketEntity, PriceFeed } from "../generated/schema";
import { addrId } from "./ids";

export function handleMarketCreated(event: MarketCreated): void {
  const marketAddr = event.params.market;
  const id = addrId(marketAddr);

  const m = new MarketEntity(id);
  m.kind = event.params.kind;
  m.state = 0;
  m.mechanism = "fpmm";
  m.collateralToken = addrId(event.params.collateralToken);
  m.stakeEndTimestamp = event.params.stakeEndTimestamp;
  m.resolveAfterTimestamp = event.params.resolveAfterTimestamp;
  m.metadataHash = event.params.metadataHash.toHexString();
  m.creator = addrId(event.params.creator);
  m.createdAt = event.block.timestamp;
  m.createdAtBlock = event.block.number;
  m.save();

  FpmmMarketTemplate.create(marketAddr);
}

export function handlePriceFeedUpdated(event: PriceFeedUpdated): void {
  const keyHex = event.params.assetKey.toHexString();
  let row = PriceFeed.load(keyHex);
  if (row == null) {
    row = new PriceFeed(keyHex);
    row.assetKey = event.params.assetKey;
  }
  row.feed = addrId(event.params.feed);
  row.updatedAt = event.block.timestamp;
  row.save();
}
