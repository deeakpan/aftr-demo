"use client";

import Link from "next/link";
import { MarketListCard } from "@/app/market/components/market-list-card";
import { formatMarketCardDate } from "@/lib/market-cover";

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
  seedSymbol: string;
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
  slug: _slug,
  stakeEndAt,
  resolveAfterAt,
  seedAmount,
  seedSymbol,
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

  const resolveLabel = formatMarketCardDate(resolveAfterAt);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[var(--overlay-scrim)] p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onBack();
      }}
    >
      <div
        className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Market card preview</h3>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
              {marketKind === "event" ? `Event · ${eventMode}` : "Price"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            This matches the card on the Markets page — same crop, layout, and footer.
          </p>
        </div>

        <div className="p-4">
          <MarketListCard
            title={effectiveTitle}
            imageUrl={previewImageSrc || undefined}
            outcomeLabels={outcomes}
            resolveAfter={resolveLabel}
            showNewBadge
            interactive={false}
          />
        </div>

        <div className="space-y-3 border-t border-[var(--border)] px-4 py-4 md:px-5">
          <p className="text-[11px] leading-relaxed text-[var(--muted)] md:text-xs">
            {description || "No description provided."}
          </p>

          {selectedCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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

          <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[11px] sm:grid-cols-2">
            <p className="text-[var(--muted)]">
              Stake ends: <span className="text-[var(--foreground)]">{stakeEndAt || "—"}</span>
            </p>
            <p className="text-[var(--muted)]">
              Resolve after: <span className="text-[var(--foreground)]">{resolveAfterAt || "—"}</span>
            </p>
            {!isReadOnly && (
              <p className="text-[var(--muted)]">
                Seed liquidity:{" "}
                <span className="text-[var(--foreground)]">
                  {seedAmount || "0"} {seedSymbol}
                </span>
              </p>
            )}
          </div>

          {marketKind === "event" && (
            <p className="text-[10px] leading-relaxed text-[var(--muted)]">
              After resolve time, settlement requires EIP-712 signatures from 3 of the factory&apos;s
              resolution admins (market + outcome specific).
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)]"
            >
              {isReadOnly ? "Close" : "Back"}
            </button>
            {!isReadOnly &&
              (isCreateComplete ? (
                <Link
                  href="/market"
                  className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  View markets
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onCreateMarket}
                  disabled={isSubmittingMarket}
                  className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmittingMarket ? "Processing..." : "Create market"}
                </button>
              ))}
          </div>

          {submitStatus && (
            <p
              className={`text-sm ${
                isCreateComplete || /successfully/i.test(submitStatus)
                  ? "font-bold text-emerald-400 [html[data-theme=light]_&]:text-emerald-700"
                  : /error|failed|insufficient|missing|invalid/i.test(submitStatus)
                    ? "font-semibold text-rose-400 [html[data-theme=light]_&]:text-rose-700"
                    : "font-medium text-[var(--foreground)]"
              }`}
            >
              {submitStatus}
            </p>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--muted)] md:px-5">
          {isReadOnly
            ? "Cover image is uploaded when you click Next — odds and volume appear after the market is live."
            : metadataUri
              ? `Metadata: ${metadataUri}`
              : "Metadata will appear after upload."}
        </div>
      </div>
    </div>
  );
}
