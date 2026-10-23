-- ============================================================
-- Kcal Tracker — Supabase setup
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

create table if not exists public.foods (
    id text primary key,
    name text not null,
    kcal numeric not null check (kcal >= 0),
    protein numeric not null default 0 check (protein >= 0),
    fat numeric not null default 0 check (fat >= 0),
    carbs numeric not null default 0 check (carbs >= 0),
    created_at timestamptz not null default now()
);

-- RLS: the app uses the anon key with no user login (personal-use app).
-- Anyone with your anon key can read/write this table — fine for a
-- private tracker, do NOT put sensitive data here.
alter table public.foods enable row level security;

drop policy if exists "foods anon read" on public.foods;
drop policy if exists "foods anon insert" on public.foods;
drop policy if exists "foods anon delete" on public.foods;

create policy "foods anon read"   on public.foods for select using (true);
create policy "foods anon insert" on public.foods for insert with check (true);
create policy "foods anon delete" on public.foods for delete using (true);

-- ============================================================
-- Day state: TDEE + today's log, synced across devices.
-- Single row (id = 'day'). Newest updated_at wins on conflicts.
-- Re-running this file is safe.
-- ============================================================
create table if not exists public.day (
    id text primary key,
    tdee numeric,
    log jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.day enable row level security;

drop policy if exists "day anon read"   on public.day;
drop policy if exists "day anon insert" on public.day;
drop policy if exists "day anon update" on public.day;

create policy "day anon read"   on public.day for select using (true);
create policy "day anon insert" on public.day for insert with check (true);
create policy "day anon update" on public.day for update using (true);
