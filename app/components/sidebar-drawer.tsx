"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Coins,
  CrosshairSimple,
  DiamondsFour,
  List,
  PlusMinus,
  Question,
  Rows,
  TelegramLogo,
  XLogo,
} from "@phosphor-icons/react";
import { docsUrl } from "@/lib/docs-url";

type SidebarDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  theme?: "dark" | "light";
};

const NAV = [
  { href: "/", label: "Markets", Icon: Rows, iconClass: "text-[#7fd0ff]", match: "markets" as const },
  { href: "/create", label: "Create Market", Icon: DiamondsFour, iconClass: "text-[#d8a3ff]", match: "prefix" as const },
  { href: "/trades", label: "Trades", Icon: PlusMinus, iconClass: "text-[#7fd0ff]", match: "prefix" as const },
  { href: "/stake", label: "Stake", Icon: Coins, iconClass: "text-[#6dff8e]", match: "prefix" as const },
  { href: "/bounty-board", label: "Bounty Board", Icon: CrosshairSimple, iconClass: "text-[#ffbf47]", match: "prefix" as const },
];

function isActive(pathname: string, href: string, match: "markets" | "prefix") {
  if (match === "markets") {
    return pathname === "/" || pathname === "/market" || pathname.startsWith("/market/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarDrawer({ isOpen, onClose, theme = "dark" }: SidebarDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const logoSrc = theme === "light" ? "/light.png" : "/logo.png";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[100] bg-black/60 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`sidebar-scroll fixed inset-y-0 left-0 z-[110] flex h-dvh w-[272px] max-w-[82vw] flex-col bg-black px-4 pb-5 pt-4 transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between gap-2">
          <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-2">
            <span className="relative block h-8 w-8 shrink-0">
              <Image
                src={logoSrc}
                alt="Zedkr Market"

                fill
                className="object-contain object-center"
                sizes="32px"
              />
            </span>
            <span className="truncate text-base font-semibold tracking-tight text-white">
              Zedkr
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="flex h-9 w-9 shrink-0 items-center justify-center text-white"
          >
            <List size={22} weight="bold" />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, Icon, iconClass, match }) => {
            const active = isActive(pathname, href, match);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium text-white transition ${
                  active ? "bg-[#1a1a1c]" : "hover:bg-[#1a1a1c]/70"
                }`}
              >
                <Icon size={22} weight="fill" className={`shrink-0 ${iconClass}`} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col">
          <a
            href={docsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="mb-4 flex items-center gap-3 rounded-full bg-[#1a1a1c] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[#222226]"
          >
            <Question size={22} weight="fill" className="shrink-0 text-[#ff8ca8]" />
            <span>Help & Feedback</span>
          </a>

          <div className="border-t border-white/10 pt-4">
            <div className="flex flex-col gap-2 text-sm text-[var(--foreground)]">
              <Link href="/how-it-works" onClick={onClose} className="hover:underline">
                How it works
              </Link>
              <a
                href={docsUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Docs
              </a>
            </div>
            <p className="mt-4 text-xs text-white/80">© 2026 All rights reserved</p>
            <div className="mt-3 flex items-center gap-2">
              <a
                href="#"
                aria-label="Twitter"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 text-white/80 transition hover:text-white"
              >
                <XLogo size={14} weight="bold" />
              </a>
              <a
                href="https://zedkr.finance"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Zedkr"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 text-white/80 transition hover:text-white"
              >
                <TelegramLogo size={14} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
