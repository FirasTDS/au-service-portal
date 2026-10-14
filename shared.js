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
