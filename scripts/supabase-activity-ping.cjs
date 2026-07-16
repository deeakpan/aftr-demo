/**
 * Harmless Supabase activity ping — insert a row then delete it.
 * Keeps the project warm / shows activity in the dashboard.
 *
 * Usage: node scripts/supabase-activity-ping.cjs
 */
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const PING_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: insertErr } = await supabase.from("profiles").upsert(
    { address: PING_ADDRESS, name: "_activity_ping" },
    { onConflict: "address" },
  );
  if (insertErr) throw new Error(`insert: ${insertErr.message}`);

  const { error: deleteErr } = await supabase.from("profiles").delete().eq("address", PING_ADDRESS);
  if (deleteErr) throw new Error(`delete: ${deleteErr.message}`);

  const { error: checkpointErr } = await supabase
    .from("indexer_checkpoint")
    .upsert(
      {
        id: "singleton",
        chain_id: 10143,
        last_finalized_block: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  if (checkpointErr) {
    console.warn("indexer_checkpoint bump skipped:", checkpointErr.message);
  } else {
    console.log("indexer_checkpoint updated_at bumped");
  }

  console.log("Supabase activity ping OK (profiles insert + delete)");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
