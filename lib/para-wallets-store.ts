import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, isAddress } from "viem";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export type StoredParaWallet = {
  owner: `0x${string}`;
  walletId: string;
  paraUserId?: string | null;
  email?: string | null;
  userIdentifier: string;
  updatedAt: number;
};

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/** Local dev fallback — never used on Vercel (read-only filesystem). */
function localStorePath(): string {
  if (process.env.VERCEL) return path.join("/tmp", "para-wallets.json");
  return path.join(process.cwd(), ".data", "para-wallets.json");
}

function rowFromDb(data: {
  owner: string;
  wallet_id: string;
  para_user_id?: string | null;
  email?: string | null;
  user_identifier: string;
  updated_at: number;
}): StoredParaWallet | null {
  if (!isAddress(data.owner) || !data.wallet_id?.trim()) return null;
  return {
    owner: getAddress(data.owner) as `0x${string}`,
    walletId: data.wallet_id.trim(),
    paraUserId: data.para_user_id ?? null,
    email: data.email ?? null,
    userIdentifier: data.user_identifier,
    updatedAt: data.updated_at,
  };
}

async function loadAllFromFile(): Promise<Record<string, StoredParaWallet>> {
  try {
    const raw = await readFile(localStorePath(), "utf8");
    return JSON.parse(raw) as Record<string, StoredParaWallet>;
  } catch {
    return {};
  }
}

async function saveAllToFile(rows: Record<string, StoredParaWallet>) {
  const file = localStorePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(rows, null, 2), "utf8");
}

async function getFromSupabase(owner: string): Promise<StoredParaWallet | null> {
  const supabase = getSupabaseAdminClient();
  const key = getAddress(owner).toLowerCase();
  const { data, error } = await supabase
    .from("para_wallets")
    .select("owner,wallet_id,para_user_id,email,user_identifier,updated_at")
    .eq("owner", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowFromDb(data);
}

async function saveToSupabase(row: StoredParaWallet) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("para_wallets").upsert(
    {
      owner: row.owner.toLowerCase(),
      wallet_id: row.walletId,
      para_user_id: row.paraUserId ?? null,
      email: row.email ?? null,
      user_identifier: row.userIdentifier,
      updated_at: row.updatedAt,
    },
    { onConflict: "owner" },
  );
  if (error) {
    throw new Error(
      error.message.includes("para_wallets")
        ? "Missing Supabase table para_wallets. Run supabase/migrations/002_para_wallets.sql."
        : error.message,
    );
  }
}

export async function saveParaWalletMapping(row: StoredParaWallet) {
  if (supabaseConfigured()) {
    await saveToSupabase(row);
    return;
  }
  const all = await loadAllFromFile();
  all[row.owner.toLowerCase()] = row;
  await saveAllToFile(all);
}

export async function getParaWalletByOwner(owner: string): Promise<StoredParaWallet | null> {
  if (!isAddress(owner)) return null;
  if (supabaseConfigured()) {
    try {
      return await getFromSupabase(owner);
    } catch (error) {
      console.warn("[para-wallets] Supabase lookup failed, trying local file:", error);
    }
  }
  const all = await loadAllFromFile();
  const key = getAddress(owner).toLowerCase();
  return all[key] ?? all[owner.toLowerCase()] ?? null;
}
