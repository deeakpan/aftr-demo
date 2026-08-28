-- Para API wallet mappings (server-side signing on Vercel — no local .data/ dir).
create table if not exists public.para_wallets (
  owner text primary key,
  wallet_id text not null,
  para_user_id text,
  email text,
  user_identifier text not null,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists para_wallets_wallet_id_idx on public.para_wallets (wallet_id);

alter table public.para_wallets enable row level security;
