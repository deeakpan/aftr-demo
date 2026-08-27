import { getAddress, isAddress } from "viem";
import { redirect } from "next/navigation";
import { MarketDetailClient } from "@/app/market/[address]/market-detail-client";
import { findMarketBySlug } from "@/lib/markets/find-by-slug";
import {
  loadMarketDetailForPage,
  serializeMarketDetail,
} from "@/lib/markets/load-markets";
import { marketPath, normalizeMarketSlug } from "@/lib/markets/market-url";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

export default async function MarketAddressPage({ params }: Props) {
  const { address: param } = await params;
  let initialMarket = null;
  let initialLoadError: string | null = null;
  let resolvedAddress = "";

  try {
    if (isAddress(param)) {
      const market = await loadMarketDetailForPage(getAddress(param) as `0x${string}`);
      initialMarket = serializeMarketDetail(market);
      resolvedAddress = market.address;
    } else {
      // Legacy vanity slug → permanent redirect to address URL.
      const slug = normalizeMarketSlug(decodeURIComponent(param));
      const hit = slug ? await findMarketBySlug(slug) : null;
      if (hit) {
        redirect(marketPath({ address: hit.address }));
      }
      initialLoadError = "Market not found.";
      resolvedAddress = "";
    }
  } catch (error) {
    // `redirect()` throws; rethrow so Next can handle it.
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
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
