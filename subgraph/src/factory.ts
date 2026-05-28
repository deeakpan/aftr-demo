import { MarketCreated } from "../generated/Factory/Factory";
import { Market as MarketTemplate } from "../generated/templates";
import { Market as MarketEntity } from "../generated/schema";
import { addrId } from "./ids";

export function handleMarketCreated(event: MarketCreated): void {
  const marketAddr = event.params.market;
  const id = addrId(marketAddr);

  const m = new MarketEntity(id);
  m.kind = event.params.kind;
  m.collateralToken = addrId(event.params.collateralToken);
  m.stakeEndTimestamp = event.params.stakeEndTimestamp;
  m.resolveAfterTimestamp = event.params.resolveAfterTimestamp;
  m.metadataHash = event.params.metadataHash.toHexString();
  m.creator = addrId(event.params.creator);
  m.createdAt = event.block.timestamp;
  m.createdAtBlock = event.block.number;
  m.save();

  MarketTemplate.create(marketAddr);
}
