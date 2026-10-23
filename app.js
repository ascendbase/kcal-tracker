/* ==========================================
   Kcal Tracker — user-built food database
   + Supabase cloud sync for the foods table
   ========================================== */

const STORAGE_KEY = 'kcal-tracker-v2';
let state = {
    tdee: null,
    dbOpen: true, // collapsible "Foods" panel open by default
    daySavedAt: 0, // last synced day-state timestamp (ms)
    foods: [],   // user-created: { id, name, kcal, protein, fat, carbs } per 100g
    log: []      // { id, name, grams, kcal, protein, fat, carbs }
};

// ---------- Decimal input sanitizer (comma -> dot, digits only) ----------
// iOS decimal keyboards sometimes emit a locale comma (e.g. "0,3").
// Normalize it to "0.3" in-place so parseFloat never silently truncates.
function sanitizeDecimalInput(input) {
    input.addEventListener('input', () => {
        const cleaned = input.value.replace(/,/g, '.');
        if (cleaned !== input.value) {
            const pos = input.selectionStart;
            input.value = cleaned;
            try { input.setSelectionRange(pos, pos); } catch (e) {}
        }
    });
    // Safari blocks typing "," into type=number entirely; fall back gracefully:
    input.addEventListener('keydown', e => {
        if (e.key === ',') {
            e.preventDefault();
            const s = input.selectionStart;
            input.value = input.value.slice(0, s) + '.' + input.value.slice(input.selectionEnd);
            const p = s + 1;
            try { input.setSelectionRange(p, p); } catch (e2) {}
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}

const el = {};
function cacheElements() {
    ['tdeeInput', 'searchInput', 'searchClear', 'foodList', 'customFoodForm',
     'customName', 'customKcal', 'customProtein', 'customFat', 'customCarbs',
     'cancelCustom', 'addCustomBtn', 'loggedList', 'loggedCount', 'emptyState',
     'totalKcal', 'totalProtein', 'totalFat', 'totalCarbs',
     'balanceCard', 'balanceChip', 'balanceValue', 'balanceLabel',
     'macroBar', 'proteinSegment', 'fatSegment', 'carbsSegment',
     'resetBtn', 'quantityModal', 'modalFoodName', 'modalFoodMacros',
     'quantityInput', 'qtyMinus', 'qtyPlus', 'quickAmounts',
     'previewKcal', 'previewProtein', 'previewFat', 'previewCarbs',
     'modalCancel', 'modalConfirm', 'toastContainer',
     'dbToggle', 'dbBody', 'dbCount',
     'cloudBtn', 'syncDot', 'settingsModal',
     'supaUrl', 'supaKey', 'supaSave', 'supaDisconnect', 'settingsCancel',
     'proteinPct', 'fatPct', 'carbsPct'
    ].forEach(id => el[id] = document.getElementById(id));
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    scheduleDayPush(); // debounced cloud mirror of TDEE + log (no-op if unchanged/offline)
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') {
            state.tdee = typeof p.tdee === 'number' ? p.tdee : null;
            state.foods = Array.isArray(p.foods) ? p.foods : [];
            state.log = Array.isArray(p.log) ? p.log : [];
            state.dbOpen = typeof p.dbOpen === 'boolean' ? p.dbOpen : true;
            state.daySavedAt = typeof p.daySavedAt === 'number' ? p.daySavedAt : 0;
        }
    } catch (e) {}
}

// ---------- Helpers ----------
function fmt(n, d = 1) {
    const v = Math.round(n * 10 ** d) / 10 ** d;
    return Number.isInteger(v) ? String(v) : v.toFixed(d);
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, dur = 2000) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el.toastContainer.appendChild(t);
    setTimeout(() => {
        t.classList.add('hide');
        setTimeout(() => t.remove(), 260);
    }, dur);
}

function computeTotals() {
    return state.log.reduce((a, i) => ({
        kcal: a.kcal + i.kcal,
        protein: a.protein + i.protein,
        fat: a.fat + i.fat,
        carbs: a.carbs + i.carbs
    }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
}
// ---------- Food database rendering ----------
function filteredFoods() {
    const q = el.searchInput.value.trim().toLowerCase();
    const list = q ? state.foods.filter(f => f.name.toLowerCase().includes(q)) : state.foods;
    // most recently used at top when no query
    return q ? list : [...list].reverse();
}

function renderFoods() {
    const list = el.foodList;
    list.innerHTML = '';
    const foods = filteredFoods();
    el.dbCount.textContent = state.foods.length === 1 ? '1 saved' : `${state.foods.length} saved`;

    if (state.foods.length === 0) {
        const d = document.createElement('div');
        d.className = 'db-empty';
        d.innerHTML = 'Your database is empty.<br><b>Tap “＋ New food”</b> to create your first food.';
        list.appendChild(d);
        return;
    }

    if (foods.length === 0) {
        const d = document.createElement('div');
        d.className = 'db-empty';
        d.textContent = `No foods match “${el.searchInput.value.trim()}”`;
        list.appendChild(d);
        return;
    }

    foods.forEach(food => {
        const row = document.createElement('div');
        row.className = 'food-row';
        row.innerHTML = `
            <div class="fr-info">
                <div class="fr-name"></div>
                <div class="fr-meta"><b>${food.kcal}</b> kcal · P ${fmt(food.protein)} · F ${fmt(food.fat)} · C ${fmt(food.carbs)}</div>
            </div>
            <button class="lr-del fr-del" aria-label="Delete food">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
            <div class="fr-add">＋</div>
        `;
        row.querySelector('.fr-name').textContent = food.name;
        row.addEventListener('click', () => openSheet(food));
        row.querySelector('.fr-del').addEventListener('click', e => {
            e.stopPropagation(); // don't open the quantity sheet
            deleteFood(food.id, food.name);
        });
        list.appendChild(row);
    });
}

// ---------- Log rendering ----------
function renderLog() {
    const list = el.loggedList;
    const n = state.log.length;
    el.loggedCount.textContent = n === 0 ? 'empty' : `${n} item${n > 1 ? 's' : ''}`;
    list.querySelectorAll('.log-row').forEach(r => r.remove());
    el.emptyState.style.display = n === 0 ? '' : 'none';

    [...state.log].reverse().forEach(entry => {
        const row = document.createElement('div');
        row.className = 'log-row';
        row.dataset.id = entry.id;
        row.innerHTML = `
            <div class="lr-info">
                <div class="lr-name"></div>
                <div class="lr-meta"></div>
            </div>
            <div class="lr-kcal"></div>
            <button class="lr-del" aria-label="Remove">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
        `;
        row.querySelector('.lr-name').textContent = entry.name;
        row.querySelector('.lr-meta').textContent = `${fmt(entry.grams, 0)} g · P ${fmt(entry.protein)} · F ${fmt(entry.fat)} · C ${fmt(entry.carbs)}`;
        row.querySelector('.lr-kcal').textContent = `${fmt(entry.kcal, 0)} kcal`;
        row.querySelector('.lr-del').addEventListener('click', () => removeLog(entry.id));
        list.appendChild(row);
    });
}

function removeLog(id) {
    const row = el.loggedList.querySelector(`[data-id="${id}"]`);
    const done = () => {
        state.log = state.log.filter(i => i.id !== id);
        saveState();
        renderLog();
        updateTotals();
    };
    if (row) { row.classList.add('out'); setTimeout(done, 200); } else done();
}

// ---------- Totals / hero ----------
function updateTotals() {
    const t = computeTotals();
    el.totalKcal.textContent = fmt(t.kcal, 0);
    el.totalProtein.textContent = fmt(t.protein);
    el.totalFat.textContent = fmt(t.fat);
    el.totalCarbs.textContent = fmt(t.carbs);

    if (state.tdee && state.tdee > 0) {
        const bal = t.kcal - state.tdee;
        el.balanceCard.style.display = '';
        if (bal < 0) {
            el.balanceChip.className = 'balance-chip deficit';
            el.balanceValue.textContent = `−${fmt(-bal, 0)}`;
            el.balanceLabel.textContent = `deficit · target ${fmt(state.tdee, 0)}`;
        } else if (bal > 0) {
            el.balanceChip.className = 'balance-chip surplus';
            el.balanceValue.textContent = `+${fmt(bal, 0)}`;
            el.balanceLabel.textContent = `surplus · target ${fmt(state.tdee, 0)}`;
        } else {
            el.balanceChip.className = 'balance-chip even';
            el.balanceValue.textContent = '0';
            el.balanceLabel.textContent = 'at target';
        }
    } else {
        el.balanceCard.style.display = 'none';
    }

    const kp = t.protein * 4, kf = t.fat * 9, kc = t.carbs * 4;
    const sum = kp + kf + kc;
    if (sum > 0) {
        el.macroBar.style.display = 'flex';
        const pPct = kp / sum * 100, fPct = kf / sum * 100, cPct = kc / sum * 100;
        el.proteinSegment.style.width = pPct + '%';
        el.fatSegment.style.width = fPct + '%';
        el.carbsSegment.style.width = cPct + '%';
        el.proteinPct.textContent = Math.round(pPct) + '%';
        el.fatPct.textContent = Math.round(fPct) + '%';
        el.carbsPct.textContent = Math.round(cPct) + '%';
    } else {
        el.macroBar.style.display = 'none';
        el.proteinPct.textContent = '0%';
        el.fatPct.textContent = '0%';
        el.carbsPct.textContent = '0%';
    }
}
// ---------- Quantity sheet ----------
let sheetFood = null;

function openSheet(food) {
    sheetFood = food;
    el.modalFoodName.textContent = food.name;
    el.modalFoodMacros.textContent = `Per 100 g — ${food.kcal} kcal · P ${fmt(food.protein)} · F ${fmt(food.fat)} · C ${fmt(food.carbs)}`;
    el.quantityInput.value = 100;

    el.quickAmounts.innerHTML = '';
    [30, 50, 100, 150, 200, 250].forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = a + ' g';
        b.addEventListener('click', () => { el.quantityInput.value = a; updatePreview(); });
        el.quickAmounts.appendChild(b);
    });

    updatePreview();
    el.quantityModal.classList.add('open');
    setTimeout(() => el.quantityInput.select(), 380);
}

function closeSheet() {
    el.quantityModal.classList.remove('open');
    sheetFood = null;
}

function updatePreview() {
    if (!sheetFood) return;
    const g = parseFloat(el.quantityInput.value) || 0;
    const f = g / 100;
    el.previewKcal.textContent = fmt(sheetFood.kcal * f, 0);
    el.previewProtein.textContent = fmt(sheetFood.protein * f) + 'g';
    el.previewFat.textContent = fmt(sheetFood.fat * f) + 'g';
    el.previewCarbs.textContent = fmt(sheetFood.carbs * f) + 'g';
}

function confirmSheet() {
    if (!sheetFood) return;
    const g = parseFloat(el.quantityInput.value);
    if (!g || g <= 0) { toast('Enter a valid amount'); return; }
    const f = g / 100;
    state.log.push({
        id: uid(),
        name: sheetFood.name,
        grams: g,
        kcal: sheetFood.kcal * f,
        protein: sheetFood.protein * f,
        fat: sheetFood.fat * f,
        carbs: sheetFood.carbs * f
    });
    saveState();
    renderLog();
    updateTotals();
    closeSheet();
    toast(`Added ${fmt(g, 0)} g · ${sheetFood.name}`);
}

// ---------- Custom food form ----------
function showForm() {
    el.customFoodForm.style.display = '';
    el.addCustomBtn.textContent = '✕ Close';
    el.customName.focus();
}

function hideForm() {
    el.customFoodForm.style.display = 'none';
    el.customFoodForm.reset();
    el.addCustomBtn.textContent = '＋ New food';
}

function submitForm(e) {
    e.preventDefault();
    const name = el.customName.value.trim();
    const kcal = parseFloat(el.customKcal.value);
    const protein = parseFloat(el.customProtein.value) || 0;
    const fat = parseFloat(el.customFat.value) || 0;
    const carbs = parseFloat(el.customCarbs.value) || 0;

    if (!name) { toast('Enter a food name'); return; }
    if (isNaN(kcal) || kcal < 0) { toast('Enter kcal per 100 g'); return; }
    if (state.foods.some(f => f.name.toLowerCase() === name.toLowerCase())) {
        toast('Already in your database'); return;
    }

    state.foods.push({ id: uid(), name, kcal, protein, fat, carbs });
    saveState();
    hideForm();
    el.searchInput.value = '';
    el.searchClear.classList.remove('show');
    renderFoods();
    toast(`Saved “${name}” to database`);
    // Fire-and-forget cloud push — UI is already updated from localStorage
    pushFood(state.foods[state.foods.length - 1]);
}
// ---------- Supabase cloud sync ----------
// Storage: foods live in localStorage (instant render) and are mirrored
// to a Supabase 'foods' table. Pull = merge (cloud wins by id), then any
// local-only foods are pushed up. New foods push immediately on save.
const CFG_KEY = 'kcal-supabase-cfg';
let sb = null;
let syncBusy = false;

function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch (e) { return null; }
}

function saveCfg(cfg) {
    try {
        if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
        else localStorage.removeItem(CFG_KEY);
    } catch (e) {}
}

function getClient() {
    if (sb) return sb;
    const cfg = loadCfg();
    if (!cfg || !cfg.url || !cfg.key) return null;
    try { sb = supabase.createClient(cfg.url, cfg.key); } catch (e) { return null; }
    return sb;
}

function setSyncStatus(cls, text) {
    if (el.syncDot) {
        el.syncDot.className = 'sync-dot ' + cls;
        el.syncDot.title = text || '';
    }
    if (el.cloudBtn) el.cloudBtn.classList.toggle('on', cls === 'ok');
}

async function syncPull() {
    const client = getClient();
    if (!client) { setSyncStatus('off', 'Cloud not configured — tap the cloud icon'); return; }
    if (syncBusy) return;
    syncBusy = true;
    setSyncStatus('busy', 'Syncing…');
    try {
        const { data, error } = await client
            .from('foods')
            .select('id,name,kcal,protein,fat,carbs')
            .order('created_at', { ascending: true });
        if (error) throw error;

        const cloud = (data || []).map(r => ({
            id: r.id, name: r.name,
            kcal: +r.kcal, protein: +r.protein, fat: +r.fat, carbs: +r.carbs
        }));
        const cloudIds = new Set(cloud.map(f => f.id));

        // Merge: cloud is source of truth; keep local-only foods and push them up
        const localOnly = state.foods.filter(f => !cloudIds.has(f.id));
        state.foods = [...cloud, ...localOnly];
        saveState();
        renderFoods();

        if (localOnly.length) {
            const { error: err2 } = await client.from('foods').insert(
                localOnly.map(f => ({ id: f.id, name: f.name, kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs }))
            );
            if (err2) throw err2;
            toast(`Uploaded ${localOnly.length} food${localOnly.length > 1 ? 's' : ''} to cloud`);
        }
        setSyncStatus('ok', `Synced · ${state.foods.length} foods`);
    } catch (e) {
        console.warn('syncPull failed:', e);
        setSyncStatus('err', 'Sync failed — check URL/key/table');
    } finally {
        syncBusy = false;
    }
}

async function pushFood(food) {
    const client = getClient();
    if (!client) return;
    setSyncStatus('busy', 'Uploading…');
    try {
        const { error } = await client.from('foods').insert({
            id: food.id, name: food.name,
            kcal: food.kcal, protein: food.protein, fat: food.fat, carbs: food.carbs
        });
        if (error) throw error;
        setSyncStatus('ok', 'Synced');
    } catch (e) {
        console.warn('pushFood failed:', e);
        setSyncStatus('err', 'Upload failed — will retry on next sync');
    }
}

// ---------- Delete food (local + cloud) ----------
async function pushDelete(id) {
    const client = getClient();
    if (!client) return;
    setSyncStatus('busy', 'Deleting…');
    try {
        const { error } = await client.from('foods').delete().eq('id', id);
        if (error) throw error;
        setSyncStatus('ok', 'Synced');
    } catch (e) {
        console.warn('pushDelete failed:', e);
        setSyncStatus('err', 'Cloud delete failed — will re-appear on next sync');
    }
}

function deleteFood(id, name) {
    if (!confirm(`Delete “${name}” from your food database?\nIt will also be removed from the cloud.`)) return;
    state.foods = state.foods.filter(f => f.id !== id);
    // Also drop any logged entries of this food from today's log
    state.log = state.log.filter(i => i.name.toLowerCase() !== (name || '').toLowerCase());
    saveState();
    renderFoods();
    renderLog();
    updateTotals();
    toast(`Deleted “${name}”`);
    pushDelete(id);
}

// ---------- Day state sync (TDEE + log) ----------
// Single 'day' row in Supabase. Newest updated_at wins. Local edits push
// (debounced, only when content actually changed); pulls adopt newer cloud
// state. Reset clears local AND cloud, so every device clears together.
let dayPushTimer = null;
let lastDaySig = null;
let suppressDayPush = false;

function daySig() {
    return JSON.stringify([state.tdee, state.log]);
}

function scheduleDayPush() {
    const client = getClient();
    if (!client || suppressDayPush) return;
    const sig = daySig();
    if (sig === lastDaySig) return; // nothing changed since last push
    clearTimeout(dayPushTimer);
    dayPushTimer = setTimeout(async () => {
        const client2 = getClient();
        if (!client2) return;
        try {
            const ts = new Date().toISOString();
            const { error } = await client2.from('day').upsert({
                id: 'day', tdee: state.tdee, log: state.log, updated_at: ts
            });
            if (error) throw error;
            lastDaySig = sig;
            state.daySavedAt = Date.parse(ts);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
        } catch (e) {
            console.warn('day push failed:', e);
        }
    }, 800);
}

async function pullDay() {
    const client = getClient();
    if (!client) return;
    try {
        const { data, error } = await client.from('day').select('*').eq('id', 'day').maybeSingle();
        if (error) throw error;

        if (!data) {
            // First ever sync: seed the cloud with whatever is on this device
            lastDaySig = null;
            scheduleDayPush();
            return;
        }

        const cloudTs = Date.parse(data.updated_at) || 0;
        const localTs = state.daySavedAt || 0;

        if (cloudTs > localTs) {
            // Cloud is newer → adopt it (skip the echo push)
            suppressDayPush = true;
            state.tdee = data.tdee == null ? null : +data.tdee;
            state.log = Array.isArray(data.log) ? data.log : [];
            state.daySavedAt = cloudTs;
            lastDaySig = daySig();
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
            suppressDayPush = false;
            if (el.tdeeInput) el.tdeeInput.value = state.tdee || '';
            renderLog();
            updateTotals();
            if (state.log.length) toast('Day loaded from cloud');
        } else if (localTs > cloudTs) {
            // Local is newer → push it up
            lastDaySig = null;
            scheduleDayPush();
        }
    } catch (e) {
        console.warn('pullDay failed:', e);
    }
}

function openSettings() {
    const cfg = loadCfg();
    el.supaUrl.value = cfg?.url || '';
    el.supaKey.value = cfg?.key || '';
    el.settingsModal.classList.add('open');
}

function closeSettings() {
    el.settingsModal.classList.remove('open');
}

async function saveSettings() {
    const url = el.supaUrl.value.trim().replace(/\/+$/, '');
    const key = el.supaKey.value.trim();
    if (!/^https:\/\/.+\.supabase\.co$/.test(url)) { toast('Enter a valid *.supabase.co URL'); return; }
    if (key.length < 30) { toast('Enter your anon public key'); return; }
    saveCfg({ url, key });
    sb = null;
    closeSettings();
    toast('Cloud connected');
    syncPull();
}

function disconnectCloud() {
    saveCfg(null);
    sb = null;
    setSyncStatus('off', 'Cloud not configured');
    closeSettings();
    toast('Cloud disconnected — foods stay in localStorage');
}

function resetDay() {
    if (state.log.length === 0 && !state.tdee) { toast('Nothing to reset'); return; }
    if (!confirm('Clear today\'s log and TDEE?\nYour food database is kept.\nThis clears on ALL synced devices.')) return;
    state.log = [];
    state.tdee = null;
    lastDaySig = null;          // force the empty-day push to the cloud
    state.daySavedAt = Date.now();
    saveState();
    el.tdeeInput.value = '';
    renderLog();
    updateTotals();
    toast('Day reset — cleared on all devices');
}

// ---------- Events ----------
function wireEvents() {
    el.tdeeInput.addEventListener('input', () => {
        const v = parseFloat(el.tdeeInput.value);
        state.tdee = (!isNaN(v) && v > 0) ? v : null;
        saveState();
        updateTotals();
    });

    el.searchInput.addEventListener('input', () => {
        el.searchClear.classList.toggle('show', el.searchInput.value.length > 0);
        renderFoods();
    });

    el.searchClear.addEventListener('click', () => {
        el.searchInput.value = '';
        el.searchClear.classList.remove('show');
        renderFoods();
        el.searchInput.focus();
    });

    el.addCustomBtn.addEventListener('click', () => {
        el.customFoodForm.style.display === 'none' ? showForm() : hideForm();
    });
    el.cancelCustom.addEventListener('click', hideForm);
    el.customFoodForm.addEventListener('submit', submitForm);

    // Collapsible "Foods" database panel
    el.dbToggle.addEventListener('click', () => {
        state.dbOpen = !state.dbOpen;
        el.dbBody.classList.toggle('open', state.dbOpen);
        el.dbToggle.setAttribute('aria-expanded', String(state.dbOpen));
        saveState();
    });

    // Decimal inputs: allow "0.3" style entry regardless of keyboard locale
    [el.customKcal, el.customProtein, el.customFat, el.customCarbs,
     el.tdeeInput, el.quantityInput
    ].forEach(sanitizeDecimalInput);

    // Cloud sync settings
    el.cloudBtn.addEventListener('click', openSettings);
    el.settingsCancel.addEventListener('click', closeSettings);
    el.supaSave.addEventListener('click', saveSettings);
    el.supaDisconnect.addEventListener('click', disconnectCloud);
    el.settingsModal.addEventListener('click', e => { if (e.target === el.settingsModal) closeSettings(); });

    // Sheet
    el.modalCancel.addEventListener('click', closeSheet);
    el.modalConfirm.addEventListener('click', confirmSheet);
    el.quantityModal.addEventListener('click', e => { if (e.target === el.quantityModal) closeSheet(); });
    el.quantityInput.addEventListener('input', updatePreview);
    el.qtyMinus.addEventListener('click', () => {
        el.quantityInput.value = Math.max(1, (parseFloat(el.quantityInput.value) || 0) - 10);
        updatePreview();
    });
    el.qtyPlus.addEventListener('click', () => {
        el.quantityInput.value = Math.min(5000, (parseFloat(el.quantityInput.value) || 0) + 10);
        updatePreview();
    });
    el.quantityInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); confirmSheet(); }
    });

    el.resetBtn.addEventListener('click', resetDay);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && el.quantityModal.classList.contains('open')) closeSheet();
    });
}

// ---------- Init ----------
function init() {
    cacheElements();
    loadState();
    if (state.tdee) el.tdeeInput.value = state.tdee;
    // Apply saved collapsed/expanded state of the Foods panel
    el.dbBody.classList.toggle('open', state.dbOpen !== false);
    el.dbToggle.setAttribute('aria-expanded', String(state.dbOpen !== false));
    renderFoods();
    renderLog();
    updateTotals();
    wireEvents();
    // Instant localStorage render is done above — now refresh from cloud in
    // the background (no spinner, no blocking; list is already visible).
    syncPull();  // foods database
    pullDay();   // TDEE + today's log
}

document.addEventListener('DOMContentLoaded', init);