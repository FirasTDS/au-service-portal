// Shared browser helpers; storage may be unavailable in private/restricted contexts.
const portalStorage = {
    get(key, session = false) {
        try { return (session ? sessionStorage : localStorage).getItem(key); } catch { return null; }
    },
    set(key, value, session = false) {
        try { (session ? sessionStorage : localStorage).setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
        try { localStorage.removeItem(key); return true; } catch { return false; }
    }
};

function applyPortalTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
}
const themePreference = window.matchMedia('(prefers-color-scheme: dark)');
const savedTheme = portalStorage.get('susa_theme');
applyPortalTheme(['light', 'dark'].includes(savedTheme) ? savedTheme : themePreference.matches ? 'dark' : 'light');
themePreference.addEventListener('change', event => {
    if (!portalStorage.get('susa_theme')) {
        applyPortalTheme(event.matches ? 'dark' : 'light');
        if (typeof updateThemeIcon === 'function') updateThemeIcon(document.documentElement.dataset.theme);
    }
});

// Keep the existing phone-string schema; multiple numbers use " / " as a separator.
function normalizeContactInput(value) {
    const raw = String(value ?? '').trim()
        .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
        .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    const invalid = { phones: [], link: '', value: raw, error: 'أدخل أرقاماً كاملة (09xxxxxxxx أو +9639xxxxxxxx)، وافصل بينها بمسافة أو /، أو أدخل رابط الصفحة.' };
    if (/^(?:https?:\/\/|www\.|(?:t\.me|instagram\.com|facebook\.com)\/)/i.test(raw)) {
        try {
            const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
            if (!url.hostname.includes('.') || /\s/.test(raw) || url.username || url.password) return invalid;
            return { phones: [], link: url.href, value: url.href, error: '' };
        } catch { return invalid; }
    }
    if (!raw || /[^\d+\s().,،;؛/|&و\-–—]/.test(raw)) return invalid;
    const chunks = raw.split(/[,،;؛/|&\n\rو]+/).map(s => s.replace(/[\s().\-–—]/g, '')).filter(Boolean);
    const phones = [];
    for (let chunk of chunks) {
        if (/^1\d{2}$/.test(chunk)) { phones.push(chunk); continue; }
        // Only accept unambiguous complete Syrian numbers, never truncate a remainder.
        while (chunk) {
            const match = /^(?:\+963|00963|963|0)([1-9]\d{8})/.exec(chunk);
            if (match) {
                phones.push(`0${match[1]}`);
                chunk = chunk.slice(match[0].length);
            } else if (/^[1-9]\d{8}$/.test(chunk)) {
                phones.push(`0${chunk}`); // Sheets may remove the leading zero.
                chunk = '';
            } else return invalid;
        }
    }
    const unique = [...new Set(phones)];
    return unique.length ? { phones: unique, link: '', value: unique.join(' / '), error: '' } : invalid;
}

function whatsappUrl(phone) {
    return /^09\d{8}$/.test(phone) ? `https://wa.me/963${phone.slice(1)}` : '';
}

// --- STRUCTURED OPENING HOURS (explicit per-entry data only, never inferred) ---
// Schema: hours = { open: "HH:MM", close: "HH:MM", days?: [0-6, Sun-Sat] } or { allday: true, days? }
const AR_DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function isValidTime(value) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function damascusNow() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Damascus', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { day: dayMap[get('weekday')], minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
}

function hoursLabel(hours) {
    if (hours?.closed === true) return 'مغلق طوال الأسبوع';
    if (!hours || typeof hours !== 'object') return '';
    if (Array.isArray(hours.periods)) return hours.periods.slice(0,14).filter(period => period && !period.periods).map(hoursLabel).filter(Boolean).join(' • ');
    const days = Array.isArray(hours.days) && hours.days.length && hours.days.length < 7
        ? ' (' + hours.days.map(d => AR_DAY_NAMES[d]).filter(Boolean).join('، ') + ')' : '';
    if (hours.allday) return 'مفتوح 24 ساعة' + days;
    if (!isValidTime(hours.open) || !isValidTime(hours.close)) return '';
    return `${hours.open} - ${hours.close}${days}`;
}

// Free text (student suggestions, admin notes) -> structured hours. Returns null when unclear.
// Accepts: "08:00-22:00", "8ص-10م", "من 8 صباحاً حتى 12 ظهراً", "٩:٣٠-١٨:٠٠", "24 ساعة", "طوال اليوم".
function parseHoursText(text) {
    if (typeof text !== 'string') return null;
    let normalized = text
        .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
        .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0)) // Eastern Arabic-Indic digits
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')                        // diacritics + tatweel
        .replace(/(\d)\.(?=\d)/g, '$1:')                                   // "8.00" -> "8:00"
        .replace(/[:.,،]+/g, m => (m === ':' ? ':' : ' '))                  // keep HH:MM, split on other punctuation
        .replace(/[-–—]+/g, ' ')                                            // range dashes
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return null;
    if (/طوال اليوم|بشكل دائم|لا يتوقف|بلا توقف/.test(normalized)) return { allday: true };
    if (/(^|\D)24(\D|$)/.test(normalized) && /ساع|يوم|دائم|طوال|always/i.test(normalized)) return { allday: true };
    // Attach meridiem words glued to digits ("8ص" -> "8 ص").
    normalized = normalized.replace(/(\d)\s?(صباحا|صباح|مساءا|مساء|ظهرا|ظهر|ليلا|ليل|ص|م|am|pm)(?=\s|$)/gi, '$1 $2');
    const tokens = normalized.split(' ');
    const isMer = (token, kind) => {
        if (!token) return false;
        if (kind === 'am') return /^(صباحا|صباح|ص|am)$/i.test(token);
        if (kind === 'pm') return /^(مساءا|مساء|م|pm)$/i.test(token);
        if (kind === 'noon') return /^(ظهرا|ظهر)$/i.test(token);
        return /^(ليلا|ليل)$/i.test(token);
    };
    const found = [];
    tokens.forEach((token, i) => {
        const m = token.match(/^([01]?\d|2[0-3])(?::([0-5]\d))?$/);
        if (!m) return;
        // A meridiem right after the time wins; one right before it counts only when
        // it is not already consumed by an earlier time ("8 ص 10 م").
        const next = tokens[i + 1] || '';
        const prev = tokens[i - 1] || '';
        const prevIsTime = /^([01]?\d|2[0-3])(?::([0-5]\d))?$/.test(tokens[i - 2] || '');
        let mer = '';
        for (const kind of ['am', 'pm', 'noon', 'night']) {
            if (isMer(next, kind)) { mer = kind; break; }
            if (!prevIsTime && isMer(prev, kind)) { mer = kind; break; }
        }
        found.push({ h: parseInt(m[1], 10), mm: m[2] || '00', mer });
    });
    if (found.length !== 2) return null;
    // A 12-hour suffix cannot be attached to a 24-hour value such as 13م.
    if (found.some(time => time.mer && (time.h < 1 || time.h > 12))) return null;
    const to24 = ({ h, mm, mer }) => {
        const pad = value => String(value).padStart(2, '0') + ':' + mm;
        if (mer === 'pm') return pad(h === 12 ? 12 : h + 12);
        if (mer === 'am') return pad(h % 12);
        if (mer === 'noon') return pad(h === 12 ? 12 : h + 12);
        if (mer === 'night') return pad(h < 6 ? h : (h === 12 ? 0 : h + 12));
        return pad(h); // already 24h or plain morning hour
    };
    const open = to24(found[0]), close = to24(found[1]);
    return !isValidTime(open) || !isValidTime(close) || open === close ? null : { open, close };
}

function getOpenStatusBadge(item, now = damascusNow()) {
    if (item?.hours?.closed === true) return '<span class="status-badge status-badge-closed"><span class="status-dot"></span>مغلق حالياً</span>';
    const hours = item && item.hours;
    if (!hours || typeof hours !== 'object') return '';
    if (Array.isArray(hours.periods)) {
        const periods = hours.periods.slice(0,14).filter(period => period && !period.periods && hoursLabel(period));
        if (!periods.length) return '';
        const badges = periods.map(period => getOpenStatusBadge({hours:period}, now));
        if (badges.some(badge => badge.includes('status-badge-open'))) return `<span class="status-badge status-badge-open" title="${hoursLabel(hours)}"><span class="status-dot"></span>مفتوح الآن</span>`;
        return '<span class="status-badge status-badge-closed"><span class="status-dot"></span>مغلق حالياً</span>';
    }
    const days = Array.isArray(hours.days) && hours.days.length ? hours.days : [0, 1, 2, 3, 4, 5, 6];
    if (hours.allday) {
        if (!days.includes(now.day)) return '<span class="status-badge status-badge-closed"><span class="status-dot"></span>مغلق اليوم</span>';
        return '<span class="status-badge status-badge-open"><span class="status-dot"></span>مفتوح 24 ساعة</span>';
    }
    if (!isValidTime(hours.open) || !isValidTime(hours.close)) return '';
    const toMin = t => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);
    const open = toMin(hours.open), close = toMin(hours.close), t = now.minutes;
    // days describes the day the shift STARTS. Early morning belongs to yesterday.
    const overnight = close < open;
    const shiftDay = overnight && t < close ? (now.day + 6) % 7 : now.day;
    const scheduled = days.includes(shiftDay);
    const isOpen = scheduled && (overnight ? (t >= open || t < close) : (t >= open && t < close));
    if (!scheduled && !days.includes(now.day)) return '<span class="status-badge status-badge-closed"><span class="status-dot"></span>مغلق اليوم</span>';
    const label = hoursLabel(hours);
    return isOpen
        ? `<span class="status-badge status-badge-open" title="${label}"><span class="status-dot"></span>مفتوح الآن</span>`
        : `<span class="status-badge status-badge-closed" title="${label}"><span class="status-dot"></span>مغلق حالياً</span>`;
}

function validatePortalData(data) {
    const validItem = item => item && typeof item.name === 'string' && item.name.trim() &&
        (typeof item.phone === 'string' || typeof item.link === 'string');
    if (!data || !data.services || Array.isArray(data.services) || typeof data.services !== 'object' ||
        !Object.values(data.services).every(items => Array.isArray(items) && items.every(validItem)) ||
        !Array.isArray(data.transport) || !data.transport.every(group => group && typeof group.city === 'string' &&
            Array.isArray(group.items) && group.items.every(validItem))) return false;
    const duty = data.pharmacies_duty;
    return !duty || (Array.isArray(duty.schedule) && duty.schedule.every(item => item &&
        typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
        typeof item.pharmacy === 'string' && typeof item.phone === 'string'));
}

// Observe both pages' modal controls so keyboard and focus behavior stays consistent.
document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('.site-nav');
    if (nav) new ResizeObserver(() => {
        document.documentElement.style.setProperty('--nav-height', `${nav.getBoundingClientRect().height + 8}px`);
    }).observe(nav);
    let activeModal = null;
    let returnFocus = null;
    const focusable = modal => [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    const syncModal = () => {
        const modal = document.querySelector('.modal-open');
        if (modal === activeModal) return;
        if (modal) {
            returnFocus = document.activeElement;
            activeModal = modal;
            document.body.style.overflow = 'hidden';
            focusable(modal)[0]?.focus();
        } else {
            activeModal = null;
            document.body.style.overflow = '';
            if (returnFocus?.isConnected) returnFocus.focus();
        }
    };
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        new MutationObserver(syncModal).observe(modal, { attributes: true, attributeFilter: ['class'] });
        modal.addEventListener('click', event => {
            if (event.target === modal) modal.classList.remove('modal-open');
        });
    });
    document.addEventListener('keydown', event => {
        if (!activeModal) return;
        if (event.key === 'Escape') activeModal.classList.remove('modal-open');
        if (event.key === 'Tab') {
            const elements = focusable(activeModal);
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) {
                event.preventDefault(); first?.focus();
            }
        }
    });
});
