-- Run in Supabase SQL editor (once per project). Grants: service_role can read/write; enable RLS optionally.

create table if not exists public.indexer_checkpoint (
  id text primary key default 'singleton',
  chain_id bigint not null,
  last_finalized_block bigint not null default 0,
  updated_at timestamptz default now()
);

comment on table public.indexer_checkpoint is 'Single-row cursor per deployment; safe block after confirmations minus overlap replay.';

create table if not exists public.indexer_markets_registry (
  chain_id bigint not null,
  address text not null,
  inserted_at timestamptz default now(),
  primary key (chain_id, address)
);

create index if not exists indexer_markets_registry_chain_idx on public.indexer_markets_registry (chain_id);

create table if not exists public.indexer_raw_events (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  market_address text not null,
  event_name text not null,
  payload jsonb not null default '{}',
  inserted_at timestamptz default now(),
  primary key (chain_id, tx_hash, log_index)
);

create index if not exists indexer_raw_events_chain_block_idx
  on public.indexer_raw_events (chain_id, block_number);

comment on table public.indexer_raw_events is 'Dedup via primary key — replays overlapping windows without double-counting aggregates.';

-- Per user per market: collateral/shares smallest units stored as numeric strings from chain (wei).
create table if not exists public.market_user_stats (
  chain_id bigint not null,
  market_address text not null,
  user_address text not null,
  collateral_in_wei text not null default '0',
  collateral_out_wei text not null default '0',
  shares_in_wei text not null default '0',
  shares_out_wei text not null default '0',
  updated_at timestamptz default now(),
  primary key (chain_id, market_address, user_address)
);

create index if not exists market_user_stats_user_idx on public.market_user_stats (chain_id, user_address);

-- Idempotent ingest: insert raw row, bump aggregates only when insert wins.
create or replace function public.indexer_ingest_deposited (
  p_chain_id bigint,
  p_tx_hash text,
  p_log_index int,
  p_block_number bigint,
  p_market text,
  p_buyer text,
  p_recipient text,
  p_outcome_index int,
  p_collateral_amount text,
  p_shares_minted text,
  p_price1e18 text
) returns void
language plpgsql
as $$
declare
  inserted_count int := 0;
begin
  insert into public.indexer_raw_events (
    chain_id, tx_hash, log_index, block_number, market_address, event_name, payload
  ) values (
    p_chain_id,
    lower(trim(p_tx_hash)),
    p_log_index,
    p_block_number,
    lower(trim(p_market)),
    'Deposited',
    jsonb_build_object(
      'buyer', lower(trim(p_buyer)),
      'recipient', lower(trim(p_recipient)),
      'outcomeIndex', p_outcome_index,
      'collateralAmount', p_collateral_amount,
      'sharesMinted', p_shares_minted,
      'price1e18', p_price1e18
    )
  )
  on conflict (chain_id, tx_hash, log_index) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.market_user_stats (
      chain_id, market_address, user_address,
      collateral_in_wei, shares_in_wei
    ) values (
      p_chain_id,
      lower(trim(p_market)),
      lower(trim(p_recipient)),
      p_collateral_amount,
      p_shares_minted
    )
    on conflict (chain_id, market_address, user_address)
    do update set
      collateral_in_wei = (
        market_user_stats.collateral_in_wei::numeric + excluded.collateral_in_wei::numeric
      )::text,
      shares_in_wei = (
        market_user_stats.shares_in_wei::numeric + excluded.shares_in_wei::numeric
      )::text,
      updated_at = now();
  end if;
end;
$$;

create or replace function public.indexer_ingest_redeemed (
  p_chain_id bigint,
  p_tx_hash text,
  p_log_index int,
  p_block_number bigint,
  p_market text,
  p_user text,
  p_outcome_index int,
  p_shares text,
  p_payout text
) returns void
language plpgsql
as $$
declare
  inserted_count int := 0;
begin
  insert into public.indexer_raw_events (
    chain_id, tx_hash, log_index, block_number, market_address, event_name, payload
  ) values (
    p_chain_id,
    lower(trim(p_tx_hash)),
    p_log_index,
    p_block_number,
    lower(trim(p_market)),
    'TokensRedeemed',
    jsonb_build_object(
      'user', lower(trim(p_user)),
      'outcomeIndex', p_outcome_index,
      'shares', p_shares,
      'payout', p_payout
    )
  )
  on conflict (chain_id, tx_hash, log_index) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.market_user_stats (
      chain_id, market_address, user_address,
      collateral_out_wei, shares_out_wei
    ) values (
      p_chain_id,
      lower(trim(p_market)),
      lower(trim(p_user)),
      p_payout,
      p_shares
    )
    on conflict (chain_id, market_address, user_address)
    do update set
      collateral_out_wei = (
        market_user_stats.collateral_out_wei::numeric + excluded.collateral_out_wei::numeric
      )::text,
      shares_out_wei = (
        market_user_stats.shares_out_wei::numeric + excluded.shares_out_wei::numeric
      )::text,
      updated_at = now();
  end if;
end;
$$;

comment on function public.indexer_ingest_deposited is 'Dedup deposits by log key; aggregates by recipient.';
comment on function public.indexer_ingest_redeemed is 'Dedup redemption by log key; aggregates by redeemer wallet.';

grant execute on function public.indexer_ingest_deposited to service_role;
grant execute on function public.indexer_ingest_redeemed to service_role;
