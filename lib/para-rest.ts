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

export async function paraRest<T = unknown>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const secret = getParaApiSecret();
  if (!secret) throw new Error("PARA_API_SECRET is not configured.");

  const { idempotencyKey, headers, ...rest } = init ?? {};
  const res = await fetch(`${getParaApiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": secret,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...headers,
    },
  });

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
