import { getAddress, parseAbi, type Address } from "viem";
import { fpmmFactoryAddress } from "@/lib/market-factory";
import { publicClient } from "./clients";
import { KIND_EVENT, KIND_PONS, KIND_PRICE, STATE_OPEN, type DueMarket } from "./types";

const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256 index) view returns (address)",
  "function tokenResolutionAdmin() view returns (address)",
  "function ponsResolutionAdmin() view returns (address)",
  "function nadResolutionAdmin() view returns (address)",
]);

const MARKET_ABI = parseAbi([
  "function marketKind() view returns (uint8)",
  "function state() view returns (uint8)",
  "function resolveAfterTimestamp() view returns (uint256)",
  "function metadataURI() view returns (string)",
  "function numOutcomes() view returns (uint8)",
]);

export { MARKET_ABI };

export function factoryAddress(): Address {
  const fpmm = fpmmFactoryAddress();
  if (!fpmm) throw new Error("ZedkrFpmmMarketFactory is not configured in this deployment.");
  return fpmm;
}

export async function readPonsResolutionAdmin(): Promise<Address | null> {
  const factory = factoryAddress();
  const client = publicClient();
  try {
    return (await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "tokenResolutionAdmin",
    })) as Address;
  } catch {
    try {
      return (await client.readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "ponsResolutionAdmin",
      })) as Address;
    } catch {
      return (await client.readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "nadResolutionAdmin",
      })) as Address;
    }
  }
}

async function scanOneFactory(factory: Address, nowSec: number): Promise<DueMarket[]> {
  const client = publicClient();
  const length = Number(
    await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "marketsLength",
    }),
  );
  if (!Number.isFinite(length) || length <= 0) return [];

  let addresses: Address[] = [];
  try {
    const addressRows = await client.multicall({
      contracts: Array.from({ length }, (_, i) => ({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "markets" as const,
        args: [BigInt(i)] as const,
      })),
    });
    addresses = addressRows
      .map((row) => (row.status === "success" ? (row.result as Address) : null))
      .filter((addr): addr is Address => Boolean(addr) && addr !== "0x0000000000000000000000000000000000000000")
      .map((addr) => getAddress(addr));
  } catch {
    for (let i = 0; i < length; i += 1) {
      const addr = (await client.readContract({
        address: factory,
        abi: FACTORY_ABI,
        functionName: "markets",
        args: [BigInt(i)],
      })) as Address;
      if (addr && addr !== "0x0000000000000000000000000000000000000000") addresses.push(getAddress(addr));
    }
  }

  if (addresses.length === 0) return [];

  type ScanRow = { status: "success" | "failure"; result?: unknown };
  let scan: ScanRow[] = [];
  try {
    scan = (await client.multicall({
      contracts: addresses.flatMap((address) => [
        { address, abi: MARKET_ABI, functionName: "marketKind" as const },
        { address, abi: MARKET_ABI, functionName: "state" as const },
        { address, abi: MARKET_ABI, functionName: "resolveAfterTimestamp" as const },
        { address, abi: MARKET_ABI, functionName: "metadataURI" as const },
      ]),
    })) as ScanRow[];
  } catch {
    for (const address of addresses) {
      try {
        const [kind, state, resolveAfter, metadataURI] = await Promise.all([
          client.readContract({ address, abi: MARKET_ABI, functionName: "marketKind" }),
          client.readContract({ address, abi: MARKET_ABI, functionName: "state" }),
          client.readContract({ address, abi: MARKET_ABI, functionName: "resolveAfterTimestamp" }),
          client.readContract({ address, abi: MARKET_ABI, functionName: "metadataURI" }),
        ]);
        scan.push(
          { status: "success", result: kind },
          { status: "success", result: state },
          { status: "success", result: resolveAfter },
          { status: "success", result: metadataURI },
        );
      } catch {
        scan.push(
          { status: "failure" },
          { status: "failure" },
          { status: "failure" },
          { status: "failure" },
        );
      }
    }
  }

  const due: DueMarket[] = [];
  for (let i = 0; i < addresses.length; i += 1) {
    const kindRow = scan[i * 4];
    const stateRow = scan[i * 4 + 1];
    const resolveRow = scan[i * 4 + 2];
    const uriRow = scan[i * 4 + 3];
    if (
      kindRow?.status !== "success" ||
      stateRow?.status !== "success" ||
      resolveRow?.status !== "success"
    ) {
      continue;
    }
    const kind = Number(kindRow.result);
    const state = Number(stateRow.result);
    const resolveAfter = Number(resolveRow.result);
    if (kind !== KIND_PRICE && kind !== KIND_EVENT && kind !== KIND_PONS) continue;
    if (state !== STATE_OPEN) continue;
    if (!Number.isFinite(resolveAfter) || nowSec < resolveAfter) continue;
    due.push({
      address: addresses[i]!,
      kind,
      state,
      resolveAfter,
      metadataURI: uriRow?.status === "success" ? String(uriRow.result ?? "") : "",
      sources: ["factory"],
    });
  }
  return due;
}

export async function fetchDueFromFactories(nowSec: number): Promise<DueMarket[]> {
  return scanOneFactory(factoryAddress(), nowSec);
}

export async function hydrateMarket(address: Address) {
  const client = publicClient();
  const [kind, state, resolveAfter, metadataURI, numOutcomes] = await Promise.all([
    client.readContract({ address, abi: MARKET_ABI, functionName: "marketKind" }),
    client.readContract({ address, abi: MARKET_ABI, functionName: "state" }),
    client.readContract({ address, abi: MARKET_ABI, functionName: "resolveAfterTimestamp" }),
    client.readContract({ address, abi: MARKET_ABI, functionName: "metadataURI" }),
    client.readContract({ address, abi: MARKET_ABI, functionName: "numOutcomes" }),
  ]);
  return {
    kind: Number(kind),
    state: Number(state),
    resolveAfter: Number(resolveAfter),
    metadataURI: String(metadataURI ?? ""),
    numOutcomes: Number(numOutcomes),
  };
}
