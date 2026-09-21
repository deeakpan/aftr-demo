# Zedkr resolver (Railway / Render / Fly)

The resolver lives in `resolver/` inside [aftr-demo](https://github.com/deeakpan/aftr-demo).

## Option A — root directory = repo root (recommended)

**Build command**
```bash
npm run build:bot
```

**Start command**
```bash
npm run bot
```

(`bot` at the repo root proxies to `resolver`. If the host skips build, `start-resolver` will run `next build` on first start.)

## Option B — root directory = `resolver`

**Build command**
```bash
npm install --include=dev && npm run build
```

**Start command**
```bash
npm run bot
```

## Notes

- Do **not** use the root app’s `npm run build` for this service — that builds the market UI, not the resolver.
- `npm run bot` starts the Next resolver app + Telegram alert bot (if `TELEGRAM_BOT_TOKEN` is set).
- Settlement ticks also run via Next instrumentation / `/api/tick` (see `vercel.json` crons).
- Do not commit `.env`. Set secrets in the host dashboard.
