import { getAddress, isAddress } from "viem";
import { paraRest } from "@/lib/para-rest";
import { saveParaWalletMapping } from "@/lib/para-wallets-store";

type RegisterInput = {
  owner: string;
  paraUserId?: string | null;
  walletId?: string | null;
  session?: unknown;
  sessionCookie?: string | null;
  email?: string | null;
};

type ParaWallet = {
  id?: string;
  address?: string;
  type?: string;
};

function asWallet(json: unknown): ParaWallet | null {
  if (!json || typeof json !== "object") return null;
  const o = json as ParaWallet & { wallet?: ParaWallet; data?: ParaWallet };
  if (o.id && o.address) return o;
  if (o.wallet?.id && o.wallet.address) return o.wallet;
  if (o.data?.id && o.data.address) return o.data;
  return null;
}

function asList(json: unknown): ParaWallet[] {
  const single = asWallet(json);
  if (single) return [single];
  if (Array.isArray(json)) return json as ParaWallet[];
  if (json && typeof json === "object") {
    const o = json as { data?: ParaWallet[]; wallets?: ParaWallet[]; results?: ParaWallet[]; items?: ParaWallet[] };
    return o.data ?? o.wallets ?? o.results ?? o.items ?? [];
  }
  return [];
}

export function apiWalletIdentifier(data: { owner?: string; paraUserId?: string | null }) {
  const id = data.paraUserId?.trim();
  if (id) return `para:${id}`;
  const owner = data.owner?.trim();
  if (owner && isAddress(owner)) return `para-owner:${owner.toLowerCase()}`;
  throw new Error("Missing Para user id or owner for API wallet.");
}

async function ensureParaApiWallet(data: RegisterInput): Promise<ParaWallet> {
  const userIdentifier = apiWalletIdentifier(data);
  const listed = await paraRest(
    `/v1/wallets?type=EVM&status=ready&userIdentifier=${encodeURIComponent(userIdentifier)}&userIdentifierType=CUSTOM_ID`,
  );
  const existing = asList(listed).find((w) => w.id && w.address);
  if (existing?.address && existing.id) return existing;

  const createdRaw = await paraRest("/v1/wallets", {
    method: "POST",
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({
      type: "EVM",
      userIdentifier,
      userIdentifierType: "CUSTOM_ID",
      scheme: "DKLS",
    }),
  });
  const created = asWallet(createdRaw) ?? asList(createdRaw)[0];
  if (!created) throw new Error("Para did not return an EVM API wallet.");
  return created;
}

export async function registerParaWallet(data: RegisterInput) {
  const paraUserId = data.paraUserId?.trim();
  const authOwner = data.owner?.trim();

  if (!paraUserId && (!authOwner || !isAddress(authOwner))) {
    throw new Error("Missing Para user id or auth wallet address.");
  }

  const created = await ensureParaApiWallet({ ...data, owner: authOwner ?? "", paraUserId });
  const address = created.address?.trim();
  const walletId = created.id?.trim();
  if (!address || !isAddress(address) || !walletId) {
    throw new Error("Para did not return an EVM API wallet.");
  }

  const owner = getAddress(address) as `0x${string}`;
  await saveParaWalletMapping({
    owner,
    walletId,
    paraUserId: data.paraUserId ?? null,
    email: data.email ?? null,
    userIdentifier: apiWalletIdentifier({ owner: authOwner, paraUserId: data.paraUserId }),
    updatedAt: Date.now(),
  });

  return {
    owner,
    walletId,
    paraUserId: data.paraUserId ?? null,
    email: data.email ?? null,
  };
}
