Supabase setup for profile storage.

Required env vars (local + Vercel):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — used by `/api/profile` and `/api/leaderboard`)

Expected tables:

- `profiles`
  - `address` (text, unique, lowercase)
  - `name` (text)

- `para_wallets` (Para server-signed wallet mappings — required on Vercel)
  - `owner` (text, primary key, lowercase checksummed address)
  - `wallet_id` (text)
  - `para_user_id` (text, nullable)
  - `email` (text, nullable)
  - `user_identifier` (text)
  - `updated_at` (bigint)

Run `supabase/migrations/002_para_wallets.sql` in the Supabase SQL editor if sign-in fails on production with a missing-table error.

Browser code should use `@/lib/supabase/profiles` (calls `/api/profile`). Do not write to Supabase directly from the client.
