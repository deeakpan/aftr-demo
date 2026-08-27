import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return trimmed.toLowerCase();
}

function isTransientNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.message} ${error.cause ?? ""}` : String(error);
  return /fetch failed|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(
    msg,
  );
}

async function withSupabaseRetry<T>(
  run: () => Promise<{ data: T; error: { message: string } | null }>,
  attempts = 3,
): Promise<{ data: T; error: { message: string } | null }> {
  let last: { data: T; error: { message: string } | null } | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await run();
      if (!last.error) return last;
      if (!isTransientNetworkError(last.error.message) || i === attempts - 1) return last;
    } catch (error) {
      if (!isTransientNetworkError(error) || i === attempts - 1) throw error;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return last as { data: T; error: { message: string } | null };
}

function networkErrorResponse(error: unknown) {
  const detail = error instanceof Error ? error.message : "Could not reach Supabase.";
  return NextResponse.json(
    {
      error: isTransientNetworkError(error)
        ? "Supabase is unreachable (network timeout). Check connection / VPN and try again."
        : detail,
    },
    { status: 503 },
  );
}

export async function GET(req: NextRequest) {
  const address = normalizeAddress(req.nextUrl.searchParams.get("address") ?? "");
  if (!address) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await withSupabaseRetry(async () =>
      supabase.from("profiles").select("address,name").eq("address", address).maybeSingle(),
    );

    if (error) {
      if (isTransientNetworkError(error.message)) return networkErrorResponse(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    if (isTransientNetworkError(error)) return networkErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Profile lookup failed." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawAddress = typeof (body as { address?: unknown }).address === "string"
    ? (body as { address: string }).address
    : "";
  const rawName = typeof (body as { name?: unknown }).name === "string"
    ? (body as { name: string }).name
    : "";

  const address = normalizeAddress(rawAddress);
  const name = rawName.trim();

  if (!address) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (name.length > 40) {
    return NextResponse.json({ error: "Name must be 40 characters or less." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await withSupabaseRetry(async () =>
      supabase
        .from("profiles")
        .upsert({ address, name }, { onConflict: "address" })
        .select("address,name")
        .single(),
    );

    if (error) {
      if (isTransientNetworkError(error.message)) return networkErrorResponse(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    if (isTransientNetworkError(error)) return networkErrorResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save profile." },
      { status: 500 },
    );
  }
}
