import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return trimmed.toLowerCase();
}

export async function GET(req: NextRequest) {
  const address = normalizeAddress(req.nextUrl.searchParams.get("address") ?? "");
  if (!address) {
    return NextResponse.json({ error: "Invalid address." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("address,name")
      .eq("address", address)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
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
    const { data, error } = await supabase
      .from("profiles")
      .upsert({ address, name }, { onConflict: "address" })
      .select("address,name")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save profile." },
      { status: 500 },
    );
  }
}
