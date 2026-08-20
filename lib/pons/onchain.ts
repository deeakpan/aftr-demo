import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
} from "viem";
import { chainlinkFeedByTokenAddress, chainlinkFeedByAsset } from "@/lib/chainlink-feeds";
import { robinhoodMainnet, ponsRpcUrl } from "@/lib/chain";
import { deploymentExternal } from "@/lib/deployment";
import {
  knownPonsInfraLabel,
  ponsMemeHookAddress,
  ponsPhaseLabel,
  ponsTokenImageUrl,
  ponsV2FactoryAddress,
  uniswapV4StateViewAddress,
  PONS_DEX_PHASE,
  PONS_MIN_DEX_LIQUIDITY_ETH,
  PONS_PHASE,
} from "./config";
import type { PonsLiveStats, PonsOnchainTokenResponse, PonsTokenRef } from "./types";
import { fullRangeAmounts, ponsPoolId, tokenIsCurrency1, tokenPriceInQuote } from "./v4-pool";

export class PonsTokenNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PonsTokenNotFoundError";
  }
}

const FACTORY_ABI = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
]);

const TOKEN_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, (string twitter, string telegram, string discord, string website, string farcaster) tokenSocials)",
]);

const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

const ERC20_DECIMALS_ABI = parseAbi(["function decimals() view returns (uint8)"]);

function publicClient() {
  return createPublicClient({
    chain: robinhoodMainnet,
    transport: http(ponsRpcUrl()),
  });
}

function wrapPonsReadError(error: unknown, fallback: string): never {
  if (error instanceof PonsTokenNotFoundError) throw error;
  const msg = error instanceof Error ? error.message : String(error);
  if (/returned no data|is not a contract|getLaunchedToken/i.test(msg)) {
    throw new PonsTokenNotFoundError(
      "Could not find this token on Pons Family. Paste a Pons V2 token CA from ponsfamily.com.",
    );
  }
  throw new PonsTokenNotFoundError(fallback);
}

async function quoteUsdPrice(
  client: ReturnType<typeof publicClient>,
  pairToken: Address,
  isNative: boolean,
): Promise<number | null> {
  if (isNative || pairToken === zeroAddress) {
    const feed = chainlinkFeedByAsset("ETH");
    if (!feed?.address) return null;
    return readFeedUsd(client, feed.address as Address, feed.decimals ?? 8);
  }

  const byToken = chainlinkFeedByTokenAddress(pairToken);
  if (byToken?.address) {
    return readFeedUsd(client, byToken.address as Address, byToken.decimals ?? 8);
  }

  const ext = deploymentExternal().pons;
  if (ext?.usdg && pairToken.toLowerCase() === ext.usdg.toLowerCase()) {
    const usdg = chainlinkFeedByAsset("USDG");
    if (usdg?.address) return readFeedUsd(client, usdg.address as Address, usdg.decimals ?? 8);
  }

  return null;
}

async function readFeedUsd(
  client: ReturnType<typeof publicClient>,
  feed: Address,
  decimals: number,
): Promise<number | null> {
  const [, answer, , updatedAt] = await client.readContract({
    address: feed,
    abi: AGGREGATOR_ABI,
    functionName: "latestRoundData",
  });
  if (updatedAt === BigInt(0) || answer <= BigInt(0)) return null;
  const n = Number(formatUnits(answer, decimals));
  return Number.isFinite(n) ? n : null;
}

function quoteSymbol(pairToken: Address, isNative: boolean): string {
  if (isNative || pairToken === zeroAddress) return "ETH";
  const byToken = chainlinkFeedByTokenAddress(pairToken);
  if (byToken?.asset) return byToken.asset;
  const ext = deploymentExternal().pons;
  if (ext?.usdg && pairToken.toLowerCase() === ext.usdg.toLowerCase()) return "USDG";
  return "QUOTE";
}

async function quoteAmountToEth(
  client: ReturnType<typeof publicClient>,
  quoteAmount: bigint,
  quoteDecimals: number,
  pairToken: Address,
  isNative: boolean,
): Promise<bigint | null> {
  if (isNative || pairToken === zeroAddress) {
    if (quoteDecimals === 18) return quoteAmount;
    if (quoteDecimals > 18) return quoteAmount / 10n ** BigInt(quoteDecimals - 18);
    return quoteAmount * 10n ** BigInt(18 - quoteDecimals);
  }
  const weth = deploymentExternal().pons?.weth;
  if (weth && pairToken.toLowerCase() === weth.toLowerCase()) {
    return quoteDecimals === 18 ? quoteAmount : quoteAmount * 10n ** BigInt(18 - quoteDecimals);
  }
  const quoteUsd = await quoteUsdPrice(client, pairToken, false);
  const ethUsd = await quoteUsdPrice(client, zeroAddress, true);
  if (quoteUsd == null || ethUsd == null || ethUsd <= 0) return null;
  const quoteWhole = Number(formatUnits(quoteAmount, quoteDecimals));
  const ethWhole = (quoteWhole * quoteUsd) / ethUsd;
  if (!Number.isFinite(ethWhole) || ethWhole < 0) return null;
  return parseEther(ethWhole.toFixed(8));
}

/** Graduated Pons V2 token on Uniswap v4 with > 5 ETH DEX liquidity. */
export async function fetchPonsToken(tokenAddress: string): Promise<PonsOnchainTokenResponse> {
  const infra = knownPonsInfraLabel(tokenAddress);
  if (infra) {
    throw new PonsTokenNotFoundError(
      `${infra} is not a Pons launch token. Paste a graduated token CA from ponsfamily.com.`,
    );
  }
  if (!isAddress(tokenAddress)) {
    throw new PonsTokenNotFoundError("Invalid contract address.");
  }

  const token = getAddress(tokenAddress);
  const client = publicClient();
  const factory = ponsV2FactoryAddress();

  let launch;
  try {
    launch = await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "getLaunchedToken",
      args: [token],
    });
  } catch (error) {
    wrapPonsReadError(error, "Could not look up this token on Pons Family. Paste a Pons V2 CA from ponsfamily.com.");
  }

  if (!launch.exists) {
    throw new PonsTokenNotFoundError(
      "Not a Pons V2 token. Paste a contract address from ponsfamily.com.",
    );
  }

  const phase = Number(launch.phase);
  if (phase === PONS_PHASE.NOT_GRADUATED) {
    throw new PonsTokenNotFoundError(
      "This token is still on the bonding curve. Only graduated Uniswap v4 tokens with more than 5 ETH of DEX liquidity can be listed.",
    );
  }
  if (phase === PONS_PHASE.SWEPT) {
    throw new PonsTokenNotFoundError(
      "This token is still graduating (swept, pool not live yet). Wait until it trades on Uniswap v4.",
    );
  }
  if (phase !== PONS_DEX_PHASE) {
    throw new PonsTokenNotFoundError(
      `This token is not on Uniswap v4 (${ponsPhaseLabel(phase)}). Only graduated Pons tokens can be listed.`,
    );
  }

  const pairToken = launch.pairToken as Address;
  const isNative = pairToken === zeroAddress;
  const hooks = ponsMemeHookAddress();
  const poolId = ponsPoolId({
    token,
    pairToken,
    poolFee: Number(launch.poolFee),
    tickSpacing: Number(launch.tickSpacing),
    hooks,
  });

  const stateView = uniswapV4StateViewAddress();
  let name: string;
  let symbol: string;
  let decimals: number;
  let totalSupply: bigint;
  let tokenInfo: readonly [Address, string, string, unknown];
  let slot0: readonly [bigint, number, number, number];
  let liquidity: bigint;
  let quoteDecimals: number;
  try {
    [name, symbol, decimals, totalSupply, tokenInfo, slot0, liquidity, quoteDecimals] = await Promise.all([
      client.readContract({ address: token, abi: TOKEN_ABI, functionName: "name" }),
      client.readContract({ address: token, abi: TOKEN_ABI, functionName: "symbol" }),
      client.readContract({ address: token, abi: TOKEN_ABI, functionName: "decimals" }),
      client.readContract({ address: token, abi: TOKEN_ABI, functionName: "totalSupply" }),
      client.readContract({ address: token, abi: TOKEN_ABI, functionName: "getTokenInfo" }),
      client.readContract({ address: stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId] }),
      client.readContract({ address: stateView, abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [poolId] }),
      isNative
        ? Promise.resolve(18)
        : client.readContract({ address: pairToken, abi: ERC20_DECIMALS_ABI, functionName: "decimals" }).then(Number),
    ]);
  } catch (error) {
    wrapPonsReadError(error, "Could not read this Pons token on-chain. Try another CA from ponsfamily.com.");
  }

  const sqrtPriceX96 = slot0[0];
  if (liquidity === BigInt(0) || sqrtPriceX96 === BigInt(0)) {
    throw new PonsTokenNotFoundError("Uniswap v4 pool has no liquidity yet. Try again after the pool is seeded.");
  }

  const { amount0, amount1 } = fullRangeAmounts(sqrtPriceX96, liquidity);
  const tokenIsC1 = tokenIsCurrency1(token, pairToken);
  const quoteAmount = tokenIsC1 ? amount0 : amount1;
  const qDec = Number(quoteDecimals);
  const liquidityEthWei = await quoteAmountToEth(client, quoteAmount, qDec, pairToken, isNative);
  if (liquidityEthWei == null) {
    throw new PonsTokenNotFoundError("Could not price DEX liquidity in ETH (missing Chainlink feed for the quote asset).");
  }

  const minWei = parseEther(String(PONS_MIN_DEX_LIQUIDITY_ETH));
  const liquidityEth = Number(formatUnits(liquidityEthWei, 18));
  if (liquidityEthWei <= minWei) {
    throw new PonsTokenNotFoundError(
      `DEX liquidity is ${liquidityEth.toFixed(2)} ETH. Need more than ${PONS_MIN_DEX_LIQUIDITY_ETH} ETH in the Uniswap v4 pool.`,
    );
  }

  const dec = Number(decimals);
  const priceQuote = tokenPriceInQuote(sqrtPriceX96, tokenIsC1, qDec, dec);
  const quoteUsd = await quoteUsdPrice(client, pairToken, isNative);
  const priceUsd = priceQuote != null && quoteUsd != null ? priceQuote * quoteUsd : null;
  const supplyTokens = Number(formatUnits(totalSupply, dec));
  const marketCapUsd = priceUsd != null && Number.isFinite(supplyTokens) ? priceUsd * supplyTokens : null;

  const stats: PonsLiveStats = {
    priceUsd,
    marketCapUsd,
    graduationProgress: null,
    liquidityEth,
    quoteSymbol: quoteSymbol(pairToken, isNative),
    pairToken: pairToken.toLowerCase(),
    isBonded: false,
  };

  const ref: PonsTokenRef = {
    address: token.toLowerCase(),
    symbol: symbol.trim() || "???",
    name: name.trim() || symbol.trim() || "Token",
    imageUri: ponsTokenImageUrl(tokenInfo[1]),
    curveAddress: launch.curve.toLowerCase(),
    pairToken: pairToken.toLowerCase(),
    poolId,
    isBonded: false,
  };

  return {
    token: ref,
    stats,
    description: tokenInfo[2]?.trim() || "",
  };
}

/** @deprecated Use fetchPonsToken — listing is graduated DEX tokens only. */
export const fetchPonsBondedToken = fetchPonsToken;
