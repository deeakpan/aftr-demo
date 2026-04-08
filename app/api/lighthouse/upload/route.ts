import { NextResponse } from "next/server";

const LIGHTHOUSE_ADD_URL = "https://upload.lighthouse.storage/api/v0/add";

async function uploadToLighthouse(payload: FormData, apiKey: string) {
  const controller = new AbortController();
  const timeoutMs = 30_000;
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

async function uploadWithRetry(payload: FormData, apiKey: string) {
  try {
    return await uploadToLighthouse(payload, apiKey);
  } catch {
    // single retry for transient network timeout
    return await uploadToLighthouse(payload, apiKey);
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.LIGHTHOUSE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server missing LIGHTHOUSE_API_KEY." },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "file");
  const payload = new FormData();

  if (kind === "json") {
    const json = String(form.get("json") ?? "");
    const filename = String(form.get("filename") ?? "metadata.json");
    if (!json) return NextResponse.json({ error: "Missing json payload." }, { status: 400 });
    payload.append("file", new Blob([json], { type: "application/json" }), filename);
  } else {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
    }
    payload.append("file", file, file.name);
  }

  let res: Response;
  try {
    res = await uploadWithRetry(payload, apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upload failure";
    return NextResponse.json(
      { error: "Lighthouse upload request failed.", details: message },
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
