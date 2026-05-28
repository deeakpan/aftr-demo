"use client";

import { useEffect, useRef } from "react";

export function TradingViewChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = "tv_chart_detail";
    let script: HTMLScriptElement | null = null;
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    function init() {
      const tv = (window as unknown as { TradingView?: { widget: new (o: unknown) => void } }).TradingView;
      const container = document.getElementById(id);
      if (!tv || !container) return;
      container.replaceChildren();
      new tv.widget({
        container_id: id,
        symbol,
        interval: "60",
        timezone: "Etc/UTC",
        theme: isLight ? "light" : "dark",
        style: "1",
        locale: "en",
        autosize: true,
        hide_top_toolbar: false,
        allow_symbol_change: false,
        save_image: false,
        backgroundColor: isLight ? "#f7f8ff" : "#050507",
        gridColor: isLight ? "rgba(124,77,255,0.08)" : "rgba(139,92,246,0.04)",
      });
    }
    if ((window as unknown as { TradingView?: unknown }).TradingView) init();
    else {
      script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = init;
      document.head.appendChild(script);
    }
    return () => {
      const container = document.getElementById(id);
      if (container) container.replaceChildren();
      if (script && document.head.contains(script)) document.head.removeChild(script);
    };
  }, [symbol]);
  return (
    <div ref={ref} className="h-[400px] w-full overflow-hidden rounded-xl border border-[var(--border)]">
      <div id="tv_chart_detail" className="h-full w-full" />
    </div>
  );
}
