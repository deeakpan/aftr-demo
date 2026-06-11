import { createPublicClient, defineChain, http, parseAbi } from "viem";
import type { Address } from "viem";
import type { IndexerConfig } from "./config.js";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

const FACTORY_ABI = parseAbi([
  "function marketsLength() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);

const MARKET_LOG_EVENTS = parseAbi([
  "event Deposited(address indexed buyer, address indexed recipient, uint8 indexed outcomeIndex, uint256 collateralAmount, uint256 sharesMinted, uint256 price1e18)",
  "event TokensRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout)",
]);

export function createChainClient(cfg: IndexerConfig) {
  const chain =
    cfg.chainId === BigInt(monadTestnet.id)
      ? monadTestnet
      : defineChain({
          id: Number(cfg.chainId),
          name: "Indexed chain",
          nativeCurrency: monadTestnet.nativeCurrency,
          rpcUrls: { default: { http: [cfg.rpcUrl] } },
        });

  return createPublicClient({
    chain,
    transport: http(cfg.rpcUrl, { timeout: 120_000, retryCount: 3 }),
  });
}

/** Single inferred viem client type (avoids duplicated `PublicClient` from strict checks). */
export type RpcClient = ReturnType<typeof createChainClient>;

export async function fetchLogsForMarketBatch(
  client: RpcClient,
  markets: readonly Address[],
  fromBlock: bigint,
  toBlock: bigint,
) {
  return client.getLogs({
    address: [...markets],
    events: MARKET_LOG_EVENTS,
    fromBlock,
    toBlock,
  });
}

/** Single decoded row from indexed market logs. */
export type MarketIndexedLog = Awaited<ReturnType<typeof fetchLogsForMarketBatch>>[number];

/** All markets returned by factory at snapshot time — lowercased sorts for stable hashing. */
export async function fetchFactoryMarkets(
  client: RpcClient,
  factory: Address,
): Promise<Address[]> {
  const len = (await client.readContract({
    address: factory,
    abi: FACTORY_ABI,
    functionName: "marketsLength",
  })) as bigint;

  const out: Address[] = [];
  for (let i = BigInt(0); i < len; i += BigInt(1)) {
    const m = (await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "markets",
      args: [i],
    })) as Address;
    out.push(m);
  }

  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return out;
}

export { MARKET_LOG_EVENTS };
