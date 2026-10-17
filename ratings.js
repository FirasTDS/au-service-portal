// Visitor averages are aggregated server-side nightly from the form sheet; this
// file only reads the published snapshot. Keys match the local rating key:
// item.phone || item.link || item.name.
const RATINGS_URL = 'https://raw.githubusercontent.com/FirasTDS/au-service-portal/main/ratings.json';
const RATINGS_CACHE = 'portal_visitor_ratings_v1';
let visitorRatings = null;
let fetchingRatings = false;

function validRatings(data, now = Date.now()) {
    if (!data || data.source !== 'google-sheet' || !data.places || typeof data.places !== 'object') return false;
    const time = Date.parse(data.fetched_at);
    if (!Number.isFinite(time) || time > now + 300000) return false;
    return Object.values(data.places).every(place => place
        && Number.isFinite(place.avg) && place.avg >= 1 && place.avg <= 5
        && Number.isInteger(place.count) && place.count >= 1);
}

function visitorRatingFor(key) {
    const place = visitorRatings && visitorRatings.places[key];
    return place && place.count >= 1 ? place : null;
}

// Averages always show fewer digits than the raw mean, never a bare "0".
function formatVisitorRating(place) {
    return `${place.avg.toFixed(1)} · ${place.count === 1 ? 'تقييم واحد' : `${place.count} تقييمات`}`;
}

async function fetchRatingsJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Ratings snapshot unavailable');
        const data = await response.json();
        if (!validRatings(data)) throw new Error('Invalid ratings snapshot');
        return data;
    } finally { clearTimeout(timeout); }
}

function acceptRatings(data) {
    const previous = visitorRatings;
    if (previous && Date.parse(data.fetched_at) < Date.parse(previous.fetched_at)) return false;
    visitorRatings = data;
    try { portalStorage.set(RATINGS_CACHE, JSON.stringify(data)); } catch (e) { /* private mode */ }
    // Only re-render when the published numbers actually changed.
    return !previous || previous.fetched_at !== data.fetched_at
        || previous.total_ratings !== data.total_ratings;
}

async function refreshVisitorRatings() {
    if (fetchingRatings) return;
    fetchingRatings = true;
    try {
        // Actions commits do not trigger a new Pages build: read the latest raw snapshot directly.
        if (acceptRatings(await fetchRatingsJSON(RATINGS_URL)) && typeof renderAll === 'function') renderAll();
    } catch {
        try {
            if (acceptRatings(await fetchRatingsJSON('ratings.json')) && typeof renderAll === 'function') renderAll();
        } catch { /* averages are optional; cards stay usable without them */ }
    } finally {
        fetchingRatings = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const saved = JSON.parse(portalStorage.get(RATINGS_CACHE) || 'null');
        if (validRatings(saved)) visitorRatings = saved;
    } catch { /* ignore corrupted cache */ }
    refreshVisitorRatings();
    setInterval(() => { if (!document.hidden) refreshVisitorRatings(); }, 60 * 60000);
});
