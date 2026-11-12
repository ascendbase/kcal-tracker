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
3. Tap the mic and speak, or type a command

How it works:
- Voice is captured by the browser's built-in speech recognition
  (Web Speech API — works in Chrome / Edge / Android; Safari/Firefox: type instead).
  Dictation is **continuous**: pause between items freely — after 2 s of silence the
  whole transcript is sent as one command (or tap the mic to send immediately).
  A single browser recognition session is capped at ~60 s, so very long lists may
  need two takes. OpenRouter serves **text models only** — the transcript (not audio)
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

### OpenRouter key on Vercel (optional)
The AI works without any deploy config — each device can set its own key in the
app's **AI settings** (stored in localStorage). Alternatively, bake a deployment-wide
key at build time:
1. Vercel project → **Settings → Environment Variables** → add
   `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`, default `openai/gpt-4o-mini`)
2. Redeploy — `vercel.json` runs `node build-env.js`, which writes the values
   into `env.js`, loaded by the app as a fallback when no local key is set.

⚠️ This is a static site: any key baked into `env.js` is **visible in the served
JS** to anyone who opens the site. Fine for a personal tracker only you use —
otherwise prefer the per-device key or a paid, capped OpenRouter key.
