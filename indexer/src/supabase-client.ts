import { createClient } from "@supabase/supabase-js";
import type { IndexerConfig } from "./config.js";

/** Service-role client for server-side ingestion only. */
export function createIndexerSupabase(config: IndexerConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
