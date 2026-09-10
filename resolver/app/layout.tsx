import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zedkr resolver",
  description: "Poll subgraph + factory and settle PRICE / PONS markets past resolve time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">{children}</body>
    </html>
  );
}
