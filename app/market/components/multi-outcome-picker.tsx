"use client";

type MultiOutcomePickerProps = {
  labels: string[];
  chancePcts: number[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export function MultiOutcomePicker({
  labels,
  chancePcts,
  selectedIndex,
  onSelect,
}: MultiOutcomePickerProps) {
  const pcts = labels.map((_, i) =>
    clampPct(chancePcts[i] ?? (i === 0 ? 50 : Math.round(50 / Math.max(1, labels.length - 1)))),
  );

  return (
    <div className="mb-6">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
        Outcomes
      </p>
      <div className="flex flex-col gap-2">
        {labels.map((label, i) => {
          const active = selectedIndex === i;
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => onSelect(i)}
              className={`flex min-h-[3rem] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent)]"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/30 hover:bg-[var(--surface-hover)]"
              }`}
            >
              <span
                className={`min-w-0 flex-1 truncate pr-3 text-sm font-semibold ${
                  active ? "text-[var(--foreground)]" : "text-[var(--foreground)]/90"
                }`}
              >
                {label}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--foreground)]">
                {pcts[i]!.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Tap an outcome to select it for trading.
      </p>
    </div>
  );
}
