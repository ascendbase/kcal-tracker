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
1. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Tap the **mic icon** (top bar) → *AI settings* → paste your key
   (optionally change the model, default `openai/gpt-4o-mini`) → it saves automatically
3. Pick the **voice input language** (Auto / English / Русский / Українська) in the
   same settings — the AI replies in whatever language you speak
4. Tap the mic and speak, or type a command

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

### OpenRouter key on Vercel (recommended setup)
The AI works without any deploy config — each device can set its own key in the
app's **AI settings** (stored in that browser's localStorage). For a
deployment-wide key, use the serverless proxy so the key is **never public**:
1. Vercel project → **Settings → Environment Variables** → add
   `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`, default `openai/gpt-4o-mini`)
2. Redeploy — the frontend calls the same-origin `/api/ai` function
   (`api/ai.js`), which forwards requests to OpenRouter with the key kept
   server-side. No key ever appears in served JS.
3. If `/api/ai` isn't available (e.g. opened as a local file), the app falls
   back to a direct OpenRouter call using the per-device key from AI settings.

⚠️ Never bake the key into static files. The proxy endpoint itself is public
(best-effort 30 req/h per IP rate limit) — set a spend limit on the OpenRouter key.
