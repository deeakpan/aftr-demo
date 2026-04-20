"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CrownSimple,
  DiamondsFour,
  PlusMinus,
  Question,
  Rows,
  TelegramLogo,
  XLogo,
} from "@phosphor-icons/react";

type SidebarDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  theme?: "dark" | "light";
};

export function SidebarDrawer({ isOpen, onClose, theme = "dark" }: SidebarDrawerProps) {
  const pathname = usePathname();
  const logoSrc = theme === "light" ? "/light.png" : "/logo.png";

  const navClass = (href: string) =>
    `group flex w-full items-center gap-2 rounded-full px-3 py-3 text-left text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] ${
      pathname === href ? "bg-[var(--surface-hover)]" : ""
    }`;
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/65 transition-opacity ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`sidebar-scroll fixed inset-y-0 left-0 z-50 flex h-dvh w-[280px] max-w-[82vw] flex-col overflow-y-auto overscroll-contain border-r border-[var(--border)] bg-[var(--card)] p-5 transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative block h-20 w-20 shrink-0">
              <Image
                src={logoSrc}
                alt="AFTRMarket logo"
                fill
                className="object-contain object-center"
                sizes="80px"
              />
            </span>
            <p className="text-lg font-semibold">AFTRMarket</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-md px-2 py-1 text-base text-[var(--muted)]"
          >
            ✕
          </button>
        </div>

        <div className="mt-2 pr-1">
          <div className="space-y-1 text-base">
            <Link href="/" onClick={onClose} className={navClass("/")}>
              <Rows size={26} weight="fill" className="text-[#7fd0ff]" />
              <span>Markets</span>
            </Link>
            <Link href="/create" onClick={onClose} className={navClass("/create")}>
              <DiamondsFour size={26} weight="fill" className="text-[#d8a3ff]" />
              <span>Create Market</span>
            </Link>
            <Link href="/trades" onClick={onClose} className={navClass("/trades")}>
              <PlusMinus size={26} weight="fill" className="text-[#7fd0ff]" />
              <span>Trades</span>
            </Link>
            <button
              type="button"
              className="group flex w-full items-center gap-2 rounded-full px-3 py-3 text-left text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
            >
              <CrownSimple size={26} weight="fill" className="text-[#ffbf47]" />
              <span>Leaderboard</span>
            </button>
          </div>
          <div className="my-4 border-t border-[var(--border)]" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-full px-3 py-3 text-left text-base text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            <Question size={26} weight="fill" className="text-[#ff8ca8]" />
            <span>Help and feedbacks</span>
          </button>
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-base font-medium text-[var(--foreground)]">AFTRMarket</p>
          <p className="mt-1 text-sm text-[var(--foreground)]">
            Prediction markets on Base. Built for transparent market participation.
          </p>
          <div className="mt-3 flex items-center gap-3 text-[var(--muted)]">
            <a href="#" aria-label="Telegram" className="hover:text-[var(--foreground)]">
              <TelegramLogo size={22} weight="regular" />
            </a>
            <a href="#" aria-label="Twitter" className="hover:text-[var(--foreground)]">
              <XLogo size={22} weight="regular" />
            </a>
          </div>
          <p className="mt-3 text-sm text-[var(--foreground)]">© 2026 AFTRMarket. All rights reserved.</p>
        </div>
      </aside>
    </>
  );
}
