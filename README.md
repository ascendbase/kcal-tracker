# Kcal Tracker

Minimal calorie & macro tracker with a personal food database and cloud sync.

## Features
- Log foods with grams; live totals for kcal / protein / fat / carbs
- TDEE input with deficit / surplus indicator
- Personal food database (per-100 g values), searchable, collapsible panel
- Decimal-safe inputs (0.3 works with dot, comma auto-converts)
- Day log + TDEE persist in localStorage; "Reset day" clears only the log/TDEE
- **Supabase cloud sync** of the foods database across devices

## AI voice logging (OpenRouter)
1. Configure the key once on the server: Vercel → project → Settings →
   Environment Variables → `OPENROUTER_API_KEY` (see below) → redeploy
2. Tap the **mic icon** (top bar) and speak, or type a command — no setup in the UI
3. Optionally pick the **voice input language** (Auto / English / Русский /
   Українська) in the AI sheet — the AI replies in whatever language you speak

How it works:
- Voice is captured by the browser's built-in speech recognition
  (Web Speech API — works in Chrome / Edge / Android; Safari/Firefox: type instead).
  Dictation is **continuous**: it never stops by itself — it sends the transcript
  after **3 s of silence** or when you tap the mic again (a single browser recognition
  session is capped at ~60 s, but it auto-restarts, so dictation continues). OpenRouter serves **text models only** — the transcript (not audio)
  is sent to OpenRouter, so it also works in Safari/Firefox via typing.
- The model receives your current state (foods DB, today's log, BMR/activity/deficit)
  and returns structured JSON actions. The AI has full edit permissions:
  - Log **many foods in one command** (`"breakfast: 2 eggs, 60 g oatmeal, 200 ml milk"`)
  - Log estimated foods with auto-computed macros (`"two slices of pizza"`)
  - Add comment entries with optional kcal / macros (`"add a note — cheat meal, ~1200 kcal"`)
  - Edit / remove log entries, clear the day
  - Add / update / delete foods in the database (synced to Supabase)
  - Set BMR, Activity and Deficit
- Every action is applied locally instantly and synced via the normal save/push path.

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

### OpenRouter key on Vercel
The AI needs zero configuration in the UI: the app calls the same-origin
`/api/ai` serverless function (`api/ai.js`), which forwards requests to
OpenRouter using `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` from the Vercel
project's environment variables. The key is never exposed to the browser.
The only user-facing AI setting is the voice input language.
(If the app is opened without a server — e.g. straight from disk — the proxy
isn't reachable and voice AI won't work; use the deployed URL.)

⚠️ The proxy endpoint itself is public (best-effort 30 req/h per IP rate
limit) — set a spend limit on the OpenRouter key.
