// Public snapshots are generated server-side; no ERP credentials or cross-origin scraping.
const RATE_LIMITS = {USD:[20,500]};
const RATE_URL = 'https://raw.githubusercontent.com/FirasTDS/au-service-portal/main/rates.json';
const RATE_CACHE = 'portal_exchange_rates_v1';
let displayedRates = null;
let fetchingRates = false;

function validRates(data, now = Date.now()) {
    if (!data || data.source !== 'sp-today.com' || data.city !== 'دمشق' || data.unit !== 'SYP_NEW') return false;
    const time = Date.parse(data.fetched_at);
    if (!Number.isFinite(time) || time > now + 300000) return false;
    const rate = data.rates?.USD;
    return Boolean(rate && Number.isFinite(rate.buy) && Number.isFinite(rate.sell)
        && rate.buy >= RATE_LIMITS.USD[0] && rate.sell <= RATE_LIMITS.USD[1] && rate.buy <= rate.sell);
}

function renderExchangeRates(cached = false) {
    const box = document.getElementById('exchangeRateValues');
    const status = document.getElementById('exchangeRateStatus');
    box.replaceChildren();
    if (!displayedRates) {
        status.textContent = 'تعذر جلب سعر الصرف حالياً. يمكنك فتح محوّل العملة أو مراجعة المصدر.';
        return;
    }
    const number = value => new Intl.NumberFormat('ar-SY', {maximumFractionDigits:2}).format(value);
    const rate = displayedRates.rates.USD;
    const line = document.createElement('div'); line.className = 'exchange-rate';
    const title = document.createElement('strong'); title.textContent = 'الدولار الأمريكي · USD';
    const values = document.createElement('div'); values.className = 'exchange-rate-values';
    for (const [key,text] of [['buy','شراء'],['sell','مبيع']]) {
        const value = document.createElement('span');
        value.textContent = `${text} ${number(rate[key])} ل.س`; values.append(value);
    }
    const old = document.createElement('small');
    old.textContent = `بالقديمة: ${number(rate.buy * 100)} / ${number(rate.sell * 100)}`;
    line.append(title,values,old); box.append(line);
    const date = new Date(displayedRates.fetched_at);
    const stale = Date.now() - date.getTime() > 6 * 3600000;
    const when = new Intl.DateTimeFormat('ar-SY', {dateStyle:'short',timeStyle:'short',timeZone:'Asia/Damascus'}).format(date);
    status.textContent = `${cached ? 'محفوظة · ' : ''}${stale ? 'قديم — ' : ''}آخر جلب ${when} · تحديث كل ساعة.`;
    status.classList.toggle('exchange-stale',stale || cached);
}

async function fetchRatesJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),12000);
    try {
        const response = await fetch(`${url}?t=${Date.now()}`, {cache:'no-store',signal:controller.signal});
        if (!response.ok) throw new Error('Rate snapshot unavailable');
        const data = await response.json();
        if (!validRates(data)) throw new Error('Invalid rate snapshot');
        return data;
    } finally { clearTimeout(timeout); }
}

function acceptRates(data) {
    if (!displayedRates || Date.parse(data.fetched_at) >= Date.parse(displayedRates.fetched_at)) displayedRates = data;
    portalStorage.set(RATE_CACHE,JSON.stringify(displayedRates));
}

async function refreshExchangeRates() {
    if (fetchingRates) return;
    fetchingRates = true;
    const button = document.getElementById('refreshExchangeRates'); button.disabled = true;
    try {
        // Actions commits do not trigger a new Pages build: read the latest raw snapshot directly.
        acceptRates(await fetchRatesJSON(RATE_URL));
        renderExchangeRates();
    } catch {
        try { acceptRates(await fetchRatesJSON('rates.json')); } catch {}
        renderExchangeRates(true);
    } finally {
        button.disabled = false;
        fetchingRates = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const saved = JSON.parse(portalStorage.get(RATE_CACHE) || 'null');
        if (validRates(saved)) { displayedRates = saved; renderExchangeRates(true); }
    } catch {}
    document.getElementById('refreshExchangeRates').addEventListener('click',refreshExchangeRates);
    refreshExchangeRates();
    setInterval(() => { if (!document.hidden) refreshExchangeRates(); },15 * 60000);
});
