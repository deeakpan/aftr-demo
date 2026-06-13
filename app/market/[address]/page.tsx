import { getAddress, isAddress } from "viem";
import { MarketDetailClient } from "@/app/market/[address]/market-detail-client";
import {
  loadMarketDetailForPage,
  serializeMarketDetail,
} from "@/lib/markets/load-markets";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export default async function MarketAddressPage({ params }: Props) {
  const { address } = await params;
  let initialMarket = null;
  let initialLoadError: string | null = null;

  if (isAddress(address)) {
    try {
      const market = await loadMarketDetailForPage(getAddress(address) as `0x${string}`);
      initialMarket = serializeMarketDetail(market);
    } catch (error) {
      initialLoadError =
        error instanceof Error ? error.message : "Could not load market.";
    }
  }

  return (
    <MarketDetailClient
      address={address}
      initialMarket={initialMarket}
      initialLoadError={initialLoadError}
    />
  );
}
