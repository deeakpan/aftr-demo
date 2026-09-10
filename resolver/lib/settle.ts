import { parseAbi, type Address, type Hash } from "viem";
import { formatUserTxError } from "@/lib/tx-error";
import { publicClient, resolverChain, walletClient } from "./clients";
import { evaluateLaunchpadMarketFromUri } from "./launchpad";
import { KIND_EVENT, KIND_PONS, KIND_PRICE, type CycleAction, type DueMarket } from "./types";

const SETTLE_ABI = parseAbi([
  "function settlePrice()",
  "function resolveToken(uint8 outcomeIndex)",
  "function resolvePonsToken(uint8 outcomeIndex)",
  "function resolveNadToken(uint8 outcomeIndex)",
]);

async function sendAndWait(hash: Hash) {
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted");
  }
  return receipt.transactionHash;
}

export async function settleDueMarket(market: DueMarket, dryRun: boolean): Promise<CycleAction> {
  if (market.kind === KIND_EVENT) {
    return {
      address: market.address,
      kind: market.kind,
      action: "skip-event",
      skipped: true,
      reasoning: "EVENT markets need 3 resolution-admin signatures (use the admin app).",
    };
  }

  if (market.kind === KIND_PRICE) {
    if (dryRun) {
      return {
        address: market.address,
        kind: market.kind,
        action: "settlePrice",
        skipped: true,
        reasoning: "Dry run — would call settlePrice().",
      };
    }
    const wallet = walletClient();
    if (!wallet) {
      return {
        address: market.address,
        kind: market.kind,
        action: "settlePrice",
        error: "PRIVATE_KEY is not set.",
      };
    }
    try {
      const hash = await wallet.writeContract({
        address: market.address as Address,
        abi: SETTLE_ABI,
        functionName: "settlePrice",
        chain: resolverChain(),
        account: wallet.account,
      });
      const txHash = await sendAndWait(hash);
      return {
        address: market.address,
        kind: market.kind,
        action: "settlePrice",
        txHash,
        reasoning: "On-chain Chainlink settlePrice().",
      };
    } catch (error) {
      return {
        address: market.address,
        kind: market.kind,
        action: "settlePrice",
        error: formatUserTxError(error, error instanceof Error ? error.message : "settlePrice failed"),
      };
    }
  }

  if (market.kind !== KIND_PONS) {
    return {
      address: market.address,
      kind: market.kind,
      action: "skip",
      skipped: true,
      reasoning: `Unsupported market kind ${market.kind}`,
    };
  }

  let evaluation;
  try {
    evaluation = await evaluateLaunchpadMarketFromUri(market.metadataURI);
  } catch (error) {
    return {
      address: market.address,
      kind: market.kind,
      action: "resolveToken",
      error: error instanceof Error ? error.message : "Launchpad evaluation failed",
    };
  }

  if (dryRun) {
    return {
      address: market.address,
      kind: market.kind,
      action: "resolveToken",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: `${evaluation.launchpad}: ${evaluation.reasoning} (dry run)`,
      skipped: true,
    };
  }

  const wallet = walletClient();
  if (!wallet) {
    return {
      address: market.address,
      kind: market.kind,
      action: "resolveToken",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: evaluation.reasoning,
      error: "PRIVATE_KEY is not set.",
    };
  }

  try {
    let hash: Hash;
    try {
      hash = await wallet.writeContract({
        address: market.address as Address,
        abi: SETTLE_ABI,
        functionName: "resolveToken",
        args: [evaluation.outcomeIndex],
        chain: resolverChain(),
        account: wallet.account,
      });
    } catch {
      try {
        hash = await wallet.writeContract({
          address: market.address as Address,
          abi: SETTLE_ABI,
          functionName: "resolvePonsToken",
          args: [evaluation.outcomeIndex],
          chain: resolverChain(),
          account: wallet.account,
        });
      } catch {
        hash = await wallet.writeContract({
          address: market.address as Address,
          abi: SETTLE_ABI,
          functionName: "resolveNadToken",
          args: [evaluation.outcomeIndex],
          chain: resolverChain(),
          account: wallet.account,
        });
      }
    }
    const txHash = await sendAndWait(hash);
    return {
      address: market.address,
      kind: market.kind,
      action: "resolveToken",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: `${evaluation.launchpad}: ${evaluation.reasoning}`,
      txHash,
    };
  } catch (error) {
    return {
      address: market.address,
      kind: market.kind,
      action: "resolveToken",
      outcomeIndex: evaluation.outcomeIndex,
      outcomeLabel: evaluation.outcomeLabel,
      reasoning: `${evaluation.launchpad}: ${evaluation.reasoning}`,
      error: formatUserTxError(error, error instanceof Error ? error.message : "resolveToken failed"),
    };
  }
}
