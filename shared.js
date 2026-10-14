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
