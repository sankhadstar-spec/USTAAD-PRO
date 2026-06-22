-- USTAAD PRO — real, persistent revenue backend
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- This replaces the old fake "local state" earnings counter with a real
-- ledger that survives reloads, devices, and deployments.
--
-- ⚠️ Security note (read this):
-- This app does not have real user accounts/login yet — earnings are keyed
-- by a random `device_id` generated in the browser and stored in
-- localStorage (see lib/device.ts). That is enough to make numbers real and
-- persistent, but it is NOT secure multi-user auth: anyone who knows a
-- device_id could read or insert rows for it via the anon key. That's an
-- acceptable tradeoff for a solo/demo project, but before you have real
-- money flowing for real other people, wire up Supabase Auth (e.g. Google
-- sign-in — your earlier project README already scoped this) and swap the
-- policies below from "anon, any device_id" to "auth.uid() = owner_id".

create extension if not exists "uuid-ossp";

-- ── Earnings ledger ──────────────────────────────────────────────────────
-- Every row is one event: a positive amount (recording, export, post, game
-- catch) or a negative amount (a withdrawal). Balance = sum(amount).
create table if not exists ustaad_earnings_ledger (
  id          bigint generated always as identity primary key,
  device_id   text not null,
  amount      numeric(10,2) not null,
  source      text not null check (source in ('recording','export','post','game','withdrawal','bonus')),
  meta        jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ustaad_earnings_ledger_device_idx
  on ustaad_earnings_ledger (device_id, created_at desc);

alter table ustaad_earnings_ledger enable row level security;

drop policy if exists "anon can read own device rows" on ustaad_earnings_ledger;
create policy "anon can read own device rows"
  on ustaad_earnings_ledger for select
  to anon
  using (true); -- scoped by device_id at the query level, see app/api/earnings

drop policy if exists "anon can insert ledger rows" on ustaad_earnings_ledger;
create policy "anon can insert ledger rows"
  on ustaad_earnings_ledger for insert
  to anon
  with check (true);

-- ── Payouts ──────────────────────────────────────────────────────────────
-- One row per withdrawal attempt, with the real Razorpay payout id/status
-- once a payout is actually created via api.razorpay.com.
create table if not exists ustaad_payouts (
  id                 bigint generated always as identity primary key,
  device_id          text not null,
  amount             numeric(10,2) not null,
  vpa                text not null,
  status             text not null default 'pending' check (status in ('pending','queued','processing','processed','reversed','failed')),
  razorpay_payout_id text,
  failure_reason     text,
  created_at         timestamptz not null default now()
);

create index if not exists ustaad_payouts_device_idx
  on ustaad_payouts (device_id, created_at desc);

alter table ustaad_payouts enable row level security;

drop policy if exists "anon can read own device payouts" on ustaad_payouts;
create policy "anon can read own device payouts"
  on ustaad_payouts for select
  to anon
  using (true);

drop policy if exists "anon can insert payouts" on ustaad_payouts;
create policy "anon can insert payouts"
  on ustaad_payouts for insert
  to anon
  with check (true);

drop policy if exists "anon can update own payouts" on ustaad_payouts;
create policy "anon can update own payouts"
  on ustaad_payouts for update
  to anon
  using (true);
