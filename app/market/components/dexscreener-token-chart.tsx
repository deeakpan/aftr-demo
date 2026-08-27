"use client";

import { useEffect, useState } from "react";
import { DEPLOYMENT_CHAIN_ID } from "@/lib/deployment";

type DexPair = {
  chainId?: string | number;
  pairAddress?: string;
  url?: string;
  liquidity?: { usd?: number };
};

type Props = {
  tokenAddress: string;
  className?: string;
  /** Called when DexScreener has no usable pair (parent can show market chart). */
  onAvailabilityChange?: (available: boolean) => void;
};

/**
 * Embeds a DexScreener chart when a pair exists for the token.
 * Returns null when DexScreener has nothing — caller should show market activity instead.
 */
export function DexScreenerTokenChart({
  tokenAddress,
  className = "",
  onAvailabilityChange,
}: Props) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEmbedUrl(null);
    onAvailabilityChange?.(false);

    const addr = tokenAddress.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) return;

    void (async () => {
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) throw new Error(`dexscreener ${res.status}`);
        const json = (await res.json()) as { pairs?: DexPair[] | null };
        const pairs = (json.pairs ?? []).filter((p) => p.pairAddress);
        if (pairs.length === 0) {
          if (!cancelled) {
            setEmbedUrl(null);
            onAvailabilityChange?.(false);
          }
          return;
        }

        const chainKey = String(DEPLOYMENT_CHAIN_ID);
        const preferred =
          pairs.find((p) => String(p.chainId) === chainKey) ??
          pairs.slice().sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;

        const chainSlug = String(preferred.chainId ?? chainKey);
        const pair = preferred.pairAddress!;
        const url = `https://dexscreener.com/${chainSlug}/${pair}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=0&chartType=usd&interval=15`;

        if (!cancelled) {
          setEmbedUrl(url);
          onAvailabilityChange?.(true);
        }
      } catch {
        if (!cancelled) {
          setEmbedUrl(null);
          onAvailabilityChange?.(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenAddress]);

  if (!embedUrl) return null;

  return (
    <div className={`overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] ${className}`}>
      <iframe
        title="DexScreener chart"
        src={embedUrl}
        className="h-[360px] w-full border-0"
        allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
      />
    </div>
  );
}
