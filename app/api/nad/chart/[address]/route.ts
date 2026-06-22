import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { fetchNadChart } from "@/lib/nad/api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ address: string }> };

export async function GET(req: Request, context: RouteContext) {
  const raw = (await context.params).address?.trim() ?? "";
  if (!raw || !isAddress(raw)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  const url = new URL(req.url);
  const resolution = url.searchParams.get("resolution") ?? "60";
  const countback = Number(url.searchParams.get("countback") ?? "120");
  const chartType = url.searchParams.get("chart_type") ?? "price_usd";

  try {
    const token = getAddress(raw);
    const data = await fetchNadChart(token, { resolution, countback, chartType });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nad chart error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
