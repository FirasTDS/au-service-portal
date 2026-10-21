const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function ratingsContext() {
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
    vm.runInContext(read('ratings.js'), context);
    return {context, listeners};
}

test('rating sort ranks published averages, preserves ties and admin order without mutating data', () => {
    const {context} = ratingsContext();
    context.placeRatingKey = (contact,name) => contact + ':' + name;
    const items=[{name:'unrated',phone:'1'},{name:'low',phone:'2'},
        {name:'high',phone:'3',rating_contact:'alias'},{name:'tie',phone:'4'}];
    assert.deepEqual(Array.from(context.sortByVisitorRating(items)),items,'no ratings preserves custom order');
    context.acceptRatings({source:'google-sheet',fetched_at:new Date().toISOString(),total_ratings:3,
        places:{'2:low':{avg:3,count:1},'alias:high':{avg:5,count:1},'4:tie':{avg:5,count:1}}});
    assert.deepEqual(Array.from(context.sortByVisitorRating(items),i=>i.name),['high','tie','low','unrated']);
    assert.equal(items[0].name,'unrated');
    const html=read('index.html');
    assert.ok(html.indexOf('<option value="rating">') < html.indexOf('<option value="default">'));
    assert.ok(html.includes("if (sortBy === 'rating') return sortByVisitorRating(items);"));
});

test('ratings.json ships a google-sheet snapshot with averaged places', () => {
    const data = JSON.parse(read('ratings.json'));
    assert.equal(data.source, 'google-sheet');
    assert.ok(data.sheet_id && data.sheet_id.length > 10);
    assert.ok(Number.isFinite(Date.parse(data.fetched_at)));
    assert.ok(Date.parse(data.fetched_at) <= Date.now() + 300000);
    assert.ok(Number.isInteger(data.total_ratings) && data.total_ratings >= 0);
    assert.equal(typeof data.places, 'object');
    const totals = Object.values(data.places).reduce((sum, place) => sum + place.count, 0);
    assert.equal(totals, data.total_ratings, 'per-place counts sum to the published total');
});

test('ratings.js accepts fresh averages and rejects foreign or malformed snapshots', () => {
    const {context} = ratingsContext();
    const good = {source:'google-sheet', fetched_at:new Date().toISOString(), total_ratings:3,
        places:{'0991111111':{avg:4.5, count:2}, '0922222222':{avg:2, count:1}}};
    assert.equal(context.validRatings(good), true);
    assert.equal(context.validRatings({...good, source:'sp-today.com'}), false);
    assert.equal(context.validRatings({...good, places:null}), false);
    assert.equal(context.validRatings({...good, places:{'0991111111':{avg:7, count:2}}}), false, 'avg above 5');
    assert.equal(context.validRatings({...good, places:{'0991111111':{avg:4.5, count:0}}}), false, 'zero ratings');
    assert.equal(context.validRatings({...good, fetched_at:new Date(Date.now()+3600000).toISOString()}), false, 'future snapshot');
    assert.equal(context.validRatings(null), false);
});

test('visitor averages render beside the local stars and never show a zero', () => {
    const {context} = ratingsContext();
    assert.equal(context.visitorRatingFor('0991111111'), null, 'no snapshot loaded yet');
    context.acceptRatings({source:'google-sheet', fetched_at:'2026-10-16T21:00:00+00:00', total_ratings:3,
        places:{'0991111111':{avg:4.5, count:2}, '0922222222':{avg:5, count:1}}});
    assert.deepEqual({...context.visitorRatingFor('0991111111')}, {avg:4.5, count:2});
    assert.equal(context.formatVisitorRating(context.visitorRatingFor('0991111111')), '4.5 · 2 تقييمات');
    assert.equal(context.formatVisitorRating(context.visitorRatingFor('0922222222')), '5.0 · تقييم واحد');
    assert.equal(context.visitorRatingFor('0900000000'), null, 'unknown key stays null');
    const index = read('index.html');
    assert.ok(index.includes('rating-average'), 'average chip in the card markup');
    assert.ok(index.includes('visitorRatingFor(key)'), 'average looked up by the local rating key');
    assert.ok(index.includes('ratings.js?v='), 'ratings.js loaded with cache busting');
});

test('an older fallback snapshot cannot overwrite newer visitor averages', () => {
    const {context} = ratingsContext();
    const fresh = {source:'google-sheet', fetched_at:'2026-10-17T21:00:00Z', total_ratings:1,
        places:{'0991111111':{avg:5, count:1}}};
    assert.equal(context.acceptRatings(fresh), true);
    assert.equal(context.acceptRatings({...fresh, fetched_at:'2026-10-16T21:00:00Z', total_ratings:0, places:{}}), false);
    assert.equal(context.visitorRatingFor('0991111111').avg, 5);
});

test('nightly ratings workflow aggregates the form sheet without manual approval', () => {
    const yaml = read('.github/workflows/update-ratings.yml');
    assert.ok(yaml.includes('scripts/update-ratings.py'), 'workflow runs the aggregator');
    assert.ok(yaml.includes('--selftest'), 'aggregator self-tests before publishing');
    assert.ok(yaml.includes('0 21 * * *'), 'runs at 00:00 Damascus (UTC+3)');
    assert.ok(yaml.includes('contents: write') && yaml.includes('git add ratings.json'), 'commits only the snapshot');
    const script = read('scripts/update-ratings.py');
    assert.ok(script.includes('1owergoyNbXTjGCDw6Va0EWXCAIEw15K7lEeZl63CFiI'), 'reads the same sheet as the admin inbox');
    assert.ok(script.includes('gviz/tq?tqx=out:csv'), 'public CSV endpoint, no credentials');
    assert.ok(script.includes("'تقييم'"), 'filters rows to ratings only');
    assert.ok(script.includes('[تعديل تقييم]'), 'rating corrections replace instead of stacking');
});

test('aggregator self-test passes on this machine', () => {
    try {
        const out = execFileSync('python', ['-X', 'utf8', 'scripts/update-ratings.py', '--selftest'], {encoding:'utf8'});
        assert.ok(out.includes('ratings selftest OK'), out);
    } catch (err) {
        if (/ENOENT|not recognized/i.test(String(err))) return; // python absent on this machine
        throw err;
    }
});
