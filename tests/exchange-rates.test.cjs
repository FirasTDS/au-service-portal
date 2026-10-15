const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function ratesContext() {
    const store = {};
    const listeners = {};
    const context = vm.createContext({
        document: {
            addEventListener(type, fn) { listeners[type] = fn; },
            getElementById() { return { replaceChildren() {}, append() {}, addEventListener() {}, classList: { toggle() {} } }; }
        },
        portalStorage: { get: k => store[k] || null, set: (k, v) => { store[k] = String(v); return true; } },
        Intl, Date, JSON, Object, Number, setTimeout, clearTimeout, setInterval
    });
    vm.runInContext(read('rates.js'), context);
    return {context, listeners};
}

test('rates.json holds a validated USD-only snapshot from sp-today Damascus', () => {
    const data = JSON.parse(read('rates.json'));
    assert.equal(data.source, 'sp-today.com');
    assert.equal(data.city, 'دمشق');
    assert.equal(data.unit, 'SYP_NEW');
    assert.deepEqual(Object.keys(data.rates), ['USD']);
    const {buy, sell} = data.rates.USD;
    assert.ok(Number.isFinite(buy) && Number.isFinite(sell) && buy <= sell);
    assert.ok(buy >= 20 && sell <= 500);
    const time = Date.parse(data.fetched_at);
    assert.ok(Number.isFinite(time) && time <= Date.now() + 300000);
});

test('shipped rates.js accepts fresh snapshots and rejects wrong source or city', () => {
    const {context} = ratesContext();
    const good = {source:'sp-today.com', city:'دمشق', unit:'SYP_NEW', fetched_at:new Date().toISOString(), rates:{USD:{buy:138.5, sell:139.25}}};
    assert.equal(context.validRates(good), true);
    assert.equal(context.validRates({...good, source:'other.com'}), false);
    assert.equal(context.validRates({...good, city:'حلب'}), false);
    assert.equal(context.validRates({...good, rates:{USD:{buy:139.25, sell:138.5}}}), false);
    assert.equal(context.validRates({...good, rates:{USD:{buy:5, sell:6}}}), false);
    assert.equal(context.validRates({...good, rates:{}}), false);
});

test('shipped style.css has balanced braces outside comments', () => {
    const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, min = 0;
    for (const ch of css) {
        if (ch === '{') depth++;
        if (ch === '}') { depth--; min = Math.min(min, depth); }
    }
    assert.equal(depth, 0, 'unclosed block in style.css');
    assert.equal(min, 0, 'stray closing brace in style.css');
    assert.ok(css.includes('.sy-hub-chips { order: 3;'), 'desktop hub ordering intact');
});

test('flight-packet fixtures decode Damascus USD without touching other cities', () => {
    // Fixture mirrors sp-today flight payloads; the Aleppo numbers are decoys.
    // JSON.parse resolves the escapes exactly like the python parser's decoder,
    // so the search below runs on the decoded inner string in both cases.
    const raw = '[1,"x:[\\"$\\",null,{\\"currency\\":{\\"code\\":\\"USD\\",\\"cities\\":{\\"damascus\\":{\\"buy\\":13850,\\"sell\\":13925},\\"aleppo\\":{\\"buy\\":1,\\"sell\\":2}}}}]"]';
    const packet = 'self.__next_f.push(' + raw + ');';
    const flight = [...packet.matchAll(/self\.__next_f\.push\((\[.*?\])\)/gs)].map(m => JSON.parse(m[1]));
    assert.equal(flight.length, 1);
    assert.equal(flight[0][0], 1);
    const inner = flight[0][1];
    const curIdx = inner.indexOf('"code":"USD"');
    assert.ok(curIdx > 0);
    const damIdx = inner.indexOf('"damascus":{"buy":', curIdx);
    assert.ok(damIdx > curIdx);
    const nums = inner.slice(damIdx).match(/"buy":(\d+),"sell":(\d+)/);
    assert.deepEqual([Number(nums[1]) / 100, Number(nums[2]) / 100], [138.5, 139.25]);
});

test('rental category is wired in directory, suggestion form, admin and mapping', () => {
    const index = read('index.html');
    assert.ok(index.includes('list-rental') && index.includes('count-rental'));
    assert.ok(index.includes('<option value="مكاتب الإيجار">'));
    const data = JSON.parse(read('data.json'));
    assert.ok(Array.isArray(data.services.rental));
    const admin = read('admin.html');
    assert.ok(admin.includes('<option value="rental">'));
    const rentalBranch = admin.indexOf("categoryFromLabel(item.category)");
    assert.ok(rentalBranch > 0, 'approval delegates routing to categoryFromLabel');
    assert.ok(!admin.includes("let cat = 'restaurants'"), 'stale per-branch fallback removed');
    const features = read('portal-features.js');
    const ctx = vm.createContext({});
    const fnStart = features.indexOf('function categoryFromLabel(');
    const fnEnd = features.indexOf('}', features.indexOf("return 'restaurants'", fnStart)) + 1;
    vm.runInContext(features.slice(fnStart, fnEnd), ctx);
    assert.equal(ctx.categoryFromLabel('مكاتب الإيجار'), 'rental');
    assert.ok(index.includes("['list-rental', 'list-university'].includes(id)"), 'empty rental and university categories keep their tiles');
    const appVer = index.match(/APP_VERSION = '(v\d+)'/)[1];
    const verNum = appVer.slice(1);
    for (const asset of ['style.css', 'portal-features.js', 'rates.js']) {
        assert.ok(index.includes(`${asset}?v=${verNum}`), `${asset} cache-bust matches ${appVer}`);
    }
    assert.ok((index.match(/<svg width="13" height="13"/g) || []).length >= 4, 'calculator chip icons carry width/height attributes');
    const yaml = read('.github/workflows/update-rates.yml');
    assert.ok(yaml.includes('scripts/update-rates.py') && yaml.includes('schedule') && yaml.includes('contents: write'));
    new vm.Script(read('rates.js'));
});

function loadFn(ctx, src, marker) {
    const start = src.indexOf(marker);
    let depth = 0;
    let i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') { depth--; if (!depth) { vm.runInContext(src.slice(start, i + 1), ctx); return; } }
    }
    throw new Error('unbalanced ' + marker);
}

function approvalContext(data) {
    const ctx = vm.createContext({ URL, adminData: data, showToast() {}, document: { addEventListener() {} } });
    const shared = read('shared.js');
    vm.runInContext(shared.slice(shared.indexOf('function normalizeContactInput('), shared.indexOf('function validatePortalData(')), ctx);
    const features = read('portal-features.js');
    loadFn(ctx, features, 'function categoryFromLabel(');
    loadFn(ctx, features, 'function cleanSuggestionNotes(');
    const admin = read('admin.html');
    loadFn(ctx, admin, 'function checkItemExists(');
    const buildStart = admin.indexOf('function buildApprovedItem(item) {');
    vm.runInContext(admin.slice(buildStart, admin.indexOf('async function approveSuggestion(id) {')), ctx);
    return ctx;
}

test('rental labels route to rental despite spelling and diacritic variants', () => {
    const ctx = approvalContext({ services: {}, transport: [] });
    for (const label of ['مكاتب الإيجار', 'مكاتب الايجار', 'مكتب إيجار', 'إيجارات شقق', 'مكاتب الإِيجَار', 'عقارات للإيجار']) {
        assert.equal(ctx.categoryFromLabel(label), 'rental', label);
    }
    assert.equal(ctx.categoryFromLabel('مكتبة طباعة'), 'printing');
    assert.equal(ctx.categoryFromLabel('مطعم في القدموس'), 'restaurants');
});

test('approving a rental suggestion builds a rental item, not restaurants', () => {
    const ctx = approvalContext({ services: { rental: [] }, transport: [] });
    const built = ctx.buildApprovedItem({ type: 'اقتراح جديد', category: 'مكاتب الإيجار', name: 'مكتب الحسن للإعمار', phone: '0944866328', notes: '', city: 'القدموس' });
    assert.equal(built.cat, 'rental');
    assert.equal(built.newItem.phone, '0944866328');
});

test('clinics, bakeries, butchers and university labels route to their own categories', () => {
    const ctx = approvalContext({ services: {}, transport: [] });
    const cases = [
        ['الأطباء والعيادات', 'clinics'], ['عيادة الدكتور حسام حمامة', 'clinics'],
        ['طبيب أسنان', 'clinics'], ['مخابز', 'bakeries'], ['مخبز القدموس الآلي', 'bakeries'],
        ['معجنات وفطائر', 'bakeries'], ['ملاحم', 'butchers'], ['فروج أبو علاء', 'butchers'],
        ['ملحمة الدواجن', 'butchers'], ['عيادات جامعة الأندلس', 'university'],
    ];
    for (const [label, expected] of cases) assert.equal(ctx.categoryFromLabel(label), expected, label);
    assert.equal(ctx.categoryFromLabel('مستشفى القدموس الوطني'), 'emergency');
    assert.equal(ctx.categoryFromLabel('مكتبة طباعة'), 'printing');
});

test('new categories are wired in directory, forms, admin and duplicate checks', () => {
    const index = read('index.html');
    for (const key of ['clinics', 'bakeries', 'butchers', 'university']) {
        assert.ok(index.includes(`list-${key}`) && index.includes(`count-${key}`), key + ' card');
    }
    for (const label of ['الأطباء والعيادات', 'مخابز', 'ملاحم', 'عيادات جامعة الأندلس']) {
        assert.ok(index.includes(`<option value="${label}">`), 'suggestion option ' + label);
    }
    const data = JSON.parse(read('data.json'));
    for (const key of ['clinics', 'bakeries', 'butchers', 'university']) {
        assert.ok(Array.isArray(data.services[key]), 'data ' + key);
    }
    assert.ok(data.services.clinics.length >= 10 && data.services.bakeries.length >= 2 && data.services.butchers.length >= 3);
    const admin = read('admin.html');
    for (const [key, label] of [['clinics', 'الأطباء والعيادات'], ['bakeries', 'مخابز'], ['butchers', 'ملاحم'], ['university', 'عيادات جامعة الأندلس']]) {
        assert.ok(admin.includes(`<option value="${key}">`), 'admin option ' + key);
        assert.ok(admin.includes(`${key}: '${label}'`), 'admin label ' + key);
    }
    assert.ok(admin.includes("'sweets', 'rental', 'clinics', 'bakeries', 'butchers', 'university'"), 'duplicate-check covers new categories');
});
