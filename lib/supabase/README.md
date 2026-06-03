Supabase setup for profile storage.

Required env vars (local + Vercel):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — used by `/api/profile` and `/api/leaderboard`)

Expected table:
- `profiles`
  - `address` (text, unique, lowercase)
  - `name` (text)

Browser code should use `@/lib/supabase/profiles` (calls `/api/profile`). Do not write to Supabase directly from the client.
