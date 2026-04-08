"use client";

type MarketPreviewModalProps = {
  isOpen: boolean;
  marketKind: "event" | "price";
  eventMode: "binary" | "multiple";
  previewImageSrc: string;
  effectiveTitle: string;
  description: string;
  selectedCategories: string[];
  stakeEndAt: string;
  resolveAfterAt: string;
  seedAmount: string;
  usdcBalanceLabel: string;
  umaAncillary: string;
  metadataUri: string;
  isSubmittingMarket: boolean;
  submitStatus: string;
  createdMarketAddress: string;
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
  stakeEndAt,
  resolveAfterAt,
  seedAmount,
  usdcBalanceLabel,
  umaAncillary,
  metadataUri,
  isSubmittingMarket,
  submitStatus,
  createdMarketAddress,
  onBack,
  onCreateMarket,
}: MarketPreviewModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="relative h-36 w-full overflow-hidden border-b border-[var(--border)] bg-[var(--surface)] md:h-40">
          {previewImageSrc ? (
            <img src={previewImageSrc} alt="Market cover preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              No cover image selected
            </div>
          )}
          <div className="absolute left-3 top-3 inline-flex items-center rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {marketKind === "event" ? `Event · ${eventMode}` : "Price"}
          </div>
        </div>

        <div className="p-4 md:p-5">
          <h3 className="text-base font-semibold leading-tight text-[var(--foreground)] md:text-lg">
            {effectiveTitle || "Untitled market"}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)] md:text-sm">
            {description || "No description provided."}
          </p>

          {selectedCategories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedCategories.map((category) => (
                <span
                  key={category}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]"
                >
                  {category}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs md:grid-cols-2">
            <p className="text-[var(--muted)]">
              Stake ends: <span className="text-[var(--foreground)]">{stakeEndAt || "-"}</span>
            </p>
            <p className="text-[var(--muted)]">
              Resolve after: <span className="text-[var(--foreground)]">{resolveAfterAt || "-"}</span>
            </p>
            <p className="text-[var(--muted)]">
              Seed liquidity: <span className="text-[var(--foreground)]">{seedAmount || "0"} USDC</span>
            </p>
            <p className="text-[var(--muted)]">
              Wallet balance: <span className="text-[var(--foreground)]">{usdcBalanceLabel} USDC</span>
            </p>
          </div>

          {marketKind === "event" && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
                Ancillary data
              </p>
              <pre className="mt-1.5 max-h-28 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] leading-relaxed text-[var(--muted)]">
                {umaAncillary}
              </pre>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onCreateMarket}
              disabled={isSubmittingMarket}
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingMarket ? "Processing..." : "Create market"}
            </button>
          </div>
          {submitStatus && <p className="mt-2 text-xs text-[var(--muted)]">{submitStatus}</p>}
          {createdMarketAddress && (
            <p className="mt-1 text-xs text-[var(--accent)]">Market: {createdMarketAddress}</p>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--muted)] md:px-5">
          {metadataUri ? `Metadata ready: ${metadataUri}` : "Metadata will appear after upload completes."}
        </div>
      </div>
    </div>
  );
}
