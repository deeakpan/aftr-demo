"use client";

import { useEffect, useId, useState } from "react";
import { CircleNotch, X } from "@phosphor-icons/react";
import { hasCatchAllOption, type PolymarketImportDraft } from "@/lib/polymarket/import";

type Props = {
  open: boolean;
  onClose: () => void;
  onImport: (draft: PolymarketImportDraft) => void | Promise<void>;
};

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const body = text.trim() || "No description";
  const long = body.length > 160 || body.includes("\n");

  return (
    <div>
      <p
        className={`whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted)] ${
          expanded ? "" : "line-clamp-2"
        }`}
      >
        {body}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-[var(--foreground)] transition hover:opacity-80"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

export function PolymarketImportModal({ open, onClose, onImport }: Props) {
  const titleId = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<PolymarketImportDraft | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setBusy(false);
    setError("");
    setDraft(null);
    setApplying(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applying) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, applying]);

  if (!open) return null;

  async function lookup() {
    setError("");
    setDraft(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/polymarket/import?url=${encodeURIComponent(url.trim())}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { draft?: PolymarketImportDraft; error?: string };
      if (!res.ok || !json.draft) {
        throw new Error(json.error || "Could not import that Polymarket link.");
      }
      setDraft(json.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import that Polymarket link.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!draft) return;
    setApplying(true);
    setError("");
    try {
      await onImport(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply import.");
    } finally {
      setApplying(false);
    }
  }

  const alreadyHasCatchAll = draft ? hasCatchAllOption(draft.outcomes) : false;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(88dvh,36rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[var(--card)] shadow-[0_24px_64px_rgb(0_0_0_/_0.45)]"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            Import from Polymarket
          </h2>
          <button
            type="button"
            aria-label="Close"
            disabled={applying}
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="styled-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Paste a Polymarket event or market link. We&apos;ll fill title, description, cover, and
              outcomes.
            </p>

            <div>
              <label className="mb-2 block text-xs font-medium text-[var(--muted)]">
                Polymarket URL
              </label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!busy && url.trim()) void lookup();
                  }
                }}
                placeholder="https://polymarket.com/event/…"
                className="h-11 w-full rounded-xl bg-[var(--surface)] px-3.5 text-sm text-[var(--foreground)] outline-none ring-0 placeholder:text-[var(--muted)]/70 focus:bg-[var(--surface-hover)]"
                autoFocus
                disabled={busy || applying}
              />
            </div>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            {draft ? (
              <div className="space-y-4">
                <div className="flex gap-3.5">
                  {draft.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/polymarket/image?url=${encodeURIComponent(draft.imageUrl)}`}
                      alt=""
                      className="h-[4.5rem] w-[7.5rem] shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-[4.5rem] w-[7.5rem] shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] text-[10px] text-[var(--muted)]">
                      No image
                    </div>
                  )}
                  <div className="min-w-0 flex-1 self-center py-0.5">
                    <p className="line-clamp-3 text-sm font-semibold leading-snug text-[var(--foreground)]">
                      {draft.title}
                    </p>
                    <p className="mt-2 text-[11px] font-medium text-[var(--muted)]">
                      {draft.eventMode === "multiple"
                        ? `${draft.outcomes.length} options`
                        : draft.outcomes.join(" · ")}
                    </p>
                  </div>
                </div>

                <ExpandableDescription text={draft.description} />

                {(draft.suggestedResolveAfterAt || draft.suggestedStakeEndAt) && (
                  <div className="space-y-1.5 text-xs text-[var(--muted)]">
                    <p className="font-medium text-[var(--foreground)]">Schedule</p>
                    {draft.suggestedStakeEndAt ? (
                      <p>
                        Stake ends{" "}
                        <span className="text-[var(--foreground)]">
                          {new Date(draft.suggestedStakeEndAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                        <span className="text-[var(--muted)]"> · derived (Poly has no stake end)</span>
                      </p>
                    ) : null}
                    {draft.suggestedResolveAfterAt ? (
                      <p>
                        Resolve after{" "}
                        <span className="text-[var(--foreground)]">
                          {new Date(draft.suggestedResolveAfterAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                        <span className="text-[var(--muted)]"> · from Polymarket end date</span>
                      </p>
                    ) : null}
                  </div>
                )}

                {draft.children.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--muted)]">Options</p>
                    <ul className="space-y-0.5">
                      {draft.outcomes.map((label) => (
                        <li
                          key={label}
                          className="rounded-lg px-2.5 py-2 text-sm text-[var(--foreground)]"
                        >
                          {label}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                      {alreadyHasCatchAll
                        ? "Imported as listed on Polymarket, including their catch-all option."
                        : "Imported exactly as listed on Polymarket — we don’t invent an “Other”."}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          {!draft ? (
            <button
              type="button"
              disabled={busy || !url.trim()}
              onClick={() => void lookup()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-45"
            >
              {busy ? <CircleNotch size={16} className="animate-spin" /> : null}
              {busy ? "Fetching…" : "Fetch"}
            </button>
          ) : (
            <button
              type="button"
              disabled={applying}
              onClick={() => void apply()}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-45"
            >
              {applying ? <CircleNotch size={16} className="animate-spin" /> : null}
              {applying ? "Applying…" : "Use this"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
