# Kcal Tracker

Minimal calorie & macro tracker with a personal food database and cloud sync.

## Features
- Log foods with grams; live totals for kcal / protein / fat / carbs
- TDEE input with deficit / surplus indicator
- Personal food database (per-100 g values), searchable, collapsible panel
- Decimal-safe inputs (0.3 works with dot, comma auto-converts)
- Day log + TDEE persist in localStorage; "Reset day" clears only the log/TDEE
- **Supabase cloud sync** of the foods database across devices

## Cloud sync (Supabase)
1. Create a free project at [supabase.com](https://supabase.com)
2. Dashboard → **SQL Editor** → paste & run [`supabase.sql`](supabase.sql)
3. Open the app → tap the **cloud icon** (top bar) → paste your
   **Project URL** and **anon public key** → *Save & sync*

How it behaves:
- The food list renders instantly from localStorage (0 ms).
- A background pull merges the cloud `foods` table (cloud wins by id) and
  uploads any local-only foods — typically completes in 100–300 ms.
- New foods save to localStorage immediately and push to the cloud
  fire-and-forget, so the UI never waits on the network.

## Run locally
Just open `index.html` in a browser, or:
```
python -m http.server 8000
# → http://localhost:8000
```

## Deploy (GitHub + Vercel)
1. `git init && git add . && git commit -m "initial"`
2. Push to a new GitHub repo
3. Import the repo in Vercel (framework: Other, no build settings needed)
