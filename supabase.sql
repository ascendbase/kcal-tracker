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
