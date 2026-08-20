/** User-facing transaction errors — never show RPC URLs, request bodies, or raw hex. */

function asText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const o = error as {
    details?: unknown;
    shortMessage?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  return [o.details, o.shortMessage, o.message, asText(o.cause)].filter(Boolean).join("\n");
}

function stripRpcDump(msg: string): string {
  return msg
    .replace(/URL:\s*\S+/gi, "")
    .replace(/Request body:[\s\S]*/gi, "")
    .replace(/Version:\s*\S+/gi, "")
    .replace(/Details:\s*/gi, "")
    .replace(/0x[0-9a-f]{48,}/gi, "")
    .replace(/\{[^{}]*"method"\s*:\s*"eth_[^"]+"[\s\S]*$/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function looksLikeRawDump(msg: string): boolean {
  return (
    /eth_sendRawTransaction|Request body|viem@|testnet-rpc|0x02f[0-9a-f]{20,}/i.test(msg) ||
    msg.length > 180
  );
}

export function formatUserTxError(error: unknown, fallback = "Transaction failed. Try again."): string {
  const blob = asText(error);

  if (/insufficient balance|insufficient funds/i.test(blob)) {
    return "Not enough ETH for gas. Add ETH to this wallet and try again.";
  }
  if (/user rejected|rejected the request/i.test(blob)) {
    return "Transaction cancelled.";
  }
  if (/nonce too low/i.test(blob)) {
    return "Wallet nonce is out of date. Wait a moment and try again.";
  }
  if (/replacement transaction underpriced|already known/i.test(blob)) {
    return "A similar transaction is already pending. Wait for it to finish.";
  }
  if (/rate limit|too many requests|15\/sec/i.test(blob)) {
    return "Network busy — try again in a moment.";
  }
  if (/execution reverted|reverted with the following signature/i.test(blob)) {
    return "Transaction reverted. Check balances, approval, and market settings.";
  }

  const cleaned = stripRpcDump(blob);
  if (!cleaned || looksLikeRawDump(cleaned) || looksLikeRawDump(blob)) {
    return fallback;
  }
  return cleaned;
}
