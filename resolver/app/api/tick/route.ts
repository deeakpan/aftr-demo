import { NextResponse } from "next/server";
import { getLastCycle, runCycle } from "../../../lib/run-cycle";
import { resolverStatus } from "../../../lib/status";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function allowSettle(req: Request): boolean {
  const secret = (process.env.RESOLVER_SECRET || process.env.CRON_SECRET || "").trim();
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

async function handle(req: Request, forceSettle: boolean) {
  const url = new URL(req.url);
  const dryParam = url.searchParams.get("dry");
  const settleParam = url.searchParams.get("settle");
  const dryRun =
    dryParam === "1" || dryParam === "true"
      ? true
      : settleParam === "1" || settleParam === "true" || forceSettle
        ? false
        : true;

  if (!dryRun && !allowSettle(req)) {
    return NextResponse.json({ error: "Unauthorized settle. Set RESOLVER_SECRET / CRON_SECRET." }, { status: 401 });
  }

  const [cycle, status] = await Promise.all([runCycle({ dryRun }), resolverStatus()]);
  return NextResponse.json({ status, cycle });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("statusOnly") === "1") {
    return NextResponse.json({
      status: await resolverStatus(),
      cycle: getLastCycle(),
    });
  }
  const settle = url.searchParams.get("settle") === "1" || url.searchParams.get("settle") === "true";
  return handle(req, settle);
}

export async function POST(req: Request) {
  return handle(req, true);
}
