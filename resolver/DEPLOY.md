# Zedkr resolver (Railway / Render / Fly)

The resolver lives in `resolver/` inside [aftr-demo](https://github.com/deeakpan/aftr-demo).

## What to set on the host

You are **not** deploying a separate resolver-only git repo. The host clones **aftr-demo** and runs the resolver app inside it.

### Recommended (Root Directory = repo root)

| Setting | Value |
| --- | --- |
| Root Directory | *(empty / `.`)* |
| Build command | `npm run build:bot` |
| Start command | `npm run bot` |

### Alternative (Root Directory = `resolver`)

| Setting | Value |
| --- | --- |
| Root Directory | `resolver` |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm run bot` |

If Build is left empty, start will try to build on boot (slower; first boot can take a few minutes).

## Notes

- Do **not** use the root app’s `npm run build` for this service — that builds the market UI, not the resolver.
- `npm run bot` starts Next + the Telegram alert bot (if `TELEGRAM_BOT_TOKEN` is set).
- Set secrets in the host dashboard; do not commit `.env`.
