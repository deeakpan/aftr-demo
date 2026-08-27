import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIGHTHOUSE_ADD_URL = "https://upload.lighthouse.storage/api/v0/add";

function networkDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code;
    return [error.message, code, cause.message].filter(Boolean).join(": ");
  }
  return error.message;
}

async function uploadToLighthouse(payload: FormData, apiKey: string) {
  const controller = new AbortController();
  const timeoutMs = 45_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(LIGHTHOUSE_ADD_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: payload,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function uploadWithRetry(payloadFactory: () => FormData, apiKey: string) {
  try {
    return await uploadToLighthouse(payloadFactory(), apiKey);
  } catch (first) {
    console.warn("[lighthouse/upload] retry after", networkDetail(first));
    return await uploadToLighthouse(payloadFactory(), apiKey);
  }
}

/** Buffer request bytes so undici doesn't stream a half-consumed File upstream. */
async function fileToBlob(file: File): Promise<{ blob: Blob; name: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("Uploaded file is empty.");
  }
  return {
    blob: new Blob([bytes], { type: file.type || "application/octet-stream" }),
    name: file.name || "upload.bin",
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.LIGHTHOUSE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server missing LIGHTHOUSE_API_KEY." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid multipart body.", details: networkDetail(error) },
      { status: 400 },
    );
  }

  const kind = String(form.get("kind") ?? "file");
  let buildPayload: () => FormData;

  try {
    if (kind === "json") {
      const json = String(form.get("json") ?? "");
      const filename = String(form.get("filename") ?? "metadata.json");
      if (!json) {
        return NextResponse.json({ error: "Missing json payload." }, { status: 400 });
      }
      const bytes = new TextEncoder().encode(json);
      buildPayload = () => {
        const payload = new FormData();
        payload.append(
          "file",
          new Blob([bytes], { type: "application/json" }),
          filename,
        );
        return payload;
      };
    } else {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
      }
      const { blob, name } = await fileToBlob(file);
      buildPayload = () => {
        const payload = new FormData();
        payload.append("file", blob, name);
        return payload;
      };
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid upload payload." },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await uploadWithRetry(buildPayload, apiKey);
  } catch (error) {
    const details = networkDetail(error);
    console.error("[lighthouse/upload] failed", details);
    return NextResponse.json(
      { error: "Lighthouse upload request failed.", details },
      { status: 504 },
    );
  }

  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // keep raw text for debugging upstream errors.
  }
  if (!res.ok) {
    console.error("[lighthouse/upload] upstream", res.status, raw.slice(0, 300));
    return NextResponse.json(
      { error: `Lighthouse upload failed (${res.status}).`, details: data },
      { status: 502 },
    );
  }

  const cid = typeof data === "object" && data !== null ? (data as { Hash?: string }).Hash : undefined;
  if (!cid) {
    return NextResponse.json(
      { error: "No CID returned from Lighthouse.", details: data },
      { status: 502 },
    );
  }

  return NextResponse.json({
    cid,
    ipfsUri: `ipfs://${cid}`,
    gatewayUrl: `https://gateway.lighthouse.storage/ipfs/${cid}`,
  });
}
