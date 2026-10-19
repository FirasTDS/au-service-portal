// Shared directory features. Data changes stay in the admin draft until publishing.
function cityListId(city) { return 'list-city-' + encodeURIComponent(city); }

function canonicalCityName(city) {
    const name = String(city || '').normalize('NFKC').replace(/[\u064B-\u065F\u0640]/g,'').replace(/\s+/g,' ').trim();
    return name === 'حماه' ? 'حماة' : name;
}

function inboxKind(item) {
    if (String(item.notes || '').includes('[بلاغ')) return String(item.notes).includes('[تصحيح:') ? 'correction' : 'report';
    return String(item.type || '').includes('تقييم') ? 'rating' : 'suggestion';
}

function applyInboxFilters() {
    const kind = document.getElementById('inboxKind').value;
    const status = document.getElementById('inboxStatus').value;
    let visible = 0;
    document.querySelectorAll('#suggestionsTableBody tr').forEach(row => {
        row.hidden = !!((kind && row.dataset.kind !== kind) || (status && row.dataset.status !== status));
        row.querySelectorAll('input[data-bulk]').forEach(input => { input.disabled = row.hidden; if (row.hidden) input.checked = false; });
        if (!row.hidden) visible++;
    });
    document.getElementById('inboxFilterCount').textContent = `عدد النتائج: ${visible}`;
    updateBulkCount();
}

function setInboxFilter(button) {
    const key = button.dataset.filter;
    if (!['inboxKind','inboxStatus'].includes(key)) return;
    document.getElementById(key).value = button.dataset.value;
    document.querySelectorAll(`button[data-filter="${key}"]`).forEach(candidate => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
    });
    applyInboxFilters();
}

function toggleInboxDetails(button) {
    const expanded = button.closest('tr').classList.toggle('inbox-expanded');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'إخفاء' : 'تفاصيل';
}

function placeMapUrl(item) {
    const value = item.map_url || item.link || '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return '';
        if (url.hostname === 'maps.app.goo.gl' || url.hostname === 'maps.google.com' ||
            (['google.com','www.google.com'].includes(url.hostname) && /^\/maps(?:\/|$)/.test(url.pathname))) return url.href;
    } catch {}
    return '';
}

function openHoursMatch(element) {
    try { return getOpenStatusBadge({hours:JSON.parse(element.dataset.hours || 'null')}).includes('status-badge-open'); }
    catch { return false; }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('openNowOnly')) return;
    const refresh = () => {
        document.querySelectorAll('.contact-item[data-hours]').forEach(card => {
            const slot = card.querySelector('.hours-status');
            if (!slot) return;
            try { const html = getOpenStatusBadge({hours:JSON.parse(card.dataset.hours)}); if (slot.innerHTML !== html) slot.innerHTML = html; } catch {}
        });
        if (document.getElementById('openNowOnly').checked) filterItems();
    };
    setInterval(() => { if (!document.hidden) refresh(); },60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
});

// Keep distinct businesses separate even when they share a telephone number.
function placeRatingKey(contact, name) {
    return String(contact || '').trim() + '\n' + String(name || '').trim();
}

function resolveFavoriteItem(data, favorite) {
    const entries = directoryEntries(data).map(entry => entry.item);
    const exact = entries.filter(item => item.name === favorite.name && contactsOverlap(item.phone || item.link, favorite.phone));
    if (exact.length === 1) return exact[0];
    const named = entries.filter(item => item.name === favorite.name);
    if (named.length === 1) return named[0];
    // Never keep calling a removed or reassigned number from a stale favorite.
    return {name:favorite.name,phone:'',note:'تغيّرت بيانات هذه الجهة أو أُزيلت من الدليل. ابحث عنها مجدداً أو أزلها من المفضلة.'};
}

const REPORT_FIELDS = {contact:['رقم الهاتف','reportPhone'], name:['الاسم','reportName'], address:['العنوان','reportAddress'], hours:['ساعات الدوام','reportHours'], note:['معلومة أخرى','reportOther']};

function reportValue(item, key) {
    return key === 'contact' ? (item.phone || item.link || '') : (item[key] ?? null);
}

function prepareReportCorrections(target) {
    const matches = directoryEntries(portalData).filter(e => e.item.name === target.name && (e.item.phone || e.item.link || '') === target.phone);
    target.original = matches.length === 1 ? structuredClone(matches[0].item) : null;
    Object.values(REPORT_FIELDS).forEach(([,id]) => { document.getElementById(id).value = ''; });
    const first = target.original?.hours?.periods?.[0] || target.original?.hours;
    document.getElementById('reportHoursOpen').value = first?.open || '';
    document.getElementById('reportHoursClose').value = first?.close || '';
    document.getElementById('reportHoursAllDay').checked = !!first?.allday;
    const days = first?.days || [0,1,2,3,4,5,6];
    document.querySelectorAll('#reportHoursDays input').forEach(input => { input.checked = days.includes(Number(input.value)); });
    fillExtraPeriods('report', target.original?.hours);
    updateReportHoursUI();
    const update = () => {
        const selected = [...document.querySelectorAll('#reportField input:checked')].map(input => input.value);
        document.querySelectorAll('[data-correction]').forEach(label => { label.hidden = !selected.includes(label.dataset.correction); });
    };
    document.getElementById('reportField').onchange = update;
    update();
}

function collectReportCorrections(target, selected) {
    const changes = {}, base = {};
    for (const [key, [label,id]] of Object.entries(REPORT_FIELDS)) {
        if (!selected.includes(label)) continue;
        const value = key === 'hours' && document.getElementById('reportHoursOpen') ? collectStructuredReportHours() : document.getElementById(id).value.trim();
        if (!value) continue;
        if (!target.original) throw new Error('تعذر تحديد إدخال وحيد للتعديل. أرسل تفاصيل المشكلة فقط.');
        changes[key] = value;
        base[key] = reportValue(target.original, key);
    }
    if (!Object.keys(changes).length) return null;
    const patch = {version:1, target:{name:target.name, contact:target.phone}, base, changes};
    // Validate on both sides; never infer changes from the free-text explanation.
    validatedReportChanges(target.original, patch);
    return patch;
}

function parseReportCorrection(notes) {
    const match = String(notes || '').match(/\[تصحيح:([^\]\n]+)\]/);
    if (!match) return null; // Legacy free-text reports remain manual.
    if (match[1].length > 30000) throw new Error('حجم التصحيح أكبر من المسموح');
    const patch = JSON.parse(decodeURIComponent(match[1]));
    if (!patch || patch.version !== 1 || !patch.target || !patch.base || !patch.changes || Array.isArray(patch.changes)) throw new Error('صيغة التصحيح غير صالحة');
    return patch;
}

function validatedReportChanges(original, patch) {
    const keys = Object.keys(patch.changes);
    if (!keys.length || keys.some(key => !Object.hasOwn(REPORT_FIELDS, key))) throw new Error('حقول تصحيح غير صالحة');
    const next = structuredClone(original);
    for (const key of keys) {
        if (!Object.hasOwn(patch.base, key) || JSON.stringify(reportValue(original, key)) !== JSON.stringify(patch.base[key])) throw new Error('تغيرت البيانات منذ إرسال البلاغ. راجعها يدوياً.');
        const value = patch.changes[key];
        if (key === 'hours' && value && typeof value === 'object') {
            next.hours = validateReportHours(value);
            continue;
        }
        if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('قيمة التصحيح غير صالحة');
        if (key === 'contact') {
            const contact = normalizeContactInput(value);
            if (contact.error) throw new Error(contact.error);
            delete next.phone; delete next.link;
            next[contact.link ? 'link' : 'phone'] = contact.value;
        } else if (key === 'hours') {
            const hours = parseHoursText(value);
            if (!hours) throw new Error('ساعات الدوام غير مفهومة — مثال: 08:00-22:00');
            // No days were supplied: retain the existing working days.
            if (original.hours?.days) hours.days = structuredClone(original.hours.days);
            next.hours = hours;
        } else next[key] = value.trim();
    }
    return next;
}

function updateReportHoursUI() {
    const allday = document.getElementById('reportHoursAllDay').checked;
    for (const id of ['reportHoursOpen','reportHoursClose']) document.getElementById(id).disabled = allday;
}
function selectReportDays(checked) {
    document.querySelectorAll('#reportHoursDays input').forEach(input => { input.checked = checked; });
}
function validateReportHours(hours) {
    if (Array.isArray(hours.periods)) {
        if (!hours.periods.length || hours.periods.length > 14 || hours.periods.some(period => !period || period.periods)) throw new Error('أدخل من فترة واحدة إلى 14 فترة مستقلة.');
        return {periods:hours.periods.map(validateReportHours)};
    }
    if (!Array.isArray(hours.days) || !hours.days.length || hours.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('اختر يوماً واحداً على الأقل للدوام.');
    const days = [...new Set(hours.days)];
    if (hours.allday === true) return {allday:true,days};
    if (!isValidTime(hours.open) || !isValidTime(hours.close) || hours.open === hours.close) throw new Error('حدّد وقت فتح وإغلاق صحيحين، أو اختر 24 ساعة.');
    return {open:hours.open,close:hours.close,days};
}
function collectStructuredReportHours() {
    const allday = document.getElementById('reportHoursAllDay').checked;
    const open = document.getElementById('reportHoursOpen').value;
    const close = document.getElementById('reportHoursClose').value;
    const first = !allday && !open && !close ? null : validateReportHours({allday,open,close,days:[...document.querySelectorAll('#reportHoursDays input:checked')].map(input => Number(input.value))});
    return collectExtraPeriods('report', first);
}

function ensurePeriodsEditor(prefix) {
    if (document.getElementById(prefix + 'ExtraPeriods')) return;
    const anchor = document.getElementById(prefix + 'HoursDays');
    if (!anchor) return;
    const box = document.createElement('div'); box.id = prefix + 'ExtraPeriods'; box.className = 'extra-periods';
    const button = featureButton('+ إضافة فترة دوام', () => addHoursPeriod(prefix));
    const hint = document.createElement('p'); hint.className = 'contact-note'; hint.textContent = 'أضف فترة لأيام مختلفة أو فترة مسائية. الأيام غير المحددة في أي فترة تُعد مغلقة. الدوام الليلي يبدأ في اليوم المحدد.';
    anchor.parentElement.append(box,button,hint);
}
function addHoursPeriod(prefix, period = {}) {
    ensurePeriodsEditor(prefix);
    const box = document.getElementById(prefix + 'ExtraPeriods');
    if (box.children.length >= 13) return showToast('الحد الأقصى 14 فترة دوام.', 'error');
    const row = document.createElement('fieldset'); row.className = 'hours-period';
    row.innerHTML = '<legend>فترة إضافية</legend><label class="report-check"><input type="checkbox" class="period-allday"> 24 ساعة</label><div class="report-times"><label>يفتح عند<input type="time" class="form-input period-open" dir="ltr"></label><label>يغلق عند<input type="time" class="form-input period-close" dir="ltr"></label></div><div class="report-days"></div>';
    const dayBox = row.querySelector('.report-days');
    [6,0,1,2,3,4,5].forEach(day => {
        const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
        input.type = 'checkbox'; input.className = 'period-day'; input.value = day; input.checked = (period.days || [0,1,2,3,4,5,6]).includes(day);
        text.textContent = AR_DAY_NAMES[day]; label.append(input,text); dayBox.append(label);
    });
    const open = row.querySelector('.period-open'), close = row.querySelector('.period-close'), allday = row.querySelector('.period-allday');
    open.value = period.open || ''; close.value = period.close || ''; allday.checked = !!period.allday;
    allday.onchange = () => { open.disabled = close.disabled = allday.checked; }; allday.onchange();
    row.append(featureButton('حذف هذه الفترة', () => row.remove())); box.append(row);
}
function fillExtraPeriods(prefix, hours) {
    ensurePeriodsEditor(prefix);
    const box = document.getElementById(prefix + 'ExtraPeriods');
    if (!box) return;
    box.replaceChildren();
    (hours?.periods || []).slice(1).forEach(period => addHoursPeriod(prefix, period));
}
function collectExtraPeriods(prefix, first) {
    const box = document.getElementById(prefix + 'ExtraPeriods');
    const periods = first ? [first] : [];
    if (box?.children) [...box.children].forEach(row => {
        periods.push(validateReportHours({allday:row.querySelector('.period-allday').checked,open:row.querySelector('.period-open').value,close:row.querySelector('.period-close').value,
            days:[...row.querySelectorAll('.period-day:checked')].map(input => Number(input.value))}));
    });
    return periods.length > 1 ? {periods} : (periods[0] || null);
}

function planReportCorrection(data, report) {
    const patch = parseReportCorrection(report.notes);
    if (!patch) throw new Error('هذا بلاغ نصي قديم. عدّل البيانات يدوياً.');
    if (patch.target.name !== report.name || patch.target.contact !== report.phone) throw new Error('هدف التصحيح لا يطابق البلاغ');
    const matches = directoryEntries(data).filter(e => e.item.name === patch.target.name && (e.item.phone || e.item.link || '') === patch.target.contact);
    if (matches.length !== 1) throw new Error('لا توجد مطابقة وحيدة للاسم والرقم — راجع يدوياً.');
    const entry = matches[0];
    return {entry, next:validatedReportChanges(entry.item, patch), patch};
}

function reportNotesSummary(notes) {
    const displayNotes = String(notes || '').replace(/\[(?:طلب|تقييم|إرسال):[a-f0-9-]{36}\]/g, '').replace(/\[نسخة تقييم:\d+\]/g, '').replace(/\[القسم: [^\]\n]+\]/g, '').trim();
    try {
        const patch = parseReportCorrection(notes);
        if (!patch) return displayNotes || '—';
        return displayNotes.replace(/\[تصحيح:[^\]\n]+\]/, '').trim() + '\n' +
            Object.entries(patch.changes).map(([key,value]) => `${REPORT_FIELDS[key]?.[0] || key}: ${key === 'hours' && typeof value === 'object' ? hoursLabel(value) : value}`).join('\n');
    } catch { return 'تصحيح غير صالح — راجع البلاغ الأصلي يدوياً.\n' + String(notes); }
}

// These labels must match the actual Google Form choices, not internal categories.
function formCategory(label) {
    const choices = ['مطاعم القدموس', 'سوبر ماركت', 'حلويات وكافيه', 'شركات المواصلات سرفيس او بولمان', 'صهاريج وتعبئة مياه', 'حوالات وشحن طرود', 'مكتبات وطباعة وقرطاسية', 'خدمات وصيانة سكنات', 'طوارئ ومراكز صحية', 'تكاسي وموتورات داخل القدموس', 'مكاتب الإيجار', 'عيادات جامعة الأندلس', 'ملاحم', 'مخابز', 'الأطباء والعيادات', 'أخرى'];
    if (label === 'صيدليات القدموس') return 'طوارئ ومراكز صحية';
    return choices.includes(label) ? label : 'أخرى';
}

function ratingReceipt(key) {
    const storageKey = 'portal_rating_receipt:' + key;
    let id = portalStorage.get(storageKey);
    // Preserve existing identified votes across the switch to contact+name keys.
    // The aggregator also scopes receipts by place, so sharing a legacy receipt
    // does not merge two businesses.
    if (!id && key.includes('\n')) {
        const legacy = portalStorage.get('portal_rating_receipt:' + key.split('\n')[0]);
        if (/^[a-f0-9-]{36}$/.test(legacy || '')) {
            if (!portalStorage.set(storageKey, legacy)) throw new Error('تعذر حفظ معرّف التقييم');
            id = legacy;
        }
    }
    if (!/^[a-f0-9-]{36}$/.test(id || '')) {
        id = crypto.randomUUID();
        if (!portalStorage.set(storageKey, id)) throw new Error('تعذر حفظ معرّف التقييم');
    }
    return id;
}

function nextRatingRevision(receipt) {
    const key = 'portal_rating_revision:' + receipt;
    const previous = Number(portalStorage.get(key) || 0);
    const revision = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
    if (!Number.isSafeInteger(revision) || !portalStorage.set(key, String(revision))) throw new Error('تعذر حفظ إصدار التقييم');
    return revision;
}

function categoryFromLabel(label) {
    label = String(label || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    if (/[إأآا]يجار|عقارات|rental/i.test(label)) return 'rental';
    if (/جامعة الأندلس/.test(label)) return 'university';
    if (/أطباء|عيادات|عيادة|طبيب|أسنان|دكتور|دكتورة/.test(label)) return 'clinics';
    if (/مخابز|مخبز|فرن|فطائر|فطاير|معجنات/.test(label)) return 'bakeries';
    if (/ملاحم|ملحمة|ملحم|لحوم|فروج|دواجن/.test(label)) return 'butchers';
    if (/صيدليات القدموس/.test(label)) return 'pharmacies';
    if (/ديليفري|ديلفري|توصيل/.test(label)) return 'delivery';
    if (/تكاسي|تاكسي|تكسي|موتور/.test(label)) return 'taxis';
    if (/طوارئ|صيدلي|إسعاف|مشفى|مستشفى|مستوصف|صحي/.test(label)) return 'emergency';
    if (/سوبر|ماركت/.test(label)) return 'supermarkets';
    if (/مياه|صهريج|صهاريج|تعبئة/.test(label)) return 'water';
    if (/حوال|شحن|طرد|الهرم|الفؤاد/.test(label)) return 'transfers';
    if (/مكتب|طباعة|قرطاسية/.test(label)) return 'printing';
    if (/صيانة|كهرباء|سكن/.test(label)) return 'maintenance';
    if (/حلو|كافيه/.test(label)) return 'sweets';
    if (/مواصلات|سرفيس|بولمان/.test(label)) return 'transport';
    return 'restaurants';
}

function directoryEntries(data) {
    const entries = [];
    Object.entries(data.services || {}).forEach(([cat, list]) => list.forEach((item, idx) => entries.push({type:'service', a:cat, b:idx, item, label:cat})));
    (data.transport || []).forEach((group, gi) => group.items.forEach((item, ii) => entries.push({type:'transport', a:gi, b:ii, item, label:group.city})));
    return entries;
}

function contactsOverlap(a, b) {
    const x = normalizeContactInput(a), y = normalizeContactInput(b);
    if (x.error || y.error) return false;
    return x.link || y.link ? Boolean(x.link && x.link === y.link) : x.phones.some(p => y.phones.includes(p));
}

function contactDetailsHtml(item) {
    const d = item.delivery || {};
    const map = placeMapUrl(item);
    let website = '';
    try { const url = new URL(item.website); if (url.protocol === 'https:') website = url.href; } catch {}
    return (website ? `<a class="btn-secondary map-link" href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">صفحة المكان ↗</a>` : '') + (map ? `<a class="btn-secondary map-link" href="${escapeHtml(map)}" target="_blank" rel="noopener noreferrer">الموقع على الخريطة ↗</a>` : '') + `<div class="contact-note">${item.last_verified ? `آخر تحقق: ${escapeHtml(item.last_verified)}` : 'لم يُسجّل تاريخ تحقق بعد'}</div>` +
        [item.specialty && `الاختصاص: ${item.specialty}`,
         d.areas && `مناطق التوصيل: ${d.areas}`, d.fee && `أجرة التوصيل: ${d.fee}`, d.kind && `نوع الطلبات: ${d.kind}`]
        .filter(Boolean).map(text => `<div class="contact-note">${escapeHtml(text)}</div>`).join('');
}

function featureButton(text, onClick) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn-secondary'; button.textContent = text; button.onclick = onClick;
    return button;
}

function extraFields(prefix, anchor, includeDate = true) {
    if (!anchor || document.getElementById(prefix + 'Extras')) return;
    const box = document.createElement('fieldset'); box.id = prefix + 'Extras'; box.className = 'extra-fields';
    const legend = document.createElement('legend'); legend.textContent = includeDate ? 'التحقق وتفاصيل التوصيل (اختياري)' : 'تفاصيل التوصيل (اختياري)'; box.append(legend);
    const fields = [['Areas','مناطق التوصيل'], ['Fee','أجرة التوصيل (مثال: حسب المسافة)'], ['Kind','نوع الطلبات (أكل / مشاوير / كلاهما)'], ['Specialty','الاختصاص (للأطباء والعيادات فقط)']];
    if (includeDate) fields.unshift(['Verified','تاريخ آخر تحقق فعلي من الرقم'], ['Map','رابط Google Maps المؤكد (اختياري)']);
    fields.forEach(([key, text]) => {
        const label = document.createElement('label'); label.className = 'form-label'; label.textContent = text;
        const input = document.createElement('input'); input.id = prefix + key; input.className = 'form-input'; input.type = key === 'Verified' ? 'date' : 'text';
        if (key === 'Map') { input.type = 'url'; input.oninput = () => input.setCustomValidity(!input.value || placeMapUrl({map_url:input.value}) ? '' : 'أدخل رابط Google Maps صالحاً يبدأ بـ https'); }
        if (key === 'Verified') input.max = new Date().toISOString().slice(0,10);
        label.append(input); box.append(label);
    });
    anchor.after(box);
}

function fillExtraFields(prefix, item) {
    const values = {Map:item.map_url || '', Verified:item.last_verified || '', Areas:item.delivery?.areas || '', Fee:item.delivery?.fee || '', Kind:item.delivery?.kind || '', Specialty:item.specialty || ''};
    Object.entries(values).forEach(([key, value]) => { const el = document.getElementById(prefix + key); if (el) el.value = value; });
}

function applyExtraFields(prefix, item) {
    const value = key => document.getElementById(prefix + key)?.value.trim() || '';
    if (value('Map')) item.map_url = placeMapUrl({map_url:value('Map')}); else delete item.map_url;
    if (value('Verified')) item.last_verified = value('Verified'); else delete item.last_verified;
    const delivery = {areas:value('Areas'), fee:value('Fee'), kind:value('Kind')};
    if (Object.values(delivery).some(Boolean)) item.delivery = delivery; else delete item.delivery;
    if (value('Specialty')) item.specialty = value('Specialty'); else delete item.specialty;
}

function suggestionDeliveryNotes() {
    const cat = document.getElementById('sugCategory').value;
    if (cat !== 'ديليفري وتوصيل طلبات' && cat !== 'الأطباء والعيادات' && cat !== 'عيادات جامعة الأندلس') return '';
    const rows = [['Areas','مناطق التوصيل'],['Fee','أجرة التوصيل'],['Kind','نوع الطلبات'],['Specialty','الاختصاص']];
    return rows.map(([key,label]) => {
        const value = document.getElementById('sug' + key)?.value.trim(); return value ? `\n${label}: ${value}` : '';
    }).join('');
}

function cleanSuggestionNotes(notes) { return String(notes || '').replace(/\[(?:طلب|إرسال):[a-f0-9-]{36}\]/g, '').replace(/\[القسم: [^\]\n]+\]/g, '').trim(); }

// Optional opening hours from the suggestion form travel inside the notes entry.
function suggestionHoursNotes() {
    const value = document.getElementById('sugHours')?.value.trim();
    return value ? `\nساعات الدوام: ${value}` : '';
}

function suggestionHoursError(hoursText) {
    if (!hoursText) return '';
    return parseHoursText(hoursText) ? '' : 'صيغة ساعات الدوام غير مفهومة — مثال: 08:00-22:00 أو 8ص-10م أو 24 ساعة';
}

function trackingIdFromNotes(notes) { return String(notes || '').match(/\[طلب:([a-f0-9-]{36})\]/)?.[1]; }

function updateTrackingDecisions(statusMap) {
    adminData.suggestion_status = adminData.suggestion_status || {};
    liveSuggestions.forEach(item => {
        const id = trackingIdFromNotes(item.notes), status = statusMap[item.reviewKey];
        if (id && status) adminData.suggestion_status[id] = {status:status === 'ignored' ? 'rejected' : status, updated:new Date().toISOString().slice(0,10)};
    });
}

function rememberSuggestion(id, name) {
    let list = [];
    try { list = JSON.parse(portalStorage.get('portal_suggestions') || '[]'); } catch {}
    if (!Array.isArray(list)) list = [];
    list.push({id, name, date:new Date().toISOString().slice(0,10)});
    portalStorage.set('portal_suggestions', JSON.stringify(list));
}

function toggleSuggestionTracker() {
    const box = document.getElementById('suggestionTracker'); box.hidden = !box.hidden;
    if (!box.hidden) renderSuggestionTracker();
}

function renderSuggestionTracker() {
    const box = document.getElementById('suggestionTracker'); if (!box) return;
    box.replaceChildren();
    const title = document.createElement('h2'); title.textContent = 'متابعة اقتراحاتي'; box.append(title);
    const note = document.createElement('p'); note.textContent = 'تُحفظ أرقام المتابعة على هذا الجهاز. أرسل النموذج مرة واحدة؛ Google Form لا يؤكد الاستلام للتطبيق. تظهر قرارات المشرف بعد نشرها.'; box.append(note);
    const lookup = document.createElement('input'); lookup.className = 'form-input'; lookup.placeholder = 'رقم متابعة من جهاز آخر'; lookup.setAttribute('aria-label','رقم المتابعة');
    const result = document.createElement('p');
    const statusText = id => ({approved:'تم القبول والنشر ✓', rejected:'لم يُعتمد / مرفوض', pending:'قيد المراجعة'}[portalData.suggestion_status?.[id]?.status] || 'بانتظار المراجعة — الاستلام غير مؤكد');
    box.append(lookup, featureButton('عرض الحالة', () => { result.textContent = statusText(lookup.value.trim()); }), result,
        featureButton('تحديث الحالات', async () => {
            try {
                const response = await fetch('data.json?t=' + Date.now(), {cache:'no-store'});
                if (!response.ok) throw new Error();
                const data = await response.json();
                if (!validatePortalData(data)) throw new Error();
                portalData.suggestion_status = data.suggestion_status || {}; renderSuggestionTracker();
            } catch { showToast('تعذر التحديث. حاول عند توفر الإنترنت.', 'error'); }
        }));
    let list = []; try { list = JSON.parse(portalStorage.get('portal_suggestions') || '[]'); } catch {}
    if (!Array.isArray(list)) list = [];
    list.slice().reverse().forEach(item => {
        const row = document.createElement('div'); row.className = 'review-row';
        const text = document.createElement('p'); text.textContent = `${item.name} · ${item.date} — ${statusText(item.id)}`;
        row.append(text, featureButton('نسخ رقم المتابعة', () => copyNumber(item.id))); box.append(row);
    });
}

function navigateCategory(id, push = true) {
    selectedCategory = id;
    document.getElementById('searchInput').value = '';
    if (push) history.pushState(null, '', '#category=' + encodeURIComponent(id));
    else history.replaceState(null, '', '#category=' + encodeURIComponent(id));
    filterItems();
}

function readCategoryLink() {
    const id = new URLSearchParams(location.hash.slice(1)).get('category');
    const tile = [...document.querySelectorAll('.category-tile')].find(t => t.dataset.list === id);
    if (tile) { switchTab('all'); navigateCategory(id, false); }
    else if (!id) { selectedCategory = null; filterItems(); }
}

function enhancePublicDirectory() {
    // Put configured categories first and append new categories without losing them.
    const order = portalData.category_order || [];
    document.querySelectorAll('#categoryTiles .category-tiles').forEach(tiles => {
        [...tiles.children].sort((a,b) => {
            const x = order.indexOf(a.dataset.list), y = order.indexOf(b.dataset.list);
            return (x < 0 ? order.length : x) - (y < 0 ? order.length : y);
        }).forEach(tile => tiles.append(tile));
    });
    if (!document.getElementById('shareCategory')) {
        const button = featureButton('مشاركة القسم', async () => {
            if (!selectedCategory) return showToast('افتح قسماً أولاً.');
            const url = new URL(location.href); url.hash = 'category=' + encodeURIComponent(selectedCategory);
            if (navigator.share) { try { await navigator.share({title:document.getElementById('browseStatus').textContent, url:url.href}); return; } catch (err) { if (err.name === 'AbortError') return; } }
            await copyNumber(url.href);
        });
        button.id = 'shareCategory'; document.getElementById('browseToolbar').append(button);
    }
    // The initial fallback may not contain a category that arrives with fresh data.
    if (location.hash.startsWith('#category=') && !selectedCategory) readCategoryLink();
    renderSuggestionTracker();
}

function trashEntry(type, a, b) {
    const group = type === 'service' ? null : adminData.transport[a];
    const list = type === 'service' ? adminData.services[a] : group?.items;
    if (!list?.[b]) return null;
    const record = {id:crypto.randomUUID(), type, category:type === 'service' ? a : null, city:group?.city || null, position:b, deleted_at:new Date().toISOString(), item:structuredClone(list[b])};
    (adminData.trash ||= []).push(record); list.splice(b,1);
    if (group && !list.length) adminData.transport.splice(a,1);
    return record;
}

function restoreTrash(id) {
    const index = (adminData.trash || []).findIndex(r => r.id === id); if (index < 0) return;
    const record = adminData.trash[index];
    let list;
    if (record.type === 'service') list = adminData.services[record.category] ||= [];
    else {
        let group = adminData.transport.find(g => g.city === record.city);
        if (!group) { group = {city:record.city, items:[]}; adminData.transport.push(group); }
        list = group.items;
    }
    if (record.merge) {
        const target = directoryEntries(adminData).find(e => JSON.stringify(e.item) === record.merge.after);
        if (target) { Object.keys(target.item).forEach(k => delete target.item[k]); Object.assign(target.item, record.merge.before); }
    }
    list.splice(Math.min(record.position, list.length),0,record.item);
    adminData.trash.splice(index,1); renderAdminLists();
    showToast('تمت الاستعادة — اضغط حفظ ونشر.');
}

function duplicateFingerprint(group) {
    return JSON.stringify([group.key, group.entries.map(e => {
        const item = e.type === 'service' ? adminData.services[e.cat][e.idx] : adminData.transport[e.gIdx].items[e.iIdx];
        return [e.type, e.type === 'service' ? e.cat : adminData.transport[e.gIdx].city, item.name, normalizeContactInput(item.phone || item.link).value];
    }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

function renderDuplicateReview() {
    const box = document.getElementById('duplicatesResult'); if (!box) return;
    box.replaceChildren();
    const groups = [...collectContactIndex().values()].filter(g => g.entries.length > 1);
    const intro = document.createElement('p'); intro.textContent = 'عدّل الإدخال، أو ادمج الخطأ في الجهة الأولى، أو علّمه كخدمة متعددة. كل التعديلات تحتاج حفظ ونشر.'; box.append(intro);
    groups.forEach(group => {
        const fingerprint = duplicateFingerprint(group);
        const known = (adminData.duplicate_reviews || []).includes(fingerprint);
        const panel = document.createElement('div'); panel.className = 'review-row';
        const title = document.createElement('strong'); title.textContent = group.display + (known ? ' — خدمة متعددة مؤكدة ✓' : ' — يحتاج مراجعة'); panel.append(title);
        group.entries.forEach((entry, index) => {
            const a = entry.type === 'service' ? entry.cat : entry.gIdx, b = entry.type === 'service' ? entry.idx : entry.iIdx;
            const row = document.createElement('div'); row.className = 'feature-actions';
            const label = document.createElement('span'); label.textContent = entry.label;
            row.append(label, featureButton('تعديل', () => openAdminEditModal(entry.type,a,b)), featureButton('حذف', () => deleteDuplicateEntry(entry.type,a,b)));
            if (index > 0) row.append(featureButton('دمج في الجهة الأولى', () => mergeDuplicateEntries(group.entries[0], entry)));
            panel.append(row);
        });
        panel.append(featureButton(known ? 'إلغاء علامة الخدمة المتعددة' : 'ليست خطأ — خدمة متعددة', () => {
            adminData.duplicate_reviews = known ? (adminData.duplicate_reviews || []).filter(k => k !== fingerprint) : [...(adminData.duplicate_reviews || []),fingerprint];
            renderDuplicateReview(); showToast('تم تحديث القرار — اضغط حفظ ونشر.');
        })); box.append(panel);
    });
    if (!groups.length) box.append('لا يوجد تكرار بالأرقام أو الروابط.');
    if (adminData.known_duplicates?.length) box.append(featureButton('إلغاء التجاهلات القديمة وإعادة مراجعتها', () => { adminData.known_duplicates = []; renderDuplicateReview(); }));
}

function mergeDuplicateEntries(keep, remove) {
    if (!confirm('دمج بيانات الإدخال الثاني في الأول؟ سيُنقل الأصل إلى سلة المحذوفات ويمكن استعادته.')) return;
    const get = e => e.type === 'service' ? adminData.services[e.cat][e.idx] : adminData.transport[e.gIdx].items[e.iIdx];
    const target = get(keep), source = get(remove), before = structuredClone(target);
    const x = normalizeContactInput(target.phone || target.link), y = normalizeContactInput(source.phone || source.link);
    if (!x.link && !y.link) target.phone = [...new Set([...x.phones,...y.phones])].join(' / ');
    const notes = [target.note, source.note, source.name !== target.name ? `اسم إضافي: ${source.name}` : ''].filter(Boolean);
    for (const key of ['schedule','hours','delivery','last_verified']) {
        if (!target[key] && source[key]) target[key] = structuredClone(source[key]);
        else if (source[key] && JSON.stringify(target[key]) !== JSON.stringify(source[key])) notes.push(`بيانات الإدخال المدموج (${key}): ${JSON.stringify(source[key])}`);
    }
    target.note = [...new Set(notes)].join(' | ');
    const record = trashEntry(remove.type, remove.type === 'service' ? remove.cat : remove.gIdx, remove.type === 'service' ? remove.idx : remove.iIdx);
    record.merge = {before, after:JSON.stringify(target)};
    renderAdminLists(); showToast('تم الدمج — راجع البيانات ثم احفظ وانشر.');
}

// Pointer handles support mouse, pen and touch; arrow buttons remain keyboard alternatives.
function reorderControls(row, group, index, move) {
    row.dataset.reorderGroup = group; row.dataset.reorderIndex = index;
    const handle = featureButton('⠿', () => {}); handle.classList.add('drag-handle');
    handle.title = 'اسحب لإعادة الترتيب'; handle.setAttribute('aria-label', 'اسحب لإعادة الترتيب، أو استخدم أسهم التحريك');
    handle.onpointerdown = event => {
        if (event.button !== 0) return;
        event.preventDefault(); handle.setPointerCapture(event.pointerId); row.classList.add('dragging');
    };
    handle.onpointermove = event => {
        if (!handle.hasPointerCapture(event.pointerId)) return;
        document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-reorder-group]');
        if (target?.dataset.reorderGroup === group) target.classList.add('drop-target');
        if (event.clientY < 70) window.scrollBy(0,-24);
        if (event.clientY > innerHeight - 70) window.scrollBy(0,24);
    };
    const finish = event => {
        if (!handle.hasPointerCapture(event.pointerId)) return;
        handle.releasePointerCapture(event.pointerId); row.classList.remove('dragging');
        document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        if (event.type === 'pointercancel') return;
        const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-reorder-group]');
        if (target?.dataset.reorderGroup === group) move(index, Number(target.dataset.reorderIndex));
    };
    handle.onpointerup = finish; handle.onpointercancel = finish; row.prepend(handle);
}

function moveDirectoryItem(list, from, to) {
    if (!list || from === to || !list[from] || to < 0 || to >= list.length) return;
    list.splice(to,0,list.splice(from,1)[0]);
    renderAdminLists(); showToast('تم تغيير الترتيب — اضغط حفظ ونشر.');
}

function enhanceAdminDirectory() {
    const container = document.getElementById('adminListsContainer');
    container.querySelectorAll('[data-action="edit-service"], [data-action="edit-transport"]').forEach(button => {
        const service = button.dataset.action === 'edit-service';
        const a = service ? button.dataset.cat : Number(button.dataset.gidx), b = Number(service ? button.dataset.idx : button.dataset.iidx);
        const list = service ? adminData.services[a] : adminData.transport[a].items;
        const row = button.closest('.admin-item-row');
        reorderControls(row, (service ? 'service:' : 'transport:') + a, b, (from,to) => moveDirectoryItem(list,from,to));
        const verify = featureButton('تحققت اليوم ✓', () => { list[b].last_verified = new Date().toISOString().slice(0,10); renderAdminLists(); showToast('تم تسجيل تاريخ التحقق — احفظ وانشر.'); });
        row.append(verify);
        if (list[b].last_verified) { const date = document.createElement('small'); date.textContent = 'آخر تحقق: ' + list[b].last_verified; row.append(date); }
    });
    let panel = document.getElementById('directoryTools');
    if (!panel) { panel = document.createElement('section'); panel.id = 'directoryTools'; panel.className = 'admin-card'; document.getElementById('dashboardSection').append(panel); }
    panel.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = 'ترتيب الأقسام داخل كل مجموعة — اسحب المقبض ⠿ أو استخدم الأسهم'; panel.append(heading);
    const categories = Object.entries(SERVICE_LABELS).map(([key,label]) => ({id:'list-' + key,label})).concat((adminData.transport || []).map(group => ({id:cityListId(group.city), label:group.city})));
    const valid = new Set(categories.map(c => c.id));
    const order = [...new Set([...(adminData.category_order || []).filter(id => valid.has(id)), ...categories.map(c => c.id)])];
    const isTransport = id => id.startsWith('list-city-');
    order.sort((a,b) => Number(isTransport(a)) - Number(isTransport(b)));
    order.forEach((id,idx) => {
        if (idx === 0 || isTransport(id) !== isTransport(order[idx-1])) {
            const title = document.createElement('h4'); title.textContent = isTransport(id) ? 'النقل خارج القدموس' : 'خدمات داخل القدموس'; panel.append(title);
        }
        const row = document.createElement('div'); row.className = 'feature-actions';
        const label = document.createElement('span'); label.textContent = categories.find(c => c.id === id).label; row.append(label);
        const move = (from,to) => { adminData.category_order = [...order]; moveDirectoryItem(adminData.category_order,from,to); };
        const up = featureButton('↑', () => move(idx,idx-1)); up.disabled = idx === 0 || isTransport(id) !== isTransport(order[idx-1]); up.setAttribute('aria-label','تحريك القسم لأعلى');
        const down = featureButton('↓', () => move(idx,idx+1)); down.disabled = idx === order.length-1 || isTransport(id) !== isTransport(order[idx+1]); down.setAttribute('aria-label','تحريك القسم لأسفل');
        row.append(up,down); reorderControls(row,isTransport(id) ? 'categories-transport' : 'categories-services',idx,move); panel.append(row);
    });
    const trashTitle = document.createElement('h3'); trashTitle.textContent = `سلة المحذوفات (${(adminData.trash || []).length})`; panel.append(trashTitle);
    (adminData.trash || []).forEach(record => {
        const row = document.createElement('div'); row.className = 'feature-actions'; const label = document.createElement('span');
        label.textContent = `${record.item.name} — ${record.city || SERVICE_LABELS[record.category] || record.category} — ${record.deleted_at.slice(0,10)}`;
        row.append(label, featureButton(record.merge ? 'استعادة / تراجع عن الدمج' : 'استعادة', () => restoreTrash(record.id))); panel.append(row);
    });
    renderDuplicateReview();
    decorateAdminGroups(container);
    initAdminNavigation();
}

const adminOpenGroups = new Set();
let activeAdminPanel = 'records';
function decorateAdminGroups(container) {
    [...container.children].forEach((block,index) => {
        const heading = block.firstElementChild;
        if (!heading) return;
        const details = document.createElement('details'); details.className = 'admin-group';
        const summary = document.createElement('summary'); summary.append(heading);
        details.append(summary);
        while (block.firstChild) details.append(block.firstChild);
        details.open = adminOpenGroups.has(index);
        details.addEventListener('toggle', () => {
            if (!details.isConnected) return;
            if (details.open) adminOpenGroups.add(index); else adminOpenGroups.delete(index);
        });
        block.replaceWith(details);
    });
}

function initAdminNavigation() {
    const dashboard = document.getElementById('dashboardSection');
    const panels = [
        ['records','البيانات',document.getElementById('adminListsContainer').closest('.admin-card')],
        ['add','إضافة جهة',document.getElementById('newName').closest('.admin-card')],
        ['inbox','الوارد',document.getElementById('suggestionsTableBody').closest('.admin-card')],
        ['duplicates','مراجعة التكرار',document.getElementById('duplicatesResult').closest('.admin-card')],
        ['tools','الترتيب والاستعادة',document.getElementById('directoryTools')]
    ];
    let nav = document.getElementById('adminNavigation');
    if (!nav) {
        nav = document.createElement('nav'); nav.id = 'adminNavigation'; nav.className = 'admin-navigation'; nav.setAttribute('aria-label','أقسام لوحة المشرف');
        dashboard.firstElementChild.after(nav);
        panels.forEach(([id,label]) => {
            const button = featureButton(label, () => { activeAdminPanel = id; initAdminNavigation(); });
            button.dataset.panel = id; button.setAttribute('aria-controls','admin-panel-' + id); nav.append(button);
        });
    }
    panels.forEach(([id,,panel]) => {
        if (id !== 'tools') panel.id = 'admin-panel-' + id;
        panel.hidden = activeAdminPanel !== id;
        const button = [...nav.children].find(b => b.dataset.panel === id);
        button.setAttribute('aria-controls',panel.id);
        button.setAttribute('aria-pressed', String(activeAdminPanel === id));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('adminListsContainer')) {
        ensurePeriodsEditor('new'); ensurePeriodsEditor('edit');
        fillHours('new', null);
        extraFields('new', document.getElementById('newNote').parentElement);
        extraFields('edit', document.getElementById('editNote').parentElement);
        document.getElementById('newNote').parentElement.style.gridColumn = '1 / -1';
    } else {
        const main = document.getElementById('main');
        const duty = document.getElementById('section-duty');
        if (main && duty) {
            main.prepend(main.querySelector('.notice-banner'), main.querySelector('.sy-hub-card'), duty, document.getElementById('installCard'));
        }
        const tracker = document.createElement('section'); tracker.id = 'suggestionTracker'; tracker.className = 'tracker-panel'; tracker.hidden = true; main.prepend(tracker);
        extraFields('sug', document.getElementById('sugNotes').parentElement, false);
        const update = () => {
            const cat = document.getElementById('sugCategory').value;
            const isDelivery = cat === 'ديليفري وتوصيل طلبات';
            const isClinic = cat === 'الأطباء والعيادات' || cat === 'عيادات جامعة الأندلس';
            document.getElementById('sugExtras').hidden = !isDelivery && !isClinic;
            for (const key of ['Areas', 'Fee', 'Kind']) {
                const input = document.getElementById('sug' + key);
                if (input) input.closest('label').style.display = isDelivery ? '' : 'none';
            }
            const spec = document.getElementById('sugSpecialty');
            if (spec) spec.closest('label').style.display = isDelivery || isClinic ? '' : 'none';
        };
        document.getElementById('sugCategory').addEventListener('change',update); update();
        window.addEventListener('popstate', readCategoryLink);
        window.addEventListener('hashchange', readCategoryLink);
    }
});
