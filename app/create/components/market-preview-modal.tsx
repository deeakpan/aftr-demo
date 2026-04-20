"use client";

import Link from "next/link";

type MarketPreviewModalProps = {
  isOpen: boolean;
  marketKind: "event" | "price";
  eventMode: "binary" | "multiple";
  previewImageSrc: string;
  effectiveTitle: string;
  description: string;
  selectedCategories: string[];
  outcomes: string[];
  slug: string;
  stakeEndAt: string;
  resolveAfterAt: string;
  seedAmount: string;
  umaAncillary: string;
  metadataUri: string;
  isSubmittingMarket: boolean;
  submitStatus: string;
  createdMarketAddress: string;
  isCreateComplete: boolean;
  /** If true: preview-only mode, hides Create button */
  isReadOnly?: boolean;
  onBack: () => void;
  onCreateMarket: () => void;
};

export function MarketPreviewModal({
  isOpen,
  marketKind,
  eventMode,
  previewImageSrc,
  effectiveTitle,
  description,
  selectedCategories,
  outcomes,
  slug,
  stakeEndAt,
  resolveAfterAt,
  seedAmount,
  umaAncillary,
  metadataUri,
  isSubmittingMarket,
  submitStatus,
  createdMarketAddress,
  isCreateComplete,
  isReadOnly = false,
  onBack,
  onCreateMarket,
}: MarketPreviewModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        {/* Cover image */}
        <div className="relative h-28 w-full overflow-hidden border-b border-[var(--border)] bg-[var(--surface)] md:h-36">
          {previewImageSrc ? (
            <img src={previewImageSrc} alt="Market cover preview" className="h-full w-full object-cover object-center" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              No cover image selected
            </div>
          )}
          <div className="absolute left-3 top-3 inline-flex items-center rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">
            {marketKind === "event" ? `Event · ${eventMode}` : "Price"}
          </div>
          {isReadOnly && (
            <div className="absolute right-3 top-3 rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
              Preview
            </div>
          )}
        </div>

        <div className="p-4 md:p-5">
          {/* Title + slug */}
          <h3 className="text-sm font-semibold leading-tight text-[var(--foreground)] md:text-base">
            {effectiveTitle || "Untitled market"}
          </h3>
          {slug && (
            <p className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">/{slug}</p>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)] md:text-xs">
            {description || "No description provided."}
          </p>

          {/* Outcome labels */}
          {outcomes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {outcomes.slice(0, 6).map((label, i) => (
                <span key={i} className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold
                  ${i === 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : i === 1 ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}>
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Categories */}
          {selectedCategories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedCategories.map((category) => (
                <span key={category}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                  {category}
                </span>
              ))}
            </div>
          )}

          {/* Meta grid */}
          <div className="mt-3 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[11px] sm:grid-cols-2">
            <p className="text-[var(--muted)]">
              Stake ends: <span className="text-[var(--foreground)]">{stakeEndAt || "—"}</span>
            </p>
            <p className="text-[var(--muted)]">
              Resolve after: <span className="text-[var(--foreground)]">{resolveAfterAt || "—"}</span>
            </p>
            {!isReadOnly && (
              <p className="text-[var(--muted)]">
                Seed liquidity: <span className="text-[var(--foreground)]">{seedAmount || "0"} USDC</span>
              </p>
            )}
          </div>

          {/* Ancillary */}
          {marketKind === "event" && umaAncillary && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Ancillary data
              </p>
              <pre className="mt-1.5 max-h-24 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] leading-relaxed text-[var(--muted)]">
                {umaAncillary}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={onBack}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)]">
              {isReadOnly ? "Close" : "Back"}
            </button>
            {!isReadOnly && (
              isCreateComplete ? (
                <Link href="/market"
                  className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
                  View markets
                </Link>
              ) : (
                <button type="button" onClick={onCreateMarket} disabled={isSubmittingMarket}
                  className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60">
                  {isSubmittingMarket ? "Processing..." : "Create market"}
                </button>
              )
            )}
          </div>

          {submitStatus && (
            <p className="mt-2 text-xs text-[var(--muted)]">{submitStatus}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--muted)] md:px-5">
          {isReadOnly
            ? "Upload happens when you click Next — this is a local preview."
            : metadataUri
              ? `Metadata: ${metadataUri}`
              : "Metadata will appear after upload."}
        </div>
      </div>
    </div>
  );
}
