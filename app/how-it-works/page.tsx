"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/app/components/app-layout";
import { brandWord } from "@/lib/brand-font";
import { ETH_COINGECKO_LOGO, USDC_COINGECKO_LOGO } from "@/lib/brand-assets";
import { COMPANY_NAME, COMPANY_URL, PRODUCT_NAME } from "@/lib/product";
import { NATIVE_CURRENCY_SYMBOL } from "@/lib/chain";

const brand = brandWord;

const sections = [
  { id: "overview", label: "Overview" },
  { id: "traders", label: "For traders" },
  { id: "creators", label: "For creators" },
  { id: "stakers", label: "For stakers" },
  { id: "settlement", label: "Settlement" },
  { id: "pons-markets", label: "Ponsfamily markets" },
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
      <div className="mx-auto w-full max-w-[90rem] px-4 pb-12 pt-2 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav className="sticky top-24 space-y-1">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={`block border-l-2 pl-3 text-sm transition ${
                    activeSection === section.id
                      ? "border-[var(--foreground)] text-[var(--foreground)]"
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
                How <span className={brand}>{PRODUCT_NAME}</span> works
              </h1>
              <p className="text-sm text-[var(--muted)] md:text-base">
                <span className={brand}>{PRODUCT_NAME}</span> is a prediction-market product from{" "}
                <a
                  href={COMPANY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--foreground)] underline underline-offset-2 hover:opacity-90"
                >
                  {COMPANY_NAME}
                </a>
                , built for Robinhood Chain. Create and trade markets on oracle prices, real-world
                events, and Ponsfamily tokens. Pools, trades, and settlement are onchain.
              </p>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Fees from trading accrue to market creators and protocol stakers. Explore the rest of
                the {COMPANY_NAME} suite — including off-ramp and commerce — at{" "}
                <a
                  href={COMPANY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--foreground)] underline underline-offset-2 hover:opacity-90"
                >
                  zedkr.finance
                </a>
                .
              </p>
              <div className="pt-1">
                <p className="mb-2 text-sm font-medium text-[var(--foreground)]">
                  Collateral: USDC and {NATIVE_CURRENCY_SYMBOL}
                </p>
                <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                  <div className="flex items-center gap-2">
                    <img src={USDC_COINGECKO_LOGO} alt="USDC" className="h-6 w-6 rounded-full" />
                    <span>USDC</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <img src={ETH_COINGECKO_LOGO} alt={NATIVE_CURRENCY_SYMBOL} className="h-6 w-6 rounded-full" />
                    <span>{NATIVE_CURRENCY_SYMBOL}</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="traders" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For traders</h2>
              <ol className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>1. Connect a wallet on Robinhood Chain and fund collateral (USDC or {NATIVE_CURRENCY_SYMBOL}).</li>
                <li>2. Open a market and select an outcome (Yes / No, or a multi-outcome set).</li>
                <li>3. Place a market trade, or a limit order where the book is available.</li>
                <li>4. Watch probability and position as pool balances update.</li>
                <li>5. After settlement, redeem winning shares for collateral.</li>
              </ol>
            </section>

            <section id="creators" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For creators</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Anyone can list a market. In this deployment, each trade takes a 1.0% fee: 0.6% to the
                creator and 0.4% to the protocol.
              </p>
              <ol className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>1. Create a market with title, outcomes, cover, and schedule.</li>
                <li>
                  2. Choose a type: Price (Chainlink), Event (community resolution), or Ponsfamily
                  (graduated Uniswap v4 token stats).
                </li>
                <li>3. Set stake-close and resolve-after times.</li>
                <li>4. Seed initial liquidity so the market can open.</li>
                <li>5. Creator fees accrue as traders take positions.</li>
              </ol>
            </section>

            <section id="stakers" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">For stakers</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Staking the protocol token mints a non-transferable receipt 1:1. Protocol fees flow
                through the fee vault and are split between stakers and treasury.
              </p>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>- Market protocol fee is 0.4% per trade.</li>
                <li>- Of incoming vault fees, 0.2% is distributed to stakers pro-rata.</li>
                <li>- The remaining 1.0% accrues to treasury per vault rules.</li>
                <li>- Each deposit unlocks after the minimum lock; withdraw once unlocked.</li>
                <li>- Topping up starts a new lock and does not reset earlier deposits.</li>
              </ul>
            </section>

            <section id="settlement" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Settlement</h2>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>
                  - Price markets read Chainlink at resolve time. After the resolve-after timestamp,
                  anyone can trigger settlement.
                </li>
                <li>
                  - Event markets are resolved by protocol admins, who review the creator&apos;s
                  sources and confirm the winning outcome.
                </li>
                <li>
                  - Ponsfamily markets settle from on-chain Uniswap v4 price and Chainlink USD
                  conversion at resolve time (market cap or token price, per the question).
                </li>
                <li>- Winners redeem outcome shares for collateral after settlement.</li>
                <li>- Trades and pool updates are publicly verifiable on Robinhood Chain.</li>
              </ul>
            </section>

            <section id="pons-markets" className="scroll-mt-24 space-y-3">
              <h2 className="text-xl font-semibold text-[var(--foreground)]">Ponsfamily markets</h2>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Ponsfamily markets are predictions on tokens that have graduated to Uniswap v4 on
                Robinhood Chain, with more than 5 ETH of DEX liquidity. Paste a token contract
                address from{" "}
                <a
                  href="https://ponsfamily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--foreground)] underline underline-offset-2 hover:opacity-90"
                >
                  Ponsfamily
                </a>
                . Traders take positions on USD market cap, token price, or which token leads in a
                head-to-head.
              </p>
              <p className="text-sm text-[var(--muted)] md:text-base">
                Live cards show pool-implied stats while the market is open. After{" "}
                <strong>resolve after</strong>, settlement reads the Uniswap v4 pool and finalizes
                the winner automatically — no admin vote.
              </p>
              <ul className="space-y-2 text-sm text-[var(--foreground)] md:text-base">
                <li>
                  - Copy token addresses from{" "}
                  <a
                    href="https://ponsfamily.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--foreground)] underline underline-offset-2"
                  >
                    ponsfamily.com
                  </a>
                  .
                </li>
                <li>- Threshold markets: Yes/No on market cap or price above a target.</li>
                <li>- Comparison markets: two to four tokens; highest market cap at resolve wins.</li>
              </ul>
            </section>
          </main>
        </div>
      </div>
    </AppLayout>
  );
}
