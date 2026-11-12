/* ==========================================
   Kcal Tracker — user-built food database
   + Supabase cloud sync for the foods table
   ========================================== */

const STORAGE_KEY = 'kcal-tracker-v2';
let state = {
    bmr: null,   // BMR — permanent, survives the reset button
    activity: 0, // Activity — resets to 0 on day reset
    deficit: 0,  // Daily deficit goal — permanent, survives the reset button
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
    ['bmrInput', 'activityInput', 'deficitInput', 'addCommentBtn', 'searchInput', 'searchClear', 'foodList', 'customFoodForm',
     'customName', 'customKcal', 'customProtein', 'customFat', 'customCarbs',
     'cancelCustom', 'addCustomBtn', 'loggedList', 'loggedCount', 'emptyState',
     'totalKcal', 'totalProtein', 'totalFat', 'totalCarbs',
     'balanceCard', 'balanceChip', 'balanceValue', 'balanceLabel',
     'macroBar', 'proteinSegment', 'fatSegment', 'carbsSegment',
     'resetBtn', 'quantityModal', 'modalFoodName', 'modalFoodMacros',
     'quantityInput', 'qtyMinus', 'qtyPlus', 'quickAmounts',
     'previewKcal', 'previewProtein', 'previewFat', 'previewCarbs',
     'modalCancel', 'modalConfirm', 'toastContainer',
     'commentModal', 'commentTitle', 'commentName', 'commentKcal', 'commentProtein',
     'commentFat', 'commentCarbs', 'commentCancel', 'commentSave',
     'dbToggle', 'dbBody', 'dbCount',
     'cloudBtn', 'syncDot', 'settingsModal',
     'supaUrl', 'supaKey', 'supaSave', 'supaDisconnect', 'settingsCancel',
     'proteinPct', 'fatPct', 'carbsPct',
     'aiBtn', 'aiModal', 'aiStatus', 'aiTranscript', 'aiMic',
     'aiTextInput', 'aiSend', 'aiExamples', 'aiSettingsToggle',
     'aiClose', 'aiSettings', 'aiKey', 'aiLang', 'aiModel'
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
            state.bmr = typeof p.bmr === 'number' ? p.bmr : null;
            state.activity = typeof p.activity === 'number' ? p.activity : 0;
            state.deficit = typeof p.deficit === 'number' ? p.deficit : 0;
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
        row.className = entry.comment ? 'log-row comment' : 'log-row editable';
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
        if (entry.comment) {
            row.querySelector('.lr-name').textContent = entry.name;
            const hasMacros = (entry.kcal || 0) > 0 || (entry.protein || 0) > 0 || (entry.fat || 0) > 0 || (entry.carbs || 0) > 0;
            row.querySelector('.lr-meta').textContent = hasMacros
                ? `P ${fmt(entry.protein)} · F ${fmt(entry.fat)} · C ${fmt(entry.carbs)}`
                : 'comment';
            row.querySelector('.lr-kcal').textContent = (entry.kcal || 0) > 0 ? `${fmt(entry.kcal, 0)} kcal` : '';
            row.addEventListener('click', e => {
                if (e.target.closest('.lr-del')) return;
                openCommentModal(entry.id);
            });
        } else {
            row.querySelector('.lr-name').textContent = entry.name;
            row.querySelector('.lr-meta').textContent = `${fmt(entry.grams, 0)} g · P ${fmt(entry.protein)} · F ${fmt(entry.fat)} · C ${fmt(entry.carbs)}`;
            row.querySelector('.lr-kcal').textContent = `${fmt(entry.kcal, 0)} kcal`;
            row.addEventListener('click', e => {
                if (e.target.closest('.lr-del')) return;
                openEditSheet(entry.id);
            });
        }
        row.querySelector('.lr-del').addEventListener('click', () => removeLog(entry.id));
        list.appendChild(row);
    });
}

// ---------- Comment (note with optional kcal / macros) ----------
let commentEditId = null;

function openCommentModal(id) {
    commentEditId = id || null;
    const entry = id != null ? state.log.find(i => i.id === id) : null;
    el.commentTitle.textContent = entry ? 'Edit comment' : 'Add comment';
    el.commentName.value = entry ? entry.name : '';
    el.commentKcal.value = entry && entry.kcal > 0 ? entry.kcal : '';
    el.commentProtein.value = entry && entry.protein > 0 ? entry.protein : '';
    el.commentFat.value = entry && entry.fat > 0 ? entry.fat : '';
    el.commentCarbs.value = entry && entry.carbs > 0 ? entry.carbs : '';
    el.commentModal.classList.add('open');
    setTimeout(() => el.commentName.focus(), 380);
}

function closeCommentModal() {
    el.commentModal.classList.remove('open');
    commentEditId = null;
}

function saveComment() {
    const name = el.commentName.value.trim();
    if (!name) { toast('Enter a comment'); return; }
    const num = input => {
        const v = parseFloat(input.value);
        return (!isNaN(v) && v > 0) ? v : 0;
    };
    const data = {
        name,
        kcal: num(el.commentKcal),
        protein: num(el.commentProtein),
        fat: num(el.commentFat),
        carbs: num(el.commentCarbs)
    };
    if (commentEditId != null) {
        const entry = state.log.find(i => i.id === commentEditId);
        if (entry) {
            Object.assign(entry, data);
            saveState();
            renderLog();
            updateTotals();
            toast('Comment updated');
        }
    } else {
        state.log.push({ id: uid(), comment: true, grams: 0, ...data });
        saveState();
        renderLog();
        updateTotals();
        toast('Comment added');
    }
    closeCommentModal();
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

    const goal = getGoal();
    if (goal && goal > 0) {
        const left = goal - t.kcal;
        el.balanceCard.style.display = '';
        if (left > 0) {
            el.balanceChip.className = 'balance-chip deficit';
            el.balanceValue.textContent = fmt(left, 0);
            el.balanceLabel.textContent = `kcal left · target ${fmt(goal, 0)}`;
        } else if (left < 0) {
            el.balanceChip.className = 'balance-chip surplus';
            el.balanceValue.textContent = `+${fmt(-left, 0)}`;
            el.balanceLabel.textContent = `over target ${fmt(goal, 0)}`;
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
let sheetEditId = null; // when set, the sheet edits an existing log entry

function openSheet(food) {
    sheetFood = food;
    sheetEditId = null;
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

// Tap an already-logged food to change its grams. Per-100 g values are
// derived from the entry itself (macros scale linearly with grams).
function openEditSheet(id) {
    const entry = state.log.find(i => i.id === id);
    if (!entry || entry.comment) return;
    const g = entry.grams || 0;
    if (g <= 0) return;
    const f = 100 / g;
    sheetFood = {
        name: entry.name,
        kcal: (entry.kcal || 0) * f,
        protein: (entry.protein || 0) * f,
        fat: (entry.fat || 0) * f,
        carbs: (entry.carbs || 0) * f
    };
    sheetEditId = id;
    el.modalFoodName.textContent = entry.name;
    el.modalFoodMacros.textContent = `Per 100 g — ${fmt(sheetFood.kcal, 0)} kcal · P ${fmt(sheetFood.protein)} · F ${fmt(sheetFood.fat)} · C ${fmt(sheetFood.carbs)}`;
    el.quantityInput.value = g;

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
    sheetEditId = null;
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

    if (sheetEditId != null) {
        // Edit mode: update the existing entry in place
        const entry = state.log.find(i => i.id === sheetEditId);
        if (entry) {
            entry.grams = g;
            entry.kcal = sheetFood.kcal * f;
            entry.protein = sheetFood.protein * f;
            entry.fat = sheetFood.fat * f;
            entry.carbs = sheetFood.carbs * f;
            saveState();
            renderLog();
            updateTotals();
            toast(`Updated · ${fmt(g, 0)} g · ${entry.name}`);
        }
    } else {
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
        toast(`Added ${fmt(g, 0)} g · ${sheetFood.name}`);
    }
    closeSheet();
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

function getTdee() {
    const b = state.bmr || 0;
    const a = state.activity || 0;
    if (b <= 0 && a <= 0) return null;
    return b + a;
}

function getGoal() {
    const tdee = getTdee();
    if (tdee == null) return null;
    return tdee - (state.deficit || 0);
}

function daySig() {
    return JSON.stringify([state.bmr, state.activity, state.deficit, state.log]);
}

function scheduleDayPush() {
    const client = getClient();
    if (!client || suppressDayPush) return;
    const sig = daySig();
    if (sig === lastDaySig) return; // nothing changed since last push
    clearTimeout(dayPushTimer);
    dayPushTimer = setTimeout(() => pushDay(sig), 800);
}

async function pushDay(sig) {
    const client = getClient();
    if (!client) return;
    try {
        const ts = new Date().toISOString();
        const { error } = await client.from('day').upsert({
            id: 'day', bmr: state.bmr, activity: state.activity, deficit: state.deficit, log: state.log, updated_at: ts
        });
        if (error) throw error;
        lastDaySig = sig;
        state.daySavedAt = Date.parse(ts);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    } catch (e) {
        console.warn('day push failed:', e);
        daySyncFailed('Day sync failed — re-run supabase.sql (day table)');
    }
}

// Show the failure once per session instead of spamming toasts
let daySyncFailedShown = false;
function daySyncFailed(msg) {
    if (daySyncFailedShown) return;
    daySyncFailedShown = true;
    toast(msg);
    setSyncStatus('err', msg);
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
            state.bmr = data.bmr == null ? null : +data.bmr;
            state.activity = data.activity == null ? 0 : +data.activity;
            state.deficit = data.deficit == null ? 0 : +data.deficit;
            state.log = Array.isArray(data.log) ? data.log : [];
            state.daySavedAt = cloudTs;
            lastDaySig = daySig();
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
            suppressDayPush = false;
            if (el.bmrInput) el.bmrInput.value = state.bmr || '';
            if (el.activityInput) el.activityInput.value = state.activity || '';
            if (el.deficitInput) el.deficitInput.value = state.deficit || '';
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
        daySyncFailed('Day sync failed — re-run supabase.sql (day table)');
    }
}

// Re-sync when the user returns to the app (another device may have changed
// things while this page was in the background). Throttled to once per 30s.
let lastDayPull = 0;
function refreshDayOnFocus() {
    const now = Date.now();
    if (now - lastDayPull < 30000) return;
    lastDayPull = now;
    pullDay();
}

// Flush any pending debounced push immediately (app going to background /
// being closed right after an edit would otherwise lose the change).
function flushDayPush() {
    if (!dayPushTimer) return;
    clearTimeout(dayPushTimer);
    dayPushTimer = null;
    const sig = daySig();
    if (sig !== lastDaySig) pushDay(sig);
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
    pullDay(); // also adopt/push today's log + inputs
}

function disconnectCloud() {
    saveCfg(null);
    sb = null;
    setSyncStatus('off', 'Cloud not configured');
    closeSettings();
    toast('Cloud disconnected — foods stay in localStorage');
}

function resetDay() {
    if (state.log.length === 0 && !state.activity) { toast('Nothing to reset'); return; }
    if (!confirm('Clear today\'s log and Activity?\nYour food database and BMR are kept.\nThis clears on ALL synced devices.')) return;
    state.log = [];
    state.activity = 0; // BMR stays untouched
    lastDaySig = null;          // force the empty-day push to the cloud
    state.daySavedAt = Date.now();
    saveState();
    el.activityInput.value = '';
    renderLog();
    updateTotals();
    toast('Day reset — cleared on all devices');
}

// ---------- Events ----------
function wireEvents() {
    el.bmrInput.addEventListener('input', () => {
        const v = parseFloat(el.bmrInput.value);
        state.bmr = (!isNaN(v) && v > 0) ? v : null;
        saveState();
        updateTotals();
    });

    el.activityInput.addEventListener('input', () => {
        const v = parseFloat(el.activityInput.value);
        state.activity = (!isNaN(v) && v > 0) ? v : 0;
        saveState();
        updateTotals();
    });

    el.deficitInput.addEventListener('input', () => {
        const v = parseFloat(el.deficitInput.value);
        state.deficit = (!isNaN(v) && v > 0) ? v : 0;
        saveState();
        updateTotals();
    });

    el.addCommentBtn.addEventListener('click', () => openCommentModal());

    // Comment sheet
    el.commentCancel.addEventListener('click', closeCommentModal);
    el.commentSave.addEventListener('click', saveComment);
    el.commentModal.addEventListener('click', e => { if (e.target === el.commentModal) closeCommentModal(); });
    el.commentName.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveComment(); } });

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
     el.bmrInput, el.activityInput, el.deficitInput, el.quantityInput,
     el.commentKcal, el.commentProtein, el.commentFat, el.commentCarbs
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

    // AI voice module
    el.aiBtn.addEventListener('click', openAiSheet);
    el.aiClose.addEventListener('click', closeAiSheet);
    el.aiMic.addEventListener('click', toggleAiListening);
    el.aiSend.addEventListener('click', sendAiText);
    el.aiTextInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sendAiText(); }
    });
    el.aiSettingsToggle.addEventListener('click', () => {
        const show = el.aiSettings.style.display === 'none';
        el.aiSettings.style.display = show ? '' : 'none';
        el.aiSettingsToggle.textContent = show ? 'Hide AI settings' : 'AI settings';
        if (show) {
            const cfg = loadAiCfg();
            el.aiKey.value = cfg?.key || '';
            el.aiModel.value = cfg?.model || '';
            el.aiLang.value = cfg?.lang || '';
        }
    });
    el.aiSettings.addEventListener('change', saveAiCfgFromInputs);

    // Cross-device sync: adopt cloud changes when the app regains focus,
    // and never lose a pending push when it loses focus / is closed.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushDayPush();
        else refreshDayOnFocus();
    });
    window.addEventListener('pagehide', flushDayPush);
    window.addEventListener('beforeunload', flushDayPush);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (el.quantityModal.classList.contains('open')) closeSheet();
            if (el.commentModal.classList.contains('open')) closeCommentModal();
            if (el.aiModal.classList.contains('open')) closeAiSheet();
        }
    });
}

// ---------- Init ----------
function init() {
    cacheElements();
    loadState();
    if (state.bmr) el.bmrInput.value = state.bmr;
    if (state.activity) el.activityInput.value = state.activity;
    if (state.deficit) el.deficitInput.value = state.deficit;
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

/* ==========================================
   AI voice module — Web Speech API (STT) +
   OpenRouter chat completions (JSON actions)
   ========================================== */
const AI_CFG_KEY = 'kcal-ai-cfg';
const AI_DEFAULT_MODEL = 'openai/gpt-4o-mini';
let aiRecognition = null;   // active SpeechRecognition instance
let aiListening = false;
let aiBusy = false;

function loadAiCfg() {
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(AI_CFG_KEY)) || null; } catch (e) { cfg = null; }
    // Fall back to deployment env (env.js written at build time by build-env.js).
    // Per-device key from the settings sheet wins over the env key.
    const env = (typeof window !== 'undefined' && window.ENV) || {};
    if (!cfg || !cfg.key) {
        if (env.OPENROUTER_API_KEY) {
            cfg = {
                key: env.OPENROUTER_API_KEY,
                model: cfg?.model || env.OPENROUTER_MODEL || AI_DEFAULT_MODEL
            };
        } else if (!cfg) {
            cfg = null;
        }
    }
    return cfg;
}

function saveAiCfg(cfg) {
    try { localStorage.setItem(AI_CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
}

function saveAiCfgFromInputs() {
    const key = el.aiKey.value.trim();
    const model = el.aiModel.value.trim();
    const lang = el.aiLang.value || '';
    const existing = loadAiCfg();
    if (!key && existing?.key) {
        // key already set (possibly via env) — just update model / language
        saveAiCfg({ key: existing.key, model: model || existing.model || AI_DEFAULT_MODEL, lang });
        toast('AI settings saved');
        return;
    }
    if (!key) { toast('Enter an OpenRouter API key'); return; }
    saveAiCfg({ key, model: model || AI_DEFAULT_MODEL, lang });
    toast('AI settings saved');
}

function openAiSheet() {
    const cfg = loadAiCfg();
    el.aiStatus.textContent = cfg?.key ? 'Tap the mic and speak' : 'Add your OpenRouter key in AI settings first';
    el.aiStatus.className = 'ai-status';
    el.aiTranscript.textContent = '';
    el.aiTextInput.value = '';
    if (!el.aiExamples.childElementCount) {
        ['150 g chicken breast', 'breakfast: 2 eggs, 60 g oatmeal, 200 ml milk, one banana, coffee with milk',
     'set BMR to 1750', 'remove the coffee', 'add a comment cheat meal, about 1200 kcal',
     'add peanut butter, 590 kcal per 100 g'
    ].forEach(t => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.textContent = t;
            b.addEventListener('click', () => { el.aiTextInput.value = t; sendAiText(); });
            el.aiExamples.appendChild(b);
        });
    }
    el.aiModal.classList.add('open');
}

function closeAiSheet() {
    stopAiListening();
    el.aiModal.classList.remove('open');
}

function sendAiText() {
    const text = el.aiTextInput.value.trim();
    if (!text || aiBusy) return;
    el.aiTextInput.value = '';
    el.aiTranscript.textContent = text;
    runAiCommand(text);
}

function aiSetStatus(msg, cls) {
    el.aiStatus.textContent = msg;
    el.aiStatus.className = cls ? 'ai-status ' + cls : 'ai-status';
}

// ---------- Speech recognition (browser STT) ----------
let aiSilenceTimer = null; // auto-send after this much silence while dictating
let aiBuffer = '';         // finalized text so far

// Voice recognition language: user-selected in AI settings, else the browser's
// locale. The transcript goes to OpenRouter, which replies in the user's language.
function getAiLang() {
    const cfg = loadAiCfg();
    return (cfg && cfg.lang) || navigator.language || 'en-US';
}

function getRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = getAiLang();
    rec.interimResults = true;
    // continuous mode: allows dictating many foods in one session (e.g. 20+ items).
    // Browser engines cap a single recognition session (~60 s in Chrome) but the
    // silence auto-send below normally fires well before that. Chrome also
    // auto-restarts stopped sessions, which onend handling covers.
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) {
                aiBuffer += (aiBuffer ? ' ' : '') + t.trim();
                scheduleAiSilenceSend();
            } else {
                interim += t;
            }
        }
        el.aiTranscript.textContent = (aiBuffer + (interim ? (aiBuffer ? ' ' : '') + interim : '')).trim();
    };
    rec.onerror = e => {
        if (e.error === 'aborted') return; // we stopped it ourselves
        stopAiListening();
        const msg = e.error === 'not-allowed'
            ? 'Microphone blocked — allow it in browser settings'
            : e.error === 'no-speech' ? 'No speech detected, try again'
            : `Voice input error: ${e.error}`;
        aiSetStatus(msg, 'err');
    };
    rec.onend = () => { if (aiListening) stopAiListening(); };
    return rec;
}

// While dictating, every 2 s of silence after a final phrase sends the whole
// buffer as one command — so you can list many foods, pausing naturally.
function scheduleAiSilenceSend() {
    clearTimeout(aiSilenceTimer);
    aiSilenceTimer = setTimeout(() => {
        if (!aiListening) return;
        stopAiListening();
        const text = aiBuffer.trim();
        if (text) runAiCommand(text);
    }, 2000);
}

function toggleAiListening() {
    if (aiListening) {
        // manual stop: send whatever was captured so far
        stopAiListening();
        const text = aiBuffer.trim();
        if (text) runAiCommand(text);
        else aiSetStatus('Nothing captured — tap the mic and speak', 'err');
        return;
    }
    if (aiBusy) return;
    const cfg = loadAiCfg();
    if (!cfg?.key) {
        aiSetStatus('Add your OpenRouter key in AI settings first', 'err');
        el.aiSettings.style.display = '';
        el.aiSettingsToggle.textContent = 'Hide AI settings';
        return;
    }
    const rec = getRecognition();
    if (!rec) { aiSetStatus('Voice input not supported here — use Chrome / Edge, or type instead', 'err'); return; }
    aiRecognition = rec;
    aiListening = true;
    aiBuffer = '';
    clearTimeout(aiSilenceTimer);
    el.aiMic.classList.add('listening');
    aiSetStatus('Dictate freely — pauses between items are fine. Tap mic to send.', 'listening');
    el.aiTranscript.textContent = '';
    try { rec.start(); } catch (e) { stopAiListening(); }
}

function stopAiListening() {
    aiListening = false;
    clearTimeout(aiSilenceTimer);
    aiSilenceTimer = null;
    el.aiMic.classList.remove('listening');
    if (aiRecognition) { try { aiRecognition.stop(); } catch (e) {} aiRecognition = null; }
}

// ---------- OpenRouter call ----------
function aiStateSnapshot() {
    return {
        foods: state.foods.map(f => ({ id: f.id, name: f.name, kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs })), // per 100 g
        log: state.log.map(i => ({ id: i.id, name: i.name, grams: i.grams || 0, kcal: +fmt(i.kcal, 0), protein: +fmt(i.protein), fat: +fmt(i.fat), carbs: +fmt(i.carbs) })),
        bmr: state.bmr, activity: state.activity, deficit: state.deficit,
        totals: { kcal: +fmt(computeTotals().kcal, 0) }
    };
}

function aiSystemPrompt() {
    return `You are the assistant inside a calorie tracker app. The user speaks casually (e.g. "had 150g chicken and some rice", "half the pasta left", "two eggs"). Respond ONLY with a JSON object, no markdown.

Allowed actions (put any number of them in "actions", in order):
- {"action":"log_food","match":"<name to find in foods list>","grams":<number>} — logs a food from the user's foods list (per-100 g values). Use when the food exists in the list.
- {"action":"log_estimated","name":"<display name>","grams":<number or omit>,"kcal":<total kcal>,"protein":<g>,"fat":<g>,"carbs":<g>} — log food NOT in the list. Estimate macros from general nutrition knowledge for the WHOLE eaten amount. Always fill kcal; macros if you can.
- {"action":"edit_log","match":"<name of logged entry>","index":<1-based position in log, optional>,"grams":<new grams, optional>,"kcal":<new total kcal, optional>,"protein":<g, optional>,"fat":<g, optional>,"carbs":<g, optional>} — change an existing logged entry. If only grams change, macros scale proportionally on the client; set kcal/macros only when the user says so.
- {"action":"remove_log","match":"<name of logged entry>","index":<optional>} — remove matching logged entries (first match unless index given).
- {"action":"add_food","name":"<name>","kcal":<per 100 g>,"protein":<per 100 g>,"fat":<per 100 g>,"carbs":<per 100 g>} — add to the foods database (per 100 g values).
- {"action":"update_food","match":"<name in foods list>","kcal":<per 100 g>,"protein":<per 100 g>,"fat":<per 100 g>,"carbs":<per 100 g>} — update a database food (omit fields to keep them).
- {"action":"delete_food","match":"<name in foods list>"} — remove from the foods database.
- {"action":"add_comment","name":"<comment text>","kcal":<total kcal>,"protein":<g>,"fat":<g>,"carbs":<g>} — add a note-style entry (e.g. "coffee with milk", "cheat meal", "fasting day") with optional kcal/macros for the WHOLE item. Omit or use 0 for unknown macros. Also use this when the user explicitly says "add a comment/note".
- {"action":"set_bmr","value":<number>} / {"action":"set_activity","value":<number>} / {"action":"set_deficit","value":<number>} — set TDEE inputs (kcal). "activity" is exercise kcal above BMR.
- {"action":"clear_day"} — clear today's log.

Rules:
- If the user mentions a food that exists in the foods list, ALWAYS prefer log_food with the exact "name" from the list.
- Quantities like "half", "a portion", "one serving" -> grams: use typical serving sizes (e.g. half of a typical cooked serving is about 150-200 g) and say so in the reply. "A bowl of X" when X is in the list -> estimate grams.
- Never invent numbers for log_food — it only needs match + grams.
- For log_estimated, kcal must be positive and realistic.
- reply: short friendly confirmation of what you did or asked, <= 2 sentences, same language as the user.

Response schema:
{"reply":"...","actions":[{...}]}
If the request is ambiguous or a food is not in the list and macros cannot be trusted, still reply and use the closest safe action or no actions.`;
}

async function runAiCommand(transcript) {
    const cfg = loadAiCfg();
    if (!cfg?.key) { aiSetStatus('Add your OpenRouter key in AI settings first', 'err'); return; }
    aiBusy = true;
    el.aiMic.disabled = true;
    aiSetStatus('Thinking…', 'busy');
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${cfg.key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': location.origin || 'https://kcal-tracker.local',
                'X-Title': 'Kcal Tracker'
            },
            body: JSON.stringify({
                model: cfg.model || AI_DEFAULT_MODEL,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: aiSystemPrompt() },
                    { role: 'user', content: `Current app state:\n${JSON.stringify(aiStateSnapshot())}\n\nUser command: "${transcript}"` }
                ]
            })
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(res.status === 401 ? 'Invalid OpenRouter key'
                : res.status === 402 ? 'OpenRouter: out of credits'
                : `OpenRouter error ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
        }
        const data = await res.json();
        let content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('Empty AI response');
        content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(content);
        const applied = applyAiActions(Array.isArray(parsed.actions) ? parsed.actions : []);
        aiSetStatus(parsed.reply || `Done — ${applied} change${applied === 1 ? '' : 's'}`, 'ok');
        if (applied > 0) toast(`AI applied ${applied} change${applied === 1 ? '' : 's'}`);
    } catch (e) {
        console.warn('AI command failed:', e);
        aiSetStatus(e.message || 'AI request failed', 'err');
    } finally {
        aiBusy = false;
        el.aiMic.disabled = false;
    }
}

// ---------- Apply actions (full edit permissions) ----------
function aiNum(v, fallback = 0) {
    const n = parseFloat(v);
    return (!isNaN(n) && n >= 0) ? n : fallback;
}

function aiFindFood(match) {
    const q = String(match || '').trim().toLowerCase();
    if (!q) return null;
    return state.foods.find(f => f.name.toLowerCase() === q)
        || state.foods.find(f => f.name.toLowerCase().includes(q))
        || state.foods.find(f => q.includes(f.name.toLowerCase()));
}

function aiFindLogEntry(match, index) {
    const n = parseInt(index, 10);
    if (Number.isInteger(n) && n >= 1 && n <= state.log.length) return state.log[n - 1];
    const q = String(match || '').trim().toLowerCase();
    if (!q) return null;
    return state.log.find(i => i.name.toLowerCase().includes(q)) || null;
}

function applyAiActions(actions) {
    let applied = 0;
    let needRenderFoods = false, needRenderLog = false;

    actions.forEach(a => {
        if (!a || typeof a !== 'object') return;
        switch (a.action) {
            case 'log_food': {
                const food = aiFindFood(a.match);
                const g = aiNum(a.grams, 0);
                if (!food || g <= 0) return;
                const f = g / 100;
                state.log.push({
                    id: uid(), name: food.name, grams: g,
                    kcal: food.kcal * f, protein: food.protein * f,
                    fat: food.fat * f, carbs: food.carbs * f
                });
                needRenderLog = true; applied++;
                break;
            }
            case 'log_estimated': {
                const kcal = aiNum(a.kcal, 0);
                const name = String(a.name || 'Food').trim();
                if (!name || kcal <= 0) return;
                state.log.push({
                    id: uid(), name, grams: aiNum(a.grams, 0),
                    kcal, protein: aiNum(a.protein, 0), fat: aiNum(a.fat, 0), carbs: aiNum(a.carbs, 0)
                });
                needRenderLog = true; applied++;
                break;
            }
            case 'edit_log': {
                const entry = aiFindLogEntry(a.match, a.index);
                if (!entry) return;
                const newGrams = a.grams != null ? aiNum(a.grams, -1) : null;
                if (newGrams != null && newGrams > 0 && (entry.grams || 0) > 0) {
                    const k = newGrams / entry.grams;
                    entry.grams = newGrams;
                    entry.kcal *= k; entry.protein *= k; entry.fat *= k; entry.carbs *= k;
                }
                if (a.kcal != null) entry.kcal = aiNum(a.kcal, entry.kcal);
                if (a.protein != null) entry.protein = aiNum(a.protein, entry.protein);
                if (a.fat != null) entry.fat = aiNum(a.fat, entry.fat);
                if (a.carbs != null) entry.carbs = aiNum(a.carbs, entry.carbs);
                needRenderLog = true; applied++;
                break;
            }
            case 'remove_log': {
                const entry = aiFindLogEntry(a.match, a.index);
                if (!entry) return;
                state.log = state.log.filter(i => i.id !== entry.id);
                needRenderLog = true; applied++;
                break;
            }
            case 'add_food': {
                const name = String(a.name || '').trim();
                const kcal = aiNum(a.kcal, -1);
                if (!name || kcal < 0) return;
                if (aiFindFood(name)) return; // duplicate — skip, like submitForm
                const food = { id: uid(), name, kcal, protein: aiNum(a.protein, 0), fat: aiNum(a.fat, 0), carbs: aiNum(a.carbs, 0) };
                state.foods.push(food);
                needRenderFoods = true; applied++;
                pushFood(food);
                break;
            }
            case 'update_food': {
                const food = aiFindFood(a.match);
                if (!food) return;
                if (a.kcal != null) food.kcal = aiNum(a.kcal, food.kcal);
                if (a.protein != null) food.protein = aiNum(a.protein, food.protein);
                if (a.fat != null) food.fat = aiNum(a.fat, food.fat);
                if (a.carbs != null) food.carbs = aiNum(a.carbs, food.carbs);
                needRenderFoods = true; needRenderLog = true; applied++;
                pushFood(food);
                break;
            }
            case 'delete_food': {
                const food = aiFindFood(a.match);
                if (!food) return;
                state.foods = state.foods.filter(f => f.id !== food.id);
                state.log = state.log.filter(i => i.name.toLowerCase() !== food.name.toLowerCase());
                needRenderFoods = true; needRenderLog = true; applied++;
                pushDelete(food.id);
                break;
            }
            case 'add_comment': {
                const name = String(a.name || '').trim();
                if (!name) return;
                state.log.push({
                    id: uid(), comment: true, grams: 0, name,
                    kcal: aiNum(a.kcal, 0), protein: aiNum(a.protein, 0),
                    fat: aiNum(a.fat, 0), carbs: aiNum(a.carbs, 0)
                });
                needRenderLog = true; applied++;
                break;
            }
            case 'set_bmr': {
                const v = aiNum(a.value, -1);
                if (v <= 0) return;
                state.bmr = v;
                el.bmrInput.value = v;
                applied++;
                break;
            }
            case 'set_activity':
                state.activity = aiNum(a.value, 0);
                el.activityInput.value = state.activity || '';
                applied++;
                break;
            case 'set_deficit':
                state.deficit = aiNum(a.value, 0);
                el.deficitInput.value = state.deficit || '';
                applied++;
                break;
            case 'clear_day':
                if (state.log.length) applied++;
                state.log = [];
                needRenderLog = true;
                break;
        }
    });

    if (applied > 0) {
        saveState(); // persists + debounced Supabase push of TDEE & log
        if (needRenderFoods) renderFoods();
        if (needRenderLog) renderLog();
        updateTotals();
    }
    return applied;
}