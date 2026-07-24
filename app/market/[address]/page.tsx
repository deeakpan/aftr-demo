import { getAddress, isAddress } from "viem";
import { MarketDetailClient } from "@/app/market/[address]/market-detail-client";
import { findMarketBySlug } from "@/lib/markets/find-by-slug";
import {
  loadMarketDetailForPage,
  serializeMarketDetail,
} from "@/lib/markets/load-markets";
import { normalizeMarketSlug } from "@/lib/markets/market-url";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export default async function MarketAddressPage({ params }: Props) {
  const { address: param } = await params;
  let initialMarket = null;
  let initialLoadError: string | null = null;
  /** Always a checksum address when known; may be empty while client resolves a slug. */
  let resolvedAddress = "";

  try {
    if (isAddress(param)) {
      const market = await loadMarketDetailForPage(getAddress(param) as `0x${string}`);
      initialMarket = serializeMarketDetail(market);
      resolvedAddress = market.address;
    } else {
      const slug = normalizeMarketSlug(decodeURIComponent(param));
      const hit = slug ? await findMarketBySlug(slug) : null;
      if (!hit) {
        // Don't treat as fatal — client will retry slug → address resolve.
        initialLoadError = null;
        resolvedAddress = "";
      } else {
        const market = await loadMarketDetailForPage(hit.address);
        initialMarket = serializeMarketDetail(market);
        resolvedAddress = market.address;
      }
    }
  } catch (error) {
    initialLoadError =
      error instanceof Error ? error.message : "Could not load market.";
  }

  return (
    <MarketDetailClient
      address={resolvedAddress || param}
      routeParam={param}
      initialMarket={initialMarket}
      initialLoadError={initialLoadError}
    />
  );
}
