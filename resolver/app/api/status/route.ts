import { NextResponse } from "next/server";
import { getLastCycle } from "../../../lib/run-cycle";
import { resolverStatus } from "../../../lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: await resolverStatus(),
    cycle: getLastCycle(),
  });
}
