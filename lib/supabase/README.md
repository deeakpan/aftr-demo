Supabase setup for profile storage.

Required env vars:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Expected table:
- profiles
  - address (text, unique)
  - name (text)

Usage:
- import { saveUserProfile } from "@/lib/supabase/profiles"
- await saveUserProfile({ address, name })
