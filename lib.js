/**
 * Core logic for the Peninei Halacha Yomi bot.
 *
 * Pure functions and scraping logic extracted from bot.js for testability.
 * All network-dependent functions accept a `fetchFn` parameter so callers
 * can inject the real `fetch` (production) or a mock (tests).
 */

const cheerio = require('cheerio');

// --- Constants ---
const BASE = 'https://ph.yhb.org.il';
const DAILY_URL = `${BASE}/pninayomit/`;
const ALLOWED_HOSTS = ['ph.yhb.org.il', 'yhb.org.il', 'cdn1.yhb.org.il'];

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Referer': `${BASE}/`,
};

// --- URL validation ---
function isAllowedUrl(url) {
    try {
        return ALLOWED_HOSTS.includes(new URL(url).hostname);
    } catch { return false; }
}

// Legacy Markdown escaping (only the 4 chars Telegram Markdown v1 needs)
function escMd(s) { return (s || '').replace(/([_*`\[])/g, '\\$1'); }

// --- API URL generation ---
function dailyApiUrls(yearOverride) {
    const year = yearOverride || new Date().getFullYear();
    return [
        `${BASE}/wp-content/plugins/db-connect/pninayomit-${year}/he_py.php`,
        `${BASE}/wp-content/plugins/db-connect/pninayomit-${year - 1}/he_py.php`,
        `${BASE}/wp-content/plugins/db-connect/pninayomit/he_py.php`,
    ];
}

// --- HTML fetching with retry ---
async function fetchHTML(url, fetchFn, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const r = await fetchFn(url, {
                headers: FETCH_HEADERS,
                signal: AbortSignal.timeout(15000),
                redirect: 'follow',
            });
            if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
            return await r.text();
        } catch (e) {
            lastError = e;
            if (attempt < retries) {
                const delay = 1000 * (attempt + 1);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// --- HTML parsing ---
function parseHalachot(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('.ym-hala-1, .ym-hala-2').each((i, container) => {
        const $c = $(container);
        const link = $c.find('h3 a[href]').first();
        let url = link.attr('href') || DAILY_URL;
        const title = link.text().trim() || 'הלכה';
        let audioUrl = $c.find('audio source').attr('src') || $c.find('audio').attr('src') || null;

        // Fallback: derive audio URL from page URL pattern (e.g. /20-26-12/ → mp3/20-26-12.mp3)
        if (!audioUrl) {
            const id = url.match(/(\d{2}-\d{2}-\d{2})/)?.[1];
            if (id) audioUrl = `https://cdn1.yhb.org.il/mp3/${id}.mp3`;
        }

        if (audioUrl?.startsWith('//')) audioUrl = 'https:' + audioUrl;
        else if (audioUrl?.startsWith('/')) audioUrl = BASE + audioUrl;

        if (!isAllowedUrl(url)) { console.warn(`[scraper] Unexpected URL domain: ${url}`); url = DAILY_URL; }
        if (audioUrl && !isAllowedUrl(audioUrl)) { console.warn(`[scraper] Unexpected audio domain: ${audioUrl}`); audioUrl = null; }

        results.push({ url, title, audioUrl });
    });

    // Fallback: try matching any halacha links if class-based selection found nothing
    if (results.length === 0) {
        $('h3 a[href*="ph.yhb.org.il"]').each((_, el) => {
            const url = $(el).attr('href');
            const title = $(el).text().trim() || 'הלכה';
            const id = url.match(/(\d{2}-\d{2}-\d{2})/)?.[1];
            const audioUrl = id ? `https://cdn1.yhb.org.il/mp3/${id}.mp3` : null;
            results.push({ url, title, audioUrl });
        });
    }

    return results.slice(0, 2);
}

// --- Daily cache ---
// Caches the scrape result keyed by ISO date string, so we only scrape once per day.
const _cache = { date: null, data: null };

function getCachedHalachot() {
    const today = new Date().toISOString().slice(0, 10);
    if (_cache.date === today && _cache.data) return _cache.data;
    return null;
}

function setCachedHalachot(data) {
    _cache.date = new Date().toISOString().slice(0, 10);
    _cache.data = data;
}

function clearCache() {
    _cache.date = null;
    _cache.data = null;
}

// --- Main scraper with fallback chain ---
async function scrapeDailyHalachot(fetchFn, apiUrls) {
    // Return cached result if available
    const cached = getCachedHalachot();
    if (cached) {
        console.log('[scraper] Returning cached result');
        return cached;
    }

    const urls = apiUrls || dailyApiUrls();
    const errors = [];

    // Strategy 1: Try each API URL
    for (const apiUrl of urls) {
        const fullUrl = `${apiUrl}?date=${Date.now()}`;
        try {
            const html = await fetchHTML(fullUrl, fetchFn, 1);
            const results = parseHalachot(html);
            if (results.length > 0) {
                console.log(`[scraper] Success from ${apiUrl}`);
                setCachedHalachot(results);
                return results;
            }
            errors.push(`${apiUrl}: returned HTML but no halachot found`);
        } catch (e) {
            errors.push(`${apiUrl}: ${e.message}`);
        }
    }

    // Strategy 2: Try scraping the main pninayomit page directly
    try {
        const html = await fetchHTML(DAILY_URL, fetchFn, 1);
        const results = parseHalachot(html);
        if (results.length > 0) {
            console.log(`[scraper] Success from main page fallback (${DAILY_URL})`);
            setCachedHalachot(results);
            return results;
        }
    } catch (e) {
        errors.push(`${DAILY_URL}: ${e.message}`);
    }

    // Strategy 3: Try Google Cache of the main page
    const googleCacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(DAILY_URL)}`;
    try {
        const html = await fetchHTML(googleCacheUrl, fetchFn, 0);
        const results = parseHalachot(html);
        if (results.length > 0) {
            console.log(`[scraper] Success from Google Cache fallback`);
            setCachedHalachot(results);
            return results;
        }
    } catch (e) {
        errors.push(`Google Cache: ${e.message}`);
    }

    throw new Error(
        `No halacha links found after trying ${errors.length} sources — site structure may have changed.\n` +
        errors.map(e => `  • ${e}`).join('\n')
    );
}

// --- Build message caption ---
function buildCaption(halacha, index) {
    const label = index === 0 ? 'א' : 'ב';
    const safeUrl = halacha.url.replace(/\)/g, '%29');
    return `📖 *הלכה ${label}:* ${escMd(halacha.title)}\n🔗 [לקריאה באתר](${safeUrl})`;
}

module.exports = {
    BASE,
    DAILY_URL,
    ALLOWED_HOSTS,
    FETCH_HEADERS,
    isAllowedUrl,
    escMd,
    dailyApiUrls,
    fetchHTML,
    parseHalachot,
    scrapeDailyHalachot,
    buildCaption,
    getCachedHalachot,
    setCachedHalachot,
    clearCache,
};
