"use client";

import { useState, type MouseEvent } from "react";
import { Check, ShareNetwork } from "@phosphor-icons/react";
import { marketPublicUrl } from "@/lib/markets/market-url";

type Props = {
  address: string;
  slug?: string | null;
  title?: string;
  className?: string;
  iconSize?: number;
};

export function MarketShareButton({
  address,
  slug,
  title,
  className = "",
  iconSize = 14,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function share(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const url = marketPublicUrl({ slug, address });
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: title || "Mondalore market", url });
        return;
      }
    } catch {
      // fall through to clipboard (user may cancel share sheet)
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void share(e)}
      className={`inline-flex items-center rounded p-0.5 transition hover:text-[var(--foreground)] ${className}`}
      aria-label={copied ? "Link copied" : "Share market"}
      title={copied ? "Copied" : "Share"}
    >
      {copied ? (
        <Check size={iconSize} weight="bold" className="text-emerald-500" />
      ) : (
        <ShareNetwork size={iconSize} weight="bold" />
      )}
    </button>
  );
}
