/**
 * Standalone Telegram alert bot (Node, not Next-bundled).
 * - DM the bot → chat id saved in Supabase
 * - Polls resolver /api/status; when EVENT markets are due, DMs all subscribers with admin resolve link
 * - Never posts to groups
 *
 * Started by scripts/start-resolver.cjs alongside Next (npm run bot).
 */
const fs = require("fs");
const path = require("path");
const { Agent, fetch: undiciFetch } = require("undici");

const root = path.join(__dirname, "..");
const repoRoot = path.join(root, "..");

/** Longer timeouts — Telegram long-poll exceeds undici defaults (10s connect). */
const tgAgent = new Agent({
  connectTimeout: 30_000,
  headersTimeout: 90_000,
  bodyTimeout: 90_000,
  keepAliveTimeout: 60_000,
});

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(repoRoot, ".env"));
loadEnvFile(path.join(root, ".env"));

const TG_API = "https://api.telegram.org";
const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_KEY || "").trim();
const resolverBase = (process.env.RESOLVER_URL || "http://127.0.0.1:3002").replace(/\/$/, "");
const adminBase = (
  process.env.TELEGRAM_ADMIN_BASE_URL ||
  process.env.ADMIN_APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3001"
).replace(/\/$/, "");
const statusPollMs = Math.max(15_000, Number(process.env.TELEGRAM_STATUS_POLL_MS || 30_000) || 30_000);

const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).trim().replace(/\/$/, "");
const supabaseKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  ""
).trim();

if (!token) {
  console.error("[telegram-bot] TELEGRAM_BOT_TOKEN missing");
  process.exit(1);
}
if (!supabaseUrl || !supabaseKey) {
  console.error(
    "[telegram-bot] Supabase missing — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

async function withRetries(label, fn, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      console.warn(`[telegram-bot] ${label} attempt ${i}/${attempts} failed`, err.message || err);
      if (i < attempts) await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
  throw last;
}

async function sb(method, table, opts = {}) {
  return withRetries(`supabase ${method} ${table}`, async () => {
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, v);
      }
    }
    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    };
    if (opts.prefer) headers.Prefer = opts.prefer;

    const res = await undiciFetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      dispatcher: tgAgent,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase ${method} ${table} ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return res.json();
  });
}

async function listChatIds() {
  const rows = await sb("GET", "telegram_subscribers", {
    query: { select: "chat_id", order: "created_at.asc" },
  });
  return [...new Set((rows || []).map((r) => Number(r.chat_id)).filter((n) => Number.isFinite(n) && n > 0))];
}

async function subscribe(chatId, username) {
  const before = await listChatIds();
  const existed = before.includes(chatId);
  await sb("POST", "telegram_subscribers", {
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      chat_id: chatId,
      username: username || null,
      updated_at: new Date().toISOString(),
    },
  });
  const all = await listChatIds();
  return { added: !existed, total: all.length };
}

async function unsubscribe(chatId) {
  const existing = await sb("GET", "telegram_subscribers", {
    query: { select: "chat_id", chat_id: `eq.${chatId}` },
  });
  if (!Array.isArray(existing) || existing.length === 0) return false;
  await sb("DELETE", "telegram_subscribers", {
    query: { chat_id: `eq.${chatId}` },
  });
  return true;
}

async function wasNotified(marketAddress) {
  const rows = await sb("GET", "telegram_notified_markets", {
    query: { select: "market_address", market_address: `eq.${marketAddress}` },
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function markNotified(marketAddress) {
  await sb("POST", "telegram_notified_markets", {
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { market_address: marketAddress, notified_at: new Date().toISOString() },
  });
}

async function tg(method, body) {
  return withRetries(`telegram ${method}`, async () => {
    let res;
    try {
      res = await undiciFetch(`${TG_API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        dispatcher: tgAgent,
      });
    } catch (err) {
      const cause = err && err.cause ? ` (${err.cause.message || err.cause})` : "";
      throw new Error(`Telegram fetch failed: ${err.message || err}${cause}`);
    }
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || `Telegram ${method} failed`);
    return json.result;
  }, method === "getUpdates" ? 1 : 3);
}

async function replyPrivate(chatId, text) {
  await tg("sendMessage", { chat_id: chatId, text, disable_web_page_preview: false });
}

function resolveLink(address) {
  return `${adminBase}/markets/${address}`;
}

async function pollUpdates(offset) {
  const updates = await tg("getUpdates", {
    offset,
    timeout: 20,
    allowed_updates: ["message"],
  });
  let next = offset;
  for (const u of updates) {
    next = u.update_id + 1;
    const msg = u.message;
    if (!msg?.chat || msg.chat.type !== "private") continue;
    const chatId = msg.chat.id;
    const username = msg.from?.username || null;
    const text = String(msg.text || "")
      .trim()
      .toLowerCase();
    try {
      if (text === "/stop" || text === "stop" || text === "unsubscribe") {
        const removed = await unsubscribe(chatId);
        await replyPrivate(
          chatId,
          removed ? "Unsubscribed. Message me again to re-subscribe." : "You weren't subscribed.",
        );
        continue;
      }
      const { added, total } = await subscribe(chatId, username);
      try {
        await replyPrivate(
          chatId,
          [
            added ? "Subscribed to Zedkr event resolution alerts." : "You're already subscribed.",
            "",
            "When an event market is ready to resolve, I'll DM you the admin link.",
            "Send /stop to unsubscribe.",
            "",
            `Subscribers: ${total}`,
          ].join("\n"),
        );
      } catch (replyErr) {
        // Already saved in Supabase — don't lose the subscription if Telegram send flakes.
        console.warn(
          "[telegram-bot] subscribed but confirmation DM failed",
          chatId,
          replyErr.message || replyErr,
        );
      }
    } catch (err) {
      console.warn("[telegram-bot] handler failed", chatId, err.message || err);
    }
  }
  return next;
}

async function checkDueEvents() {
  let json;
  try {
    const res = await fetch(`${resolverBase}/api/status`, { cache: "no-store" });
    if (!res.ok) return;
    json = await res.json();
  } catch {
    return;
  }
  const due = json?.cycle?.due;
  if (!Array.isArray(due) || due.length === 0) return;

  const events = due.filter((m) => Number(m.kind) === 1);
  if (events.length === 0) return;

  let chatIds;
  try {
    chatIds = await listChatIds();
  } catch (err) {
    console.warn("[telegram-bot] list subscribers failed", err.message || err);
    return;
  }
  if (chatIds.length === 0) {
    console.log("[telegram-bot] event markets due but no subscribers");
    return;
  }

  for (const market of events) {
    const addr = String(market.address || "").toLowerCase();
    if (!addr) continue;
    try {
      if (await wasNotified(addr)) continue;
    } catch (err) {
      console.warn("[telegram-bot] notified check failed", addr, err.message || err);
      continue;
    }
    const when = market.resolveAfter
      ? new Date(Number(market.resolveAfter) * 1000).toLocaleString()
      : "—";
    const text = [
      "Event market ready to resolve",
      "",
      `Market: ${market.address}`,
      `Resolve after: ${when}`,
      "",
      "Open admin resolve page:",
      resolveLink(market.address),
    ].join("\n");

    for (const chatId of chatIds) {
      try {
        await replyPrivate(chatId, text);
      } catch (err) {
        console.warn("[telegram-bot] notify failed", chatId, addr, err.message || err);
      }
    }
    try {
      await markNotified(addr);
    } catch (err) {
      console.warn("[telegram-bot] mark notified failed", addr, err.message || err);
    }
    console.log(`[telegram-bot] notified ${chatIds.length} subscriber(s) for ${market.address}`);
  }
}

async function main() {
  let count = 0;
  try {
    count = (await listChatIds()).length;
  } catch (err) {
    console.warn(
      "[telegram-bot] could not read subscribers (run SQL migration first?)",
      err.message || err,
    );
  }
  console.log(
    `[telegram-bot] started supabase=${supabaseUrl} subscribers=${count} admin=${adminBase} resolver=${resolverBase}`,
  );
  await tg("deleteWebhook", { drop_pending_updates: true }).catch(() => undefined);

  let offset = 0;
  setInterval(() => {
    void checkDueEvents();
  }, statusPollMs);
  void checkDueEvents();

  for (;;) {
    try {
      offset = await pollUpdates(offset);
    } catch (err) {
      console.warn("[telegram-bot] poll failed", err.message || err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => {
  console.error("[telegram-bot] fatal", err);
  process.exit(1);
});
