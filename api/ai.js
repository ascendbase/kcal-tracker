// Vercel serverless function: proxies chat completions to OpenRouter so the
// API key stays server-side (set as OPENROUTER_API_KEY env var in the Vercel
// project). The static frontend calls this instead of OpenRouter directly.
//
// NOTE: this endpoint is public (same as the site itself). The in-memory rate
// limit below is best-effort; for stronger protection use OpenRouter's credit
// limits or a shared-secret check.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const RATE = { max: 30, windowMs: 60 * 60 * 1000 }; // 30 req/h per IP (best effort)
const hits = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
    if (arr.length >= RATE.max) { hits.set(ip, arr); return true; }
    arr.push(now);
    hits.set(ip, arr);
    return false;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
        res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured on the server' });
        return;
    }
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip)) {
        res.status(429).json({ error: 'Too many requests — try again later' });
        return;
    }
    try {
        const { messages, model } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (!Array.isArray(messages) || !messages.length) {
            res.status(400).json({ error: 'messages array required' });
            return;
        }
        const upstream = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://kcal-tracker.vercel.app',
                'X-Title': 'Kcal Tracker'
            },
            body: JSON.stringify({
                model: model || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
                response_format: { type: 'json_object' },
                messages
            })
        });
        const status = upstream.status;
        const data = await upstream.json().catch(() => ({}));
        res.status(status).json(data); // pass through OpenRouter's response/errors
    } catch (e) {
        res.status(502).json({ error: 'Upstream request failed: ' + (e.message || 'unknown') });
    }
};