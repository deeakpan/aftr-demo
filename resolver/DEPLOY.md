# Zedkr resolver (Railway / Render / Fly)

The resolver lives in `resolver/` inside [aftr-demo](https://github.com/deeakpan/aftr-demo).

## Option A — root directory = repo root

**Build command**
```bash
npm install --prefix resolver && npm run build --prefix resolver
```

**Start command**
```bash
npm run bot
```

(`bot` at the repo root proxies to `resolver`.)

## Option B — root directory = `resolver`

**Build command**
```bash
npm install && npm run build
```

**Start command**
```bash
npm run bot
```

## Notes

- `npm run bot` starts the Next resolver app + Telegram alert bot (if `TELEGRAM_BOT_TOKEN` is set).
- Settlement ticks also run via Next instrumentation / `/api/tick` (see `vercel.json` crons).
- Do not commit `.env`. Set secrets in the host dashboard.
