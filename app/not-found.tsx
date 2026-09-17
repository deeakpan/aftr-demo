import Link from "next/link";
import Image from "next/image";
import { PRODUCT_NAME } from "@/lib/product";

export default function NotFound() {
  return (
    <main className="aftr-page-bg-gradient relative flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 flex max-w-md flex-col items-center">
        <Link href="/" className="mb-10 inline-flex items-center gap-2.5 transition hover:opacity-90">
          <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="font-[family-name:var(--font-orbitron)] text-sm font-semibold tracking-wide text-[var(--foreground)]">
            {PRODUCT_NAME}
          </span>
        </Link>

        <p className="font-[family-name:var(--font-orbitron)] text-[4.5rem] font-bold leading-none tracking-tight text-[var(--foreground)] sm:text-[5.5rem]">
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold text-[var(--foreground)] sm:text-2xl">
          Market not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          This page doesn&apos;t exist or the market link is wrong.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-full bg-[var(--foreground)] px-5 text-sm font-semibold text-[var(--background)] transition hover:opacity-90"
          >
            Browse markets
          </Link>
          <Link
            href="/create"
            className="inline-flex h-11 items-center rounded-full border border-[var(--border)] bg-[var(--card)] px-5 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-hover)]"
          >
            Create market
          </Link>
        </div>
      </div>
    </main>
  );
}
