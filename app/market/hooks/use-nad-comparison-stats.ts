"use client";

import { useEffect, useState } from "react";
import type { NadLiveStats } from "@/lib/nad/market-stats";
import type { NadMarketConfig, NadTokenRef } from "@/lib/nad/types";
import {
  fetchLaunchpadTokenDisplay,
  isPonsDisplayMarket,
} from "@/lib/launchpad/fetch-token-display";

export function useNadComparisonStats(
  tokens: NadTokenRef[],
  enabled: boolean,
  externalStats?: (NadLiveStats | null)[],
  /** When provided, prefers Pons vs Nad API order from market config. */
  nadMarket?: NadMarketConfig | null,
) {
  const [stats, setStats] = useState<(NadLiveStats | null)[]>(externalStats ?? []);
  const [loading, setLoading] = useState(false);
  const preferPons = nadMarket ? isPonsDisplayMarket(nadMarket) : false;

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
          const row = await fetchLaunchpadTokenDisplay(t, preferPons);
          return row.stats;
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
  }, [enabled, externalStats, preferPons, tokens.map((t) => t.address.toLowerCase()).join(",")]);

  return { stats, loading };
}
