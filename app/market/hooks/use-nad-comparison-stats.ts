"use client";

import { useEffect, useState } from "react";
import { parseNadMarketStats, type NadLiveStats } from "@/lib/nad/market-stats";
import type { NadTokenRef } from "@/lib/nad/types";

export function useNadComparisonStats(
  tokens: NadTokenRef[],
  enabled: boolean,
  externalStats?: (NadLiveStats | null)[],
) {
  const [stats, setStats] = useState<(NadLiveStats | null)[]>(externalStats ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (externalStats !== undefined) {
      setStats(externalStats);
      setLoading(false);
      return;
    }
    if (!enabled || tokens.length === 0) {
      setStats([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const results = await Promise.all(
        tokens.map(async (t) => {
          try {
            const res = await fetch(`/api/nad/token/${t.address}`);
            if (!res.ok) return null;
            const json = (await res.json()) as { market_info?: Record<string, unknown> };
            return parseNadMarketStats(json.market_info ?? null, { isGraduated: t.isGraduated });
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) {
        setStats(results);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, externalStats, tokens.map((t) => t.address.toLowerCase()).join(",")]);

  return { stats, loading };
}
