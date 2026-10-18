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

test('pending inbox rows are selectable and ratings clearly need no approval', () => {
    const admin = read('admin.html');
    assert.ok(admin.includes('${!decision ? `<label class="inbox-select-label">'));
    assert.ok(admin.includes('يُحتسب تلقائياً — لا يحتاج اعتماداً'));
    assert.ok(!admin.includes("isRating ? '<span>للمراجعة</span>'"));
});

test('inbox selection keeps select-all checked, mixed and empty states in sync', () => {
    const all = {}, count = {};
    let selected = [], total = 3;
    const ctx = vm.createContext({bulkSelectedIds:()=>selected,document:{
        querySelectorAll:()=>Array(total).fill({}), getElementById:id=>id === 'bulkSelectAll' ? all : count}});
    vm.runInContext(extractFn(read('admin.html'),'function updateBulkCount('),ctx);
    ctx.updateBulkCount(); assert.equal(all.checked,false); assert.equal(all.indeterminate,false);
    selected=[1]; ctx.updateBulkCount(); assert.equal(all.indeterminate,true);
    selected=[1,2,3]; ctx.updateBulkCount(); assert.equal(all.checked,true); assert.equal(all.indeterminate,false);
    selected=[]; total=0; ctx.updateBulkCount(); assert.equal(all.disabled,true); assert.equal(all.checked,false);
});

test('admin inbox bounds long contacts and has labelled responsive rows', () => {
    const admin = read('admin.html');
    const css = read('style.css');
    assert.ok(admin.includes('class="inbox-table"'));
    assert.ok(admin.includes('class="inbox-contact" dir="ltr"'));
    for (const label of ['تحديد','النوع','التصنيف','المحافظة','الاسم','الرقم / الرابط','ملاحظات / بلاغ','إجراء']) {
        assert.ok(admin.includes(`data-label="${label}"`), label);
    }
    assert.ok(css.includes('table-layout:fixed'));
    assert.ok(css.includes('.inbox-contact {') && css.includes('overflow-wrap:anywhere'));
    assert.ok(css.includes('.inbox-table tbody tr { display:grid;'));
    assert.ok(css.includes('.inbox-action-buttons > button'));
});

test('stars preview cumulatively on hover and keyboard focus, with numeric labels', () => {
    const css = read('style.css');
    assert.ok(css.includes('.stars-list:has(.star-btn:is(:hover, :focus)) .star-btn'));
    assert.ok(css.includes('.star-btn:has(~ .star-btn:hover)'));
    assert.ok(css.includes('.star-btn:has(~ .star-btn:focus)'));
    assert.ok(css.includes('.star-btn:focus-visible'));
    assert.ok(read('index.html').includes('title="${s}/5 — ${label}"'));
    const hint = css.match(/\.pharmacy-directory-hint\s*\{([^}]+)\}/)[1];
    assert.ok(hint.includes('padding:') && hint.includes('line-height:'));
});

test('structured reports apply only reviewed fields to one exact target and reject stale or unsafe changes', () => {
    const original = {name:'A',phone:'0991111111',address:'old',note:'keep',specialty:'طب',hours:{open:'08:00',close:'12:00',days:[0,1]}};
    const other = {name:'B',phone:'0991111111',note:'unrelated'};
    const data = {services:{clinics:[original,other]},transport:[]};
    const ctx = setup(data);
    const patch = {version:1,target:{name:'A',contact:'0991111111'},base:{name:'A',address:'old',hours:original.hours},
        changes:{name:'New A',address:'new',hours:'09:00-14:00'}};
    const report = {name:'A',phone:'0991111111',notes:'[بلاغ خطأ | الاسم، العنوان، ساعات الدوام]: تصحيح\n[تصحيح:' + encodeURIComponent(JSON.stringify(patch)) + ']'};
    const plan = ctx.planReportCorrection(data, report);
    assert.equal(plan.entry.item, original);
    assert.equal(plan.next.name, 'New A');
    assert.equal(plan.next.address, 'new');
    assert.equal(plan.next.note, 'keep');
    assert.equal(plan.next.specialty, 'طب');
    assert.deepEqual(plan.next.hours.days, [0,1]);
    assert.equal(original.name, 'A', 'planning does not mutate data');
    assert.equal(other.note, 'unrelated');
    assert.ok(ctx.reportNotesSummary(report.notes).includes('العنوان: new'));
    assert.ok(!ctx.reportNotesSummary(report.notes).includes('[تصحيح:'));
    original.address = 'admin updated';
    assert.throws(()=>ctx.planReportCorrection(data, report), /تغيرت البيانات/);
    original.address = 'old';
    assert.throws(()=>ctx.planReportCorrection(data, {...report,name:'B'}), /لا يطابق/);
    data.services.clinics.push(structuredClone(original));
    assert.throws(()=>ctx.planReportCorrection(data, report), /مطابقة وحيدة/);
    assert.equal(ctx.parseReportCorrection('[بلاغ خطأ]: نص قديم'), null);
    assert.throws(()=>ctx.parseReportCorrection('[تصحيح:%invalid]'));
    assert.throws(()=>ctx.validatedReportChanges(original,{base:{name:'A'},changes:{admin:true}}));
    assert.throws(()=>ctx.validatedReportChanges(original,{base:{contact:'0991111111'},changes:{contact:'invalid'}}));
    assert.throws(()=>ctx.validatedReportChanges(original,{base:{hours:original.hours},changes:{hours:'13م-14م'}}));
});

test('correction form serializes selected explicit values without parsing the explanation', () => {
    const ctx = setup({services:{},transport:[]});
    const original = {name:'A',phone:'0991111111',address:'old'};
    const values = {reportName:'New name',reportAddress:'new',reportHours:'',reportPhone:'',reportOther:''};
    ctx.document.getElementById = id => ({value:values[id] || ''});
    const patch = ctx.collectReportCorrections({name:'A',phone:'0991111111',original}, ['الاسم','العنوان']);
    assert.equal(patch.changes.name, 'New name');
    assert.equal(patch.changes.address, 'new');
    assert.equal(patch.base.address, 'old');
    assert.equal(ctx.collectReportCorrections({name:'A',phone:'0991111111',original}, ['رقم الهاتف']), null);
    assert.ok(read('admin.html').includes('async function applyReportCorrection('));
    assert.ok(read('admin.html').includes('persistSuggestionDecisions({[report.reviewKey]:\'resolved\'}, previousData)'));
});

test('all form submissions use real form choices; analytics cannot enter the inbox', () => {
    const index = read('index.html');
    const types = ['اقتراح إضافة رقم أو خدمة جديدة', 'تقييم خدمة موجودة حالياً'];
    const ctx = setup({services:{},transport:[]});
    for (const match of index.matchAll(/fd\.append\(ENTRIES\.type, ["']([^"']+)["']\)/g)) {
        assert.ok(types.includes(match[1]), 'invalid form type: ' + match[1]);
    }
    for (const match of index.matchAll(/fd\.append\(ENTRIES\.category, ["']([^"']+)["']\)/g)) {
        assert.equal(ctx.formCategory(match[1]), match[1], 'invalid form category: ' + match[1]);
    }
    assert.ok(index.includes("fd.append(ENTRIES.notes, '[بحث بدون نتائج]')"));
    assert.ok(read('admin.html').includes("(r[7] || '').includes('[بحث بدون نتائج]')"));
});

test('rating receipt is stable per browser and place, and form categories are valid', () => {
    const ctx = setup({services:{},transport:[]});
    const store = {};
    ctx.portalStorage = {get:k=>store[k], set:(k,v)=>{store[k]=v; return true;}};
    const first = ctx.ratingReceipt('0991111111');
    assert.equal(ctx.ratingReceipt('0991111111'), first);
    assert.notEqual(ctx.ratingReceipt('0992222222'), first);
    assert.equal(ctx.formCategory('إبلاغ عن رقم مقطوع أو مشكلة'), 'أخرى');
    assert.equal(ctx.formCategory('ديليفري وتوصيل طلبات'), 'أخرى');
    assert.equal(ctx.formCategory('صيدليات القدموس'), 'طوارئ ومراكز صحية');
    assert.equal(ctx.formCategory('الأطباء والعيادات'), 'الأطباء والعيادات');
    assert.ok(read('index.html').includes('fd.append(ENTRIES.category, formCategory(category))'));
    const report = read('index.html').split('async function submitReport()')[1];
    assert.ok(report.includes('fd.append(ENTRIES.category, "أخرى")'));
});

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
        assert.ok(index.includes('name="reportFields" value="' + opt + '"'), opt);
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
    ctx.prepareReportCorrections = () => {};
    ctx.collectReportCorrections = () => null;
    ctx.submitWithReceipt = async data => { posted = data; return {confirmed:true}; };
    ctx.openReportModal('مكتبة الفيصل', '0949071072');
    // Empty selection is rejected, then multiple corrections share one submission.
    els.reportNote.value = 'الاسم ناقص';
    await ctx.submitReport();
    assert.equal(posted, null);
    ctx.document.querySelectorAll = () => [{value:'الاسم'}, {value:'العنوان'}];
    await ctx.submitReport();
    const notes = Object.fromEntries(posted.entries())['entry.40821348'];
    assert.ok(notes.includes('[بلاغ خطأ | الاسم، العنوان]:'), notes);
    assert.equal(posted.get('entry.880573565'), 'أخرى');
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

test('admin header has a working light/dark mode switcher', () => {
    const admin = read('admin.html');
    assert.ok(admin.includes('onclick="toggleDarkMode()"'), 'theme button in admin header');
    const attrs = {};
    const docEl = { dataset: {}, style: {},
        setAttribute(k, v) { attrs[k] = v; this.dataset[k.replace('data-', '')] = v; },
        getAttribute(k) { if (k === 'data-theme' && this.dataset.theme) return this.dataset.theme; return attrs[k] || null; } };
    const els = {};
    const mkEl = () => ({ value: '', innerHTML: '', disabled: false, style: {}, classList: { add() {}, remove() {} }, querySelector() { return null; } });
    const store = { susa_theme: 'dark' };
    const toasts = [];
    const ctx = vm.createContext({
        document: { documentElement: docEl,
            getElementById(id) { return els[id] || (els[id] = mkEl()); }, addEventListener() {}, querySelectorAll() { return []; } },
        window: {}, setTimeout: () => 0,
        portalStorage: { get: k => store[k] || null, set: (k, v) => { store[k] = String(v); return true; } },
        showToast: msg => toasts.push(msg),
    });
    vm.runInContext(extractFn(read('shared.js'), 'function applyPortalTheme('), ctx);
    vm.runInContext(extractFn(admin, 'function updateThemeIcon('), ctx);
    vm.runInContext(extractFn(admin, 'function initTheme('), ctx);
    vm.runInContext(extractFn(admin, 'function toggleDarkMode('), ctx);
    ctx.initTheme();
    assert.equal(docEl.dataset.theme, 'dark');
    assert.ok(els.themeIcon.innerHTML.includes('circle'), 'sun icon in dark mode');
    ctx.toggleDarkMode();
    assert.equal(docEl.dataset.theme, 'light');
    assert.equal(store.susa_theme, 'light');
    assert.ok(toasts.length > 0);
});

test('hours free text parses into structured hours and drives the open/closed badge', () => {
    const ctx = setup({services:{},transport:[]});
    const hours = text => ({...ctx.parseHoursText(text)});
    assert.deepEqual(hours('24 ساعة'), {allday:true});
    assert.deepEqual(hours('08:00-22:00'), {open:'08:00',close:'22:00'});
    assert.deepEqual(hours('8ص-10م'), {open:'08:00',close:'22:00'});
    assert.deepEqual(hours('من 8 صباحاً حتى 12 ظهراً'), {open:'08:00',close:'12:00'});
    assert.deepEqual(hours('٩:٣٠-١٨:٠٠'), {open:'09:30',close:'18:00'});
    assert.deepEqual(hours('11 ص - 1 ليلاً'), {open:'11:00',close:'01:00'});
    assert.equal(ctx.parseHoursText('مفتوح دائما'), null);
    assert.equal(ctx.parseHoursText('8:00-8:00'), null);
    for (const invalid of ['13م-14م', '0ص-8ص', '23pm-11pm']) {
        assert.equal(ctx.parseHoursText(invalid), null, invalid);
    }
    assert.equal(ctx.parseHoursText(''), null);
    const badge = (item, now) => ctx.getOpenStatusBadge(item, now);
    assert.ok(badge({hours:{open:'08:00',close:'22:00'}}, {day:2,minutes:9*60}).includes('مفتوح الآن'));
    assert.ok(badge({hours:{open:'08:00',close:'22:00'}}, {day:2,minutes:23*60}).includes('مغلق حالياً'));
    assert.ok(badge({hours:{open:'22:00',close:'02:00'}}, {day:2,minutes:23*60}).includes('مفتوح الآن'), 'overnight range');
    assert.ok(badge({hours:{allday:true}}, {day:2,minutes:9*60}).includes('مفتوح 24 ساعة'));
    assert.ok(badge({hours:{open:'08:00',close:'22:00',days:[0,1]}}, {day:2,minutes:9*60}).includes('مغلق اليوم'));
    assert.equal(badge({}, {day:2,minutes:9*60}), '', 'no hours, no badge');
    const fridayNight = {hours:{open:'22:00',close:'02:00',days:[5]}};
    assert.ok(badge(fridayNight, {day:5,minutes:23*60}).includes('مفتوح الآن'));
    assert.ok(badge(fridayNight, {day:6,minutes:60}).includes('مفتوح الآن'), 'Friday shift continues on Saturday');
    assert.ok(!badge(fridayNight, {day:5,minutes:60}).includes('مفتوح الآن'), 'Friday morning belongs to Thursday');
    assert.ok(!badge(fridayNight, {day:6,minutes:120}).includes('مفتوح الآن'), 'closing boundary');
    const saturdayNight = {hours:{open:'22:00',close:'02:00',days:[6]}};
    assert.ok(badge(saturdayNight, {day:0,minutes:60}).includes('مفتوح الآن'), 'week wraps Saturday to Sunday');
});

test('places sharing a phone get distinct rating and receipt keys', () => {
    const ctx = setup({services:{},transport:[]});
    const keyA = ctx.placeRatingKey('0991111111', 'A');
    const keyB = ctx.placeRatingKey('0991111111', 'B');
    assert.notEqual(keyA, keyB);
    assert.equal(keyA, '0991111111\nA');
    assert.equal(ctx.placeRatingKey(' 0991111111 ', ' A '), keyA);
    const store = {};
    ctx.portalStorage = {get:k=>store[k], set:(k,v)=>{store[k]=v; return true;}};
    assert.notEqual(ctx.ratingReceipt(keyA), ctx.ratingReceipt(keyB));
    assert.ok(read('index.html').includes('rateItem(key, stars, name, btn.dataset.contact)'));
});

test('suggestion form validates hours text and sends it as a notes line', () => {
    const ctx = setup({services:{},transport:[]});
    assert.equal(ctx.suggestionHoursError(''), '');
    assert.equal(ctx.suggestionHoursError('08:00-22:00'), '');
    assert.match(ctx.suggestionHoursError('غدا'), /غير مفهومة/);
    ctx.document.getElementById = id => ({value: id === 'sugHours' ? '8ص-10م' : ''});
    assert.equal(ctx.suggestionHoursNotes(), '\nساعات الدوام: 8ص-10م');
    ctx.document.getElementById = id => ({value: ''});
    assert.equal(ctx.suggestionHoursNotes(), '');
    const index = read('index.html');
    assert.ok(index.includes('id="sugHours"'), 'hours input in suggestion form');
    assert.ok(index.includes('suggestionHoursError('), 'hours validation before submit');
});

test('approved suggestions carry parsed hours and drop the notes line', () => {
    const ctx = setup({services:{restaurants:[]},transport:[]});
    ctx.checkItemExists = () => false;
    const admin = read('admin.html');
    vm.runInContext(admin.slice(admin.indexOf('        function buildApprovedItem('),admin.indexOf('        async function bulkApprove(')),ctx);
    const result = ctx.buildApprovedItem({type:'اقتراح',category:'مطاعم القدموس',name:'Test',phone:'0991111111',city:'القدموس',
        notes:`توصيل للسكن\nساعات الدوام: 8ص-10م\n[طلب:${webcrypto.randomUUID()}]`});
    assert.equal(result.cat,'restaurants');
    assert.deepEqual({...result.newItem.hours}, {open:'08:00',close:'22:00'});
    assert.ok(!result.newItem.note.includes('ساعات الدوام'), result.newItem.note);
    assert.ok(result.newItem.note.includes('توصيل للسكن'));
});

test('category tiles show a count chip and admin hours fields stay wired', () => {
    const index = read('index.html');
    assert.ok(index.includes("chip.className = 'tile-count'"), 'count chip on tiles');
    assert.ok(index.includes('id="sugHours"'));
    const admin = read('admin.html');
    assert.ok(admin.includes('id="newHoursOpen"') && admin.includes('id="editHoursOpen"'), 'admin hours inputs');
    assert.ok(admin.includes('collectHours('), 'admin collects hours');
    const shared = read('shared.js');
    assert.ok(shared.includes('function parseHoursText('));
});

test('seeded opening hours follow the structured schema', () => {
    const data = JSON.parse(read('data.json'));
    const ctx = setup({services:{},transport:[]});
    const entries = [];
    Object.values(data.services).forEach(list => list.forEach(item => { if (item.hours) entries.push(item); }));
    assert.ok(entries.length >= 3, 'seeded hours entries');
    for (const item of entries) {
        assert.ok(ctx.hoursLabel(item.hours), item.name + ' has valid hours');
    }
});
