# Supabase cloud persistence

Levels and high scores are saved to Supabase (project `ufpiweuhvnefmrjfopso`). The
publishable/anon key is shipped in the client (`src/net/cloud.ts`) — that's expected;
access is governed by the Row Level Security policies below.

## One-time setup — run this SQL

In the Supabase dashboard → **SQL Editor** → paste & **Run**:

```sql
-- Published level set (one shared row, slot = 'main')
create table if not exists public.levels (
  slot       text primary key,
  data       jsonb not null,
  updated_at timestamptz default now()
);

-- Global high-score board
create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  name       text not null,
  score      integer not null,
  created_at timestamptz default now()
);

alter table public.levels enable row level security;
alter table public.scores enable row level security;

-- Public read/write (hobby project). Tighten later (e.g. auth) if you want.
create policy "levels_read"   on public.levels for select using (true);
create policy "levels_insert" on public.levels for insert with check (true);
create policy "levels_update" on public.levels for update using (true) with check (true);
create policy "scores_read"   on public.scores for select using (true);
create policy "scores_insert" on public.scores for insert with check (true);
```

## How the game uses it

- **Levels** (`levels` table, slot `main`):
  - On a **fresh device** (no local edits yet) the game **pulls** the published levels.
  - In the **editor**: **U** publishes your current levels to the cloud; **L** loads them
    back (overwriting the local working copy). Local edits always save to `localStorage`
    too, so editing works offline.
- **High scores** (`scores` table): a qualifying game-over prompts for initials and
  submits to the global board; the game-over screen shows the **WORLD BEST** top 5.

If Supabase is unreachable, everything falls back to `localStorage` automatically.

## Changing the project / keys

Edit `SUPABASE_URL` / `SUPABASE_KEY` in `src/net/cloud.ts`.
