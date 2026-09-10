export const KIND_PRICE = 0;
export const KIND_EVENT = 1;
export const KIND_PONS = 2;
export const KIND_TOKEN = 2;

export const STATE_OPEN = 0;
export const STATE_SETTLED = 2;

export type MarketKind = typeof KIND_PRICE | typeof KIND_EVENT | typeof KIND_PONS;

export type CandidateSource = "subgraph" | "factory";

export type DueMarket = {
  address: `0x${string}`;
  kind: number;
  state: number;
  resolveAfter: number;
  metadataURI: string;
  sources: CandidateSource[];
};

export type SettleAction = "settlePrice" | "resolveToken" | "resolvePonsToken" | "skip-event" | "skip";

export type CycleAction = {
  address: `0x${string}`;
  kind: number;
  action: SettleAction;
  outcomeIndex?: number;
  outcomeLabel?: string;
  reasoning?: string;
  txHash?: string;
  error?: string;
  skipped?: boolean;
};

export type CycleResult = {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  subgraphUrl: string;
  subgraphOk: boolean;
  subgraphError?: string;
  factoryOk: boolean;
  factoryError?: string;
  due: DueMarket[];
  actions: CycleAction[];
  resolver: `0x${string}` | null;
};
