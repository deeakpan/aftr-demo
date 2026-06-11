import { Orbitron } from "next/font/google";

/** Sci-fi display face for Mondalore brand words (distinct from body Geist). */
export const brandFont = Orbitron({
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const brandPageTitle = `${brandFont.className} font-semibold tracking-wide text-[var(--accent)] [html[data-theme=light]_&]:text-[#6d28d9]`;

export const brandSectionLabel = `${brandFont.className} text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)] [html[data-theme=light]_&]:text-[#6d28d9]`;

/** Orbitron section title above cards — foreground, not accent purple. */
export const brandSectionHeading = `${brandFont.className} text-lg font-semibold tracking-wide text-[var(--foreground)] md:text-xl`;

export const brandSectionSubheading = "text-sm text-[var(--muted)]";

export const brandWord = `${brandFont.className} font-semibold tracking-wide text-[var(--accent)] [html[data-theme=light]_&]:text-[#6d28d9]`;
