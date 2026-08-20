import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, isAddress } from "viem";

export type StoredParaWallet = {
  owner: `0x${string}`;
  walletId: string;
  paraUserId?: string | null;
  email?: string | null;
  userIdentifier: string;
  updatedAt: number;
};

const FILE = path.join(process.cwd(), ".data", "para-wallets.json");

async function loadAll(): Promise<Record<string, StoredParaWallet>> {
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as Record<string, StoredParaWallet>;
  } catch {
    return {};
  }
}

async function saveAll(rows: Record<string, StoredParaWallet>) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

export async function saveParaWalletMapping(row: StoredParaWallet) {
  const all = await loadAll();
  all[row.owner.toLowerCase()] = row;
  await saveAll(all);
}

export async function getParaWalletByOwner(owner: string): Promise<StoredParaWallet | null> {
  if (!isAddress(owner)) return null;
  const all = await loadAll();
  return all[getAddress(owner).toLowerCase()] ?? all[owner.toLowerCase()] ?? null;
}
