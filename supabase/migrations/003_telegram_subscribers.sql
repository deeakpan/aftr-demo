-- Zedkr Telegram resolution-bot subscribers (same Supabase project).
-- Run in Supabase SQL editor.

create table if not exists public.telegram_subscribers (
  chat_id bigint primary key,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_notified_markets (
  market_address text primary key,
  notified_at timestamptz not null default now()
);

alter table public.telegram_subscribers enable row level security;
alter table public.telegram_notified_markets enable row level security;

-- No anon/authenticated policies: only service_role (bot) can read/write.
drop policy if exists "service_role_all_telegram_subscribers" on public.telegram_subscribers;
drop policy if exists "service_role_all_telegram_notified_markets" on public.telegram_notified_markets;

-- Optional: allow service role explicitly via bypass (service_role bypasses RLS by default).
-- Keep RLS on so the anon key cannot list chat ids.

comment on table public.telegram_subscribers is 'Telegram private chat ids subscribed to event-resolve DMs';
comment on table public.telegram_notified_markets is 'Event markets already alerted to subscribers (dedupe)';
