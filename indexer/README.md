# AFTR market indexer

Separate Node process (not Next.js). It walks your parimutuel **market** contracts, pulls `Deposited` and `TokensRedeemed` logs, writes **idempotent** rows to Supabase, and maintains **`(user × market)`** collateral in/out aggregates.

## 1. Schema

Run SQL in **`supabase/migrations/001_indexer_tables.sql`** using the Supabase SQL editor once per project.

## 2. Environment

Copy **`.env.example`** → **`indexer/.env`** and fill:

| Variable | Notes |
|-----------|-------|
| `RPC_URL` | Stable URL (Alchemy / Infura / public). |
| `CHAIN_ID` | Must match RPC (e.g. `84532` Base Sepolia). |
| `FACTORY_ADDRESS` | `AFTRParimutuelMarketFactory` deployment. |
| `SUPABASE_URL` | Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** (server-only; never expose to browsers). |

## 3. Run

From repo root:

```bash
npm install --prefix indexer
npm run dev --prefix indexer
```

Or **`npm run indexer:dev`** if you use the workspace script added to the root `package.json`.

The loop runs every `POLL_INTERVAL_MS` (default 15s).

## Behaviour

- **Checkpoint** row (`id = singleton`) stores the last contiguous block finalized.
- **Overlap** rewinds (`OVERLAP_BLOCKS`) so short reorgs replay safely; aggregates stay correct because raw logs are keyed by `(chain_id, tx_hash, log_index)`.
- **Markets** list comes from **`markets()`** on the factory each tick; RPC log queries are batched by `ADDRESS_BATCH` markets × `BLOCK_CHUNK` block spans.

Older deployments **without** `TokensRedeemed` emission will populate **deposit** side only until you upgrade markets.
