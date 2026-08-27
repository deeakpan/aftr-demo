import { getParaApiBase, getParaApiSecret } from "@/lib/para-config";

export class ParaRestError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ParaRestError";
    this.status = status;
    this.body = body;
  }
}

function isTransientNetworkError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? "")}`
      : String(error);
  return /fetch failed|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|UND_ERR|Connect Timeout|getaddrinfo|network|socket|timeout of \d+ms exceeded|AbortError|The operation was aborted|ParaApiError|AxiosError/i.test(
    msg,
  );
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Para REST can hang under load; abort so retries can kick in. */
const PARA_REQUEST_TIMEOUT_MS = 45_000;

async function paraRestOnce<T = unknown>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const secret = getParaApiSecret();
  if (!secret) throw new Error("PARA_API_SECRET is not configured.");

  const { idempotencyKey, headers, signal: userSignal, ...rest } = init ?? {};
  const timeout = AbortSignal.timeout(PARA_REQUEST_TIMEOUT_MS);
  const signal =
    userSignal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([userSignal, timeout])
      : timeout;

  let res: Response;
  try {
    res = await fetch(`${getParaApiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
      ...rest,
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": secret,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...headers,
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.message}${
            (error as Error & { cause?: { code?: string; message?: string } }).cause?.code
              ? ` (${(error as Error & { cause?: { code?: string } }).cause!.code})`
              : ""
          }`
        : String(error);
    if (/aborted|timeout|TimeoutError/i.test(detail)) {
      throw new Error(`Para network error: request timed out after ${PARA_REQUEST_TIMEOUT_MS}ms`);
    }
    throw new Error(`Para network error: ${detail}`);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : null) ||
      (typeof json === "string" && json) ||
      `Para REST ${res.status}`;
    throw new ParaRestError(msg, res.status, json);
  }
  return json as T;
}

/** Para REST with retries for flaky DNS (EAI_AGAIN) and 5xx. */
export async function paraRest<T = unknown>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const attempts = 4;
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await paraRestOnce<T>(path, init);
    } catch (error) {
      lastError = error;
      const retryHttp =
        error instanceof ParaRestError && isRetryableHttpStatus(error.status);
      const retryNet = isTransientNetworkError(error);
      if ((!retryHttp && !retryNet) || i === attempts - 1) throw error;
      await sleep(350 * 2 ** i + Math.floor(Math.random() * 120));
    }
  }
  throw lastError;
}
