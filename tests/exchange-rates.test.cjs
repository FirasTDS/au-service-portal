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
    const rentalBranch = admin.indexOf("item.category.includes('إيجار')");
    const printingBranch = admin.indexOf("item.category.includes('مكتب')");
    assert.ok(rentalBranch > 0 && rentalBranch < printingBranch);
    const features = read('portal-features.js');
    const ctx = vm.createContext({});
    const fnStart = features.indexOf('function categoryFromLabel(');
    const fnEnd = features.indexOf('}', features.indexOf("return 'restaurants'", fnStart)) + 1;
    vm.runInContext(features.slice(fnStart, fnEnd), ctx);
    assert.equal(ctx.categoryFromLabel('مكاتب الإيجار'), 'rental');
    assert.ok(index.includes("id !== 'list-rental'"), 'empty rental category keeps its tile');
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
