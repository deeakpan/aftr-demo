export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RESOLVER_AUTORUN === "0") return;

  const g = globalThis as typeof globalThis & { __zedkrResolverLoop?: boolean };
  if (g.__zedkrResolverLoop) return;
  g.__zedkrResolverLoop = true;

  const intervalMs = Math.max(10_000, Number(process.env.RESOLVER_POLL_MS ?? 30_000) || 30_000);
  const { runCycle } = await import("./lib/run-cycle");

  const tick = async () => {
    try {
      const cycle = await runCycle({ dryRun: false });
      console.log(
        `[resolver] cycle due=${cycle.due.length} actions=${cycle.actions.length} subgraph=${cycle.subgraphOk} factory=${cycle.factoryOk}`,
      );
    } catch (error) {
      console.error("[resolver] cycle failed", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs);
}
