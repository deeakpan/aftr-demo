"use client";

import { outcomeColor } from "@/app/market/lib/outcome-colors";

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
    <div>
      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {labels.map((label, i) => {
          const active = selectedIndex === i;
          const dot = outcomeColor(i);
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => onSelect(i)}
              className={`flex w-full items-center gap-3 px-0 py-3.5 text-left transition ${
                active
                  ? "bg-[var(--surface-hover)]/60"
                  : "hover:bg-[var(--surface-hover)]/35"
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--background)]"
                style={{ backgroundColor: dot }}
                aria-hidden
              />
              <span
                className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                  active ? "text-[var(--foreground)]" : "text-[var(--foreground)]/90"
                }`}
              >
                {label}
              </span>
              <span className="shrink-0 text-lg font-bold tabular-nums tracking-tight text-[var(--foreground)]">
                {pcts[i]!.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
