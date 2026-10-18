// Google Forms returns an opaque response. Only a matching Sheet receipt confirms delivery.
const OUTBOX_KEY = 'portal_outbox_v1';
const RECEIPT_SHEET = 'https://docs.google.com/spreadsheets/d/1owergoyNbXTjGCDw6Va0EWXCAIEw15K7lEeZl63CFiI/gviz/tq?tqx=out:csv';
let checkingOutbox = false;
const sendingReceipts = new Set();

function readOutbox() {
    try { const rows = JSON.parse(portalStorage.get(OUTBOX_KEY) || '[]'); return Array.isArray(rows) ? rows.filter(r => r && /^[a-f0-9-]{36}$/.test(r.id) && Array.isArray(r.fields)) : []; }
    catch { return []; }
}
function saveOutbox(rows) {
    if (!portalStorage.set(OUTBOX_KEY, JSON.stringify(rows))) throw new Error('تعذر حفظ الطلب على جهازك. أعد المحاولة من متصفح يسمح بالتخزين.');
    renderOutbox();
}
async function sheetReceipts() {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(RECEIPT_SHEET + '&t=' + Date.now(), {cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('Sheet unavailable');
        const text = await response.text();
        if (!text.includes('Timestamp') && !text.includes('نوع المشاركة')) throw new Error('Not a sheet response');
        return text;
    } finally { clearTimeout(timer); }
}
async function checkOutbox() {
    if (checkingOutbox || !readOutbox().length) return;
    checkingOutbox = true;
    try {
        const text = await sheetReceipts();
        saveOutbox(readOutbox().filter(row => !text.includes(`[إرسال:${row.id}]`)));
    } catch { /* Retain uncertain deliveries, never claim success. */ }
    finally { checkingOutbox = false; renderOutbox(); }
}
async function postReceipt(row) {
    if (sendingReceipts.has(row.id)) return;
    sendingReceipts.add(row.id); renderOutbox();
    try {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
        try {
            await fetch(GOOGLE_FORM_URL, {method:'POST',mode:'no-cors',body:FormDataFromEntries(row.fields),signal:controller.signal});
        } finally { clearTimeout(timer); }
        await new Promise(resolve => setTimeout(resolve, 1800));
        await checkOutbox();
    } catch { /* A failed or opaque POST is not proof of receipt. */ }
    finally { sendingReceipts.delete(row.id); renderOutbox(); }
}
function FormDataFromEntries(fields) {
    const data = new FormData(); fields.forEach(([key,value]) => data.append(key,value)); return data;
}
async function submitWithReceipt(data) {
    const fields = [...data.entries()];
    const fingerprint = JSON.stringify(fields);
    const rows = readOutbox();
    const pending = rows.find(row => row.fingerprint === fingerprint);
    if (pending) { await checkOutbox(); return {id:pending.id,confirmed:!readOutbox().some(r=>r.id===pending.id)}; }
    if (rows.length >= 50) throw new Error('لديك طلبات بانتظار التأكيد. راجع صندوق الإرسال أولاً.');
    const id = crypto.randomUUID();
    const notesKey = 'entry.40821348';
    const index = fields.findIndex(([key]) => key === notesKey);
    if (index < 0) fields.push([notesKey,`[إرسال:${id}]`]);
    else fields[index][1] += `\n[إرسال:${id}]`;
    const row = {id,fields,fingerprint,name:data.get('entry.1549210706') || 'طلب',created:new Date().toISOString()};
    saveOutbox([...rows,row]);
    await postReceipt(row);
    return {id,confirmed:!readOutbox().some(r=>r.id===id)};
}
async function retrySubmission(id) {
    if (sendingReceipts.has(id)) return;
    // Check first: a delayed acknowledgement must not cause a new submission.
    try {
        const text = await sheetReceipts();
        if (text.includes(`[إرسال:${id}]`)) { saveOutbox(readOutbox().filter(row=>row.id!==id)); return; }
    } catch { showToast('تعذر التحقق من الاستلام. حاول لاحقاً لتجنب التكرار.', 'error'); return; }
    const row = readOutbox().find(row=>row.id===id);
    if (row) await postReceipt(row); // Same receipt; admin also deduplicates it.
}
function renderOutbox() {
    const box = document.getElementById('submissionOutbox');
    if (!box) return;
    box.replaceChildren();
    const rows = readOutbox(); box.hidden = !rows.length;
    if (!rows.length) return;
    const title = document.createElement('h3'); title.textContent = 'طلبات بانتظار تأكيد الاستلام'; box.append(title);
    const hint = document.createElement('p'); hint.textContent = 'طلباتك محفوظة على هذا الجهاز. قد يتأخر ظهورها في Google؛ تحقق قبل إعادة الإرسال.'; box.append(hint);
    const check = document.createElement('button'); check.type='button'; check.className='btn-secondary'; check.textContent='تحقق من الاستلام'; check.disabled=checkingOutbox; check.onclick=checkOutbox; box.append(check);
    rows.forEach(row => {
        const line = document.createElement('div'); line.className='outbox-row';
        const text = document.createElement('span'); text.textContent=row.name + ' — بانتظار التأكيد';
        const retry = document.createElement('button'); retry.type='button'; retry.className='btn-secondary'; retry.textContent='تحقق وأعد المحاولة'; retry.disabled=sendingReceipts.has(row.id); retry.onclick=()=>retrySubmission(row.id);
        line.append(text,retry); box.append(line);
    });
}
document.addEventListener('DOMContentLoaded', () => { renderOutbox(); checkOutbox(); });
window.addEventListener('online', checkOutbox);
