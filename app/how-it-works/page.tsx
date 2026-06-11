"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/app/components/app-layout";
import { brandPageTitle, brandWord } from "@/lib/brand-font";
import { MON_COINGECKO_LOGO, USDC_COINGECKO_LOGO } from "@/lib/brand-assets";

const brandMondalore = brandWord;
const brandPartner =
  "font-mono text-sm font-semibold tracking-wide text-[var(--foreground)] underline decoration-[var(--accent)] decoration-2 underline-offset-[3px] md:text-base";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "traders", label: "For Traders" },
  { id: "creators", label: "For Creators" },
  { id: "stakers", label: "For Stakers" },
  { id: "settlement", label: "Settlement" },
];

export default function HowItWorksPage() {
  const [activeSection, setActiveSection] = useState<string>(sections[0]!.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0.25, 0.5, 0.75] },
    );

    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <AppLayout showSearch={false}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-2 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={`block border-l-2 pl-3 text-sm transition ${
                    activeSection === section.id
                      ? "border-[var(--accent)] text-[var(--foreground)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {section.label}
                </a>
              ))}
            </nav>
          </aside>

          <main className="space-y-10">
            <section id="overview" className="scroll-mt-24 space-y-3">
              <h1 className="text-2xl font-bold text-[var(--foreground)] md:text-3xl">
                How <span className={brandMondalore}>Mondalore Market</span> Works
              </h1>
              <p className="text-sm text-[var(--muted)] md:text-base">
                <span className={brandMondalore}>Mondalore</span> is a planet of predictions — inspired
                by the Mandalorian worlds of Star Wars, reimagined as an onchain market where traders,
                creators, and stakers can all earn. Built in collaboration with the{" "}
                <span className={brandPartner}>Anago CTO community</span> on Monad testnet.
              </p>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Launch and trade markets on real-world events and oracle-backed prices. Pools are
                transparent, settlement is onchain, and fees flow back to creators and protocol
                stakers — everyone who helps the planet grow shares in the upside.
              </p>
              <div className="pt-1">
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">
                  Collateral: USDC and MON
                </p>
                <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                  <div className="flex items-center gap-2">
                    <img
                      src={USDC_COINGECKO_LOGO}
                      alt="USDC"
                      className="h-6 w-6 rounded-full"
                    />
                    <span>USDC</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img src={MON_COINGECKO_LOGO} alt="MON" className="h-6 w-6 rounded-full" />
                    <span>MON</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="traders" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For Traders</h2>
              <ol className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>1. Connect wallet and fund collateral (USDC or MON).</li>
                <li>2. Pick a market and select an outcome (Yes / No or multi-outcome).</li>
                <li>3. Place market trades, and use limit orders where available.</li>
                <li>4. Track probability and position as pools update in real time.</li>
                <li>5. After settlement, redeem winning shares for collateral.</li>
              </ol>
            </section>

            <section id="creators" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For Creators</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                <span className={brandMondalore}>Mondalore</span> is permissionless: creators can launch
                markets and earn from trading activity. In this deployment, each trade applies a 1.5%
                total fee split into 0.3% creator fee and 1.2% protocol fee.
              </p>
              <ol className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>1. Create a market with title, metadata, outcomes, and times.</li>
                <li>2. Choose market type: Price (Chainlink) or Event (community resolution).</li>
                <li>3. Set stake close and resolve-after timestamps.</li>
                <li>4. Seed initial liquidity with one-time permissionless bootstrap liquidity.</li>
                <li>5. Market opens for trading, and creator fees accrue as users trade.</li>
              </ol>
            </section>

            <section id="stakers" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For Stakers</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Stakers align with the protocol by staking MONDO and receiving non-transferable
                sMONDO receipts 1:1. Protocol fees route through the Mondalore fee vault and are split
                between stakers and treasury.
              </p>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>- Market protocol fee is 1.2% per trade.</li>
                <li>- Of incoming vault fees, 0.2% is distributed to stakers pro-rata.</li>
                <li>- The remaining 1.0% accrues to treasury per vault rules.</li>
                <li>- Each deposit unlocks after the min lock duration; withdraw instantly once unlocked.</li>
                <li>- Topping up stake starts a new lock — it does not reset earlier deposits.</li>
              </ul>
            </section>

            <section id="settlement" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Settlement</h2>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>
                  - Price markets read Chainlink at resolve time. Once the resolve-after timestamp
                  passes, anyone can call settlement and the market finalizes in seconds.
                </li>
                <li>
                  - Event markets settle via community admin signatures (3-of-10 factory admins).
                  Each signature is bound to a specific market and outcome; anyone can submit
                  settlement once enough valid signatures are collected.
                </li>
                <li>- Winners redeem outcome shares for collateral after settlement.</li>
                <li>- Market trades and pool moves are publicly verifiable onchain.</li>
              </ul>
            </section>
          </main>
        </div>
      </div>
    </AppLayout>
  );
}
