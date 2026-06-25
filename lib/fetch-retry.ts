export type RetryOptions = {
  /** Total attempts (first try + retries). Default 3. */
  attempts?: number;
  /** Base delay before retry; multiplied by attempt index. Default 2000ms. */
  delayMs?: number;
  onRetry?: (info: { attempt: number; maxAttempts: number; error: unknown }) => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` up to `attempts` times with backoff between failures. */
export async function withRetries<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      options.onRetry?.({ attempt, maxAttempts, error: err });
      await sleep(delayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
