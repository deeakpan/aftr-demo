/**
 * Starts Next resolver + Telegram subscriber bot together.
 */
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const repoRoot = path.join(root, "..");
const RESOLVER_PORT = Number(process.env.PORT || 3002) || 3002;

/** Free the resolver port so relaunch does not hit EADDRINUSE. */
function freePort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`[start-resolver] freed port ${port} (killed pid ${pid})`);
        } catch {
          /* ignore */
        }
      }
    } else {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore" });
    }
  } catch {
    /* nothing listening */
  }
}

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

freePort(RESOLVER_PORT);

const kids = [];

function run(cmd, args, name, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    shell: Boolean(opts.shell),
  });
  kids.push(child);
  child.on("exit", (code, signal) => {
    console.warn(`[${name}] exited code=${code} signal=${signal}`);
    for (const k of kids) {
      try {
        k.kill();
      } catch {
        /* ignore */
      }
    }
    process.exit(code ?? 1);
  });
  return child;
}

const token = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_KEY || "").trim();
if (token) {
  // No shell — node path may contain spaces (e.g. Program Files).
  run(process.execPath, [path.join(__dirname, "telegram-bot.cjs")], "telegram-bot", { shell: false });
} else {
  console.warn("[start-resolver] TELEGRAM_BOT_TOKEN not set — Telegram alerts off");
}

run("npx", ["next", "dev", "--port", String(RESOLVER_PORT), "--webpack"], "resolver", { shell: true });
