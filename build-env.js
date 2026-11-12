// Writes env.js from Vercel/CI environment variables so the static frontend
// can use them. Locally (no env vars) it keeps the committed stub as-is.
const fs = require('fs');
const key = process.env.OPENROUTER_API_KEY || '';
const model = process.env.OPENROUTER_MODEL || '';
if (!key && !model) {
    console.log('No OpenRouter env vars set — keeping default env.js');
    process.exit(0);
}
const js = `// Auto-generated at build time from Vercel environment variables.
// NOTE: this is a static site, so any value here is visible in the served JS —
// only use a key you are comfortable exposing to users of this deployment.
window.ENV = { OPENROUTER_API_KEY: ${JSON.stringify(key)}, OPENROUTER_MODEL: ${JSON.stringify(model)} };
`;
fs.writeFileSync('env.js', js);
console.log(`env.js written (key: ${key ? 'set' : 'not set'}, model: ${model || 'default'})`);
