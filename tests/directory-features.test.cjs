const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function setup(data) {
    const context = vm.createContext({URL, structuredClone, crypto:webcrypto, adminData:data,
        document:{addEventListener(){}}, confirm:()=>true, renderAdminLists(){}, showToast(){}});
    const shared = read('shared.js');
    vm.runInContext(shared.slice(shared.indexOf('function normalizeContactInput('), shared.indexOf('function validatePortalData(')), context);
    vm.runInContext(read('portal-features.js'), context);
    return context;
}

test('deleting last transport entry preserves city and metadata for restoration', () => {
    const item = {name:'Test',phone:'0991111111',hours:{allday:true},last_verified:'2026-10-15'};
    const ctx = setup({services:{},transport:[{city:'دمشق',items:[item]}]});
    const record = ctx.trashEntry('transport',0,0);
    assert.equal(ctx.adminData.transport.length,0);
    ctx.restoreTrash(record.id);
    assert.equal(ctx.adminData.transport[0].city,'دمشق');
    assert.deepEqual(ctx.adminData.transport[0].items[0],item);
    assert.equal(ctx.adminData.trash.length,0);
});

test('merge preserves second numbers, notes and delivery details; undo restores both originals', () => {
    const a = {name:'A',phone:'0991111111',note:'first'};
    const b = {name:'B',phone:'0991111111 / 0992222222',note:'second',delivery:{fee:'5000'}};
    const ctx = setup({services:{delivery:[structuredClone(a),structuredClone(b)]},transport:[]});
    ctx.mergeDuplicateEntries({type:'service',cat:'delivery',idx:0},{type:'service',cat:'delivery',idx:1});
    assert.equal(ctx.adminData.services.delivery.length,1);
    assert.equal(ctx.adminData.services.delivery[0].phone,'0991111111 / 0992222222');
    assert.equal(ctx.adminData.services.delivery[0].delivery.fee,'5000');
    assert.match(ctx.adminData.services.delivery[0].note,/second/);
    ctx.restoreTrash(ctx.adminData.trash[0].id);
    assert.deepEqual(ctx.adminData.services.delivery,[a,b]);
});

test('duplicate approval fingerprint changes when another entry starts sharing a number', () => {
    const ctx = setup({services:{delivery:[{name:'A',phone:'0991111111'},{name:'B',phone:'0991111111'}]},transport:[]});
    const group = {key:'p:0991111111',entries:[{type:'service',cat:'delivery',idx:0},{type:'service',cat:'delivery',idx:1}]};
    const first = ctx.duplicateFingerprint(group);
    ctx.adminData.services.delivery.push({name:'C',phone:'0991111111'});
    group.entries.push({type:'service',cat:'delivery',idx:2});
    assert.notEqual(ctx.duplicateFingerprint(group),first);
});

test('multi-service suggestions are allowed but same-category duplicate remains blocked', () => {
    const ctx = setup({services:{taxis:[{name:'A',phone:'0991111111'}]},transport:[]});
    const admin = read('admin.html');
    vm.runInContext(admin.slice(admin.indexOf('        function checkItemExists('),admin.indexOf('        // Approve and automatically')),ctx);
    assert.equal(ctx.checkItemExists('A','0991111111','ديليفري وتوصيل طلبات'),false);
    assert.equal(ctx.checkItemExists('A','0991111111','تكاسي وموتورات داخل القدموس'),true);
});

test('tracking links decisions to random receipt, strips marker from public notes', () => {
    const ctx = setup({services:{},transport:[]});
    const id = webcrypto.randomUUID();
    ctx.liveSuggestions = [{reviewKey:'sheet-hash',notes:`تفاصيل\n[طلب:${id}]`}];
    ctx.updateTrackingDecisions({'sheet-hash':'approved'});
    assert.equal(ctx.adminData.suggestion_status[id].status,'approved');
    ctx.updateTrackingDecisions({'sheet-hash':'ignored'});
    assert.equal(ctx.adminData.suggestion_status[id].status,'rejected');
    ctx.updateTrackingDecisions({'sheet-hash':'pending'});
    assert.equal(ctx.adminData.suggestion_status[id].status,'pending');
    assert.equal(ctx.cleanSuggestionNotes(ctx.liveSuggestions[0].notes),'تفاصيل');
});

test('reorder moves exactly one entry and rejects out of range positions', () => {
    const ctx = setup({services:{},transport:[]});
    const list = ['a','b','c'];
    ctx.moveDirectoryItem(list,0,2);
    assert.deepEqual(list,['b','c','a']);
    ctx.moveDirectoryItem(list,0,-1);
    assert.deepEqual(list,['b','c','a']);
    assert.notEqual(ctx.cityListId('دمشق'),ctx.cityListId('حلب'));
});

test('delivery approval keeps structured details without exposing receipt markers', () => {
    const ctx = setup({services:{},transport:[]});
    ctx.checkItemExists = () => false;
    const admin = read('admin.html');
    vm.runInContext(admin.slice(admin.indexOf('        function buildApprovedItem('),admin.indexOf('        async function bulkApprove(')),ctx);
    const result = ctx.buildApprovedItem({type:'اقتراح',category:'ديليفري وتوصيل طلبات',name:'Test',phone:'0991111111',city:'القدموس',
        notes:`مناطق التوصيل: القدموس\nأجرة التوصيل: حسب المسافة\nنوع الطلبات: أكل\n[طلب:${webcrypto.randomUUID()}]`});
    assert.equal(result.cat,'delivery');
    assert.equal(result.newItem.delivery.areas,'القدموس');
    assert.equal(result.newItem.delivery.fee,'حسب المسافة');
    assert.equal(result.newItem.delivery.kind,'أكل');
    assert.ok(!result.newItem.note.includes('[طلب:'));
});

test('pharmacies directory lists every duty pharmacy once with address and phone', () => {
    const data = JSON.parse(read('data.json'));
    const pharmacies = data.services.pharmacies || [];
    const schedule = data.pharmacies_duty.schedule || [];
    const names = new Set(schedule.map(item => item.pharmacy));
    assert.ok(pharmacies.length >= names.size);
    assert.equal(new Set(pharmacies.map(item => item.name)).size, pharmacies.length);
    const ctx = setup({services:{},transport:[]});
    for (const item of pharmacies) {
        assert.ok(item.address && item.address.trim(), item.name);
        if (item.phone) assert.equal(ctx.normalizeContactInput(item.phone).error, '', item.phone);
        else assert.ok(/^https?:\/\//i.test(item.link || ''), item.name + ' needs phone or link');
    }
    for (const name of names) {
        assert.ok(pharmacies.some(item => item.name === name), name);
    }
    const index = read('index.html');
    assert.ok(index.includes('list-pharmacies') && index.includes('صيدليات القدموس'));
});

test('pharmacy suggestions map to the pharmacies directory, not emergency', () => {
    const ctx = setup({services:{emergency:[],pharmacies:[]},transport:[]});
    ctx.checkItemExists = () => false;
    const admin = read('admin.html');
    vm.runInContext(admin.slice(admin.indexOf('        function buildApprovedItem('),admin.indexOf('        async function bulkApprove(')),ctx);
    const result = ctx.buildApprovedItem({type:'اقتراح',category:'صيدليات القدموس',name:'Test',phone:'0991111111',city:'القدموس',notes:''});
    assert.equal(result.cat,'pharmacies');
    assert.equal(ctx.categoryFromLabel('صيدليات القدموس'),'pharmacies');
});

test('clinics carry specialties, approval parses them, and cards filter by them', () => {    const data = JSON.parse(read('data.json'));
    for (const item of data.services.clinics) {
        assert.ok(item.specialty && item.specialty.trim(), item.name);
    }
    const ctx = setup({services:{clinics:[],university:[]},transport:[]});
    ctx.checkItemExists = () => false;
    const admin = read('admin.html');
    vm.runInContext(admin.slice(admin.indexOf('        function buildApprovedItem('),admin.indexOf('        async function bulkApprove(')),ctx);
    const result = ctx.buildApprovedItem({type:'اقتراح',category:'الأطباء والعيادات',name:'Test',phone:'0991111111',city:'القدموس',notes:'الاختصاص: أسنان'});
    assert.equal(result.cat,'clinics');
    assert.equal(result.newItem.specialty,'أسنان');
    ctx.escapeHtml = s => String(s);
    const html = ctx.contactDetailsHtml({specialty:'أسنان',delivery:{kind:'أكل'}});
    assert.ok(html.includes('الاختصاص: أسنان'), html);
    const index = read('index.html');
    for (const id of ['specialtyFilter', 'uniSpecialtyFilter', 'kindFilter']) {
        assert.ok(index.includes(`id="${id}"`), id);
    }
    assert.ok(index.includes('applyListFilter'));
});

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    let depth = 0;
    let i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
    }
    throw new Error('unbalanced ' + marker);
}

test('detail cards share row height with bottom-aligned actions', () => {
    const css = read('style.css');
    assert.ok(!css.includes('category-items-list { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }'));
    assert.match(css, /\.contact-item\s*\{[^}]*height:\s*100%/);
    assert.match(css, /\.contact-footer\s*\{[^}]*margin-top:\s*auto/);
});

test('report modal specifies which info is wrong and submits it with the report', async () => {
    const index = read('index.html');
    assert.ok(index.includes('id="reportField"'));
    for (const opt of ['رقم الهاتف', 'الاسم', 'العنوان', 'ساعات الدوام', 'معلومة أخرى']) {
        assert.ok(index.includes('<option value="' + opt + '">'), opt);
    }
    const els = {};
    const mkEl = () => ({ value: '', textContent: '', disabled: false, innerHTML: '', style: {},
        classList: { add() {}, remove() {} }, querySelector() { return null; } });
    let posted = null;
    const ctx = vm.createContext({
        document: { getElementById(id) { return els[id] || (els[id] = mkEl()); }, addEventListener() {}, querySelectorAll() { return []; } },
        window: { addEventListener() {} }, setTimeout: () => 0,
        fetch: async (url, opts) => { posted = opts.body; return {}; }, FormData, URL,
    });
    const entriesStart = index.indexOf('const GOOGLE_FORM_URL');
    vm.runInContext(index.slice(entriesStart, index.indexOf('\n    };', entriesStart) + 8) + '\nlet reportingItem = null;', ctx);
    vm.runInContext(extractFn(index, 'function openModal('), ctx);
    vm.runInContext(extractFn(index, 'function openReportModal('), ctx);
    vm.runInContext(extractFn(index, 'async function submitReport('), ctx);
    ctx.openReportModal('مكتبة الفيصل', '0949071072');
    els.reportField.value = 'الاسم';
    els.reportNote.value = 'الاسم ناقص';
    await ctx.submitReport();
    const notes = Object.fromEntries(posted.entries())['entry.40821348'];
    assert.ok(notes.includes('[بلاغ خطأ | الاسم]:'), notes);
    assert.ok(notes.includes('الاسم ناقص'), notes);
});

test('university hospital schedule imports with 18 clinics and weekday lookups', () => {
    const data = JSON.parse(read('data.json'));
    const duty = data.university_clinics;
    assert.ok(duty && duty.hospital.includes('الأندلس'));
    assert.equal(duty.schedule.length, 18);
    for (const row of duty.schedule) {
        assert.ok(row.clinic, 'clinic name');
        assert.ok(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday'].some(k => row[k]), row.clinic);
    }
    const hosp = data.services.university.find(x => x.phone === '0942200443');
    assert.ok(hosp, 'hospital contact in university category');
    const index = read('index.html');
    const ctx = vm.createContext({ Intl, Date, portalData: data,
        document: { getElementById() { return null; }, addEventListener() {}, querySelectorAll() { return []; } } });
    vm.runInContext(extractFn(index, 'function universityWeekdayKey('), ctx);
    vm.runInContext(extractFn(index, 'function getTodayUniversityClinics('), ctx);
    assert.equal(ctx.universityWeekdayKey(new Date('2026-10-17T10:00:00+03:00')), 'saturday');
    assert.equal(ctx.universityWeekdayKey(new Date('2026-10-19T10:00:00+03:00')), 'monday');
    const sat = ctx.getTodayUniversityClinics(new Date('2026-10-17T10:00:00+03:00'));
    assert.equal(sat.closed, false);
    assert.ok(sat.entries.length > 0 && sat.entries.every(e => e.clinic && e.doctor));
    assert.equal(ctx.getTodayUniversityClinics(new Date('2026-10-16T10:00:00+03:00')).closed, true);
    assert.equal(ctx.getTodayUniversityClinics(new Date('2026-10-15T10:00:00+03:00')).closed, true);
    assert.ok(index.includes('openUniversityModal') && index.includes('universityScheduleList'));
});
