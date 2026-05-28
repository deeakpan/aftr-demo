"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/app/components/app-layout";

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
                How AFTR Market Works
              </h1>
              <p className="text-sm text-[var(--muted)] md:text-base">
                AFTR Market is an onchain prediction market on Base inspired by the Undead team. Users
                trade probabilities across event categories including crypto, macro, politics, sports,
                and culture.
              </p>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Through AFTR Market&apos;s partnership with the{" "}
                <a
                  href="https://dead.box"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  dead.box
                </a>{" "}
                ecosystem, AFTR can operate as a trusted vault manager where users can route prediction
                profits toward outstanding debt repayment flows.
              </p>
              <div className="pt-1">
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">
                  Collateral: USDC, ETH and USDeAD
                </p>
                <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                  <div className="flex items-center gap-2">
                    <img
                      src="https://assets.coingecko.com/coins/images/6319/large/usdc.png"
                      alt="USDC"
                      className="h-6 w-6 rounded-full"
                    />
                    <span>USDC</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img
                      src="https://assets.coingecko.com/coins/images/279/large/ethereum.png"
                      alt="ETH"
                      className="h-6 w-6 rounded-full"
                    />
                    <span>ETH</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img src="/usdead.jpg" alt="USDeAD" className="h-6 w-6 rounded-full object-cover" />
                    <span>USDeAD</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="traders" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For Traders</h2>
              <ol className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>1. Connect wallet and fund collateral.</li>
                <li>2. Pick a market and select an outcome (Yes / No or multi-outcome).</li>
                <li>3. Place market trades, and use limit orders where available.</li>
                <li>4. Track probability and position as pools update in real time.</li>
                <li>5. After settlement, redeem winning shares for collateral.</li>
              </ol>
            </section>

            <section id="creators" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For Creators</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                AFTR is permissionless: creators can launch markets and earn from trading activity.
                In this deployment, each trade applies a 1.5% total fee split into 0.3% creator fee
                and 1.2% protocol fee.
              </p>
              <ol className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>1. Create a market with title, metadata, outcomes, and times.</li>
                <li>2. Choose market type: Price (Chainlink) or Event (UMA).</li>
                <li>3. Set stake close and resolve-after timestamps.</li>
                <li>4. Seed initial liquidity with one-time permissionless bootstrap liquidity.</li>
                <li>5. Market opens for trading, and creator fees accrue as users trade.</li>
              </ol>
            </section>

            <section id="stakers" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For Stakers</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Stakers secure long-term alignment by staking AFTR and receiving non-transferable
                sAFTR receipts 1:1. Protocol fees route through the AFTR fee vault and are split
                between stakers and treasury.
              </p>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>- Market protocol fee is 1.2% per trade.</li>
                <li>- Of incoming vault fees, 0.2% is distributed to stakers pro-rata.</li>
                <li>- The remaining 1.0% accrues to treasury per vault rules.</li>
                <li>- Unstaking is timelocked: initiate unstake, wait lock duration, then complete.</li>
              </ul>
            </section>

            <section id="settlement" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Settlement</h2>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>- Price markets settle from Chainlink data at resolve time.</li>
                <li>- Event markets settle through UMA Optimistic Oracle flow.</li>
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
