#!/usr/bin/env node
require('dotenv').config();
const { Bot, InputFile } = require('grammy');
const cron = require('node-cron');
const cheerio = require('cheerio');
const Database = require('better-sqlite3');
const { mkdirSync, existsSync } = require('fs');
const { dirname } = require('path');

// --- Config ---
const TOKEN = process.env.BOT_TOKEN;
const DB_PATH = process.env.DB_PATH || './data/bot.db';
const BASE = 'https://ph.yhb.org.il';
const DAILY_URL = `${BASE}/pninayomit/`;
const UA = 'PenineiHalachaYomiBot/1.0';
const ALLOWED_HOSTS = ['ph.yhb.org.il', 'yhb.org.il', 'cdn1.yhb.org.il'];

if (!TOKEN || TOKEN === 'your_bot_token_here') {
    console.error('Set BOT_TOKEN in .env'); process.exit(1);
}

// Validate ADMIN_CHAT_ID: must be a nonzero integer or null
const _admin = Number(process.env.ADMIN_CHAT_ID);
const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;

if (process.env.ADMIN_CHAT_ID && !ADMIN) {
    console.warn('ADMIN_CHAT_ID is set but not a valid integer — admin features disabled');
}

// --- Database (SQLite) ---
if (!existsSync(dirname(DB_PATH))) mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        active  INTEGER DEFAULT 1
    );
`);

const addSub    = db.prepare('INSERT OR REPLACE INTO subscribers (chat_id, active) VALUES (?, 1)');
const removeSub = db.prepare('UPDATE subscribers SET active = 0 WHERE chat_id = ?');
const getSubs   = db.prepare('SELECT chat_id FROM subscribers WHERE active = 1');

// --- URL validation ---
function isAllowedUrl(url) {
    try {
        return ALLOWED_HOSTS.includes(new URL(url).hostname);
    } catch { return false; }
}

// --- Scraper ---
function dailyApiUrls() {
    // Returns an ordered list of API URL candidates to try.
    // The site uses year-based directories (pninayomit-YYYY); if the current
    // year's directory doesn't exist yet, we fall back to the previous year
    // and a yearless path. The env override takes top priority.
    if (process.env.DAILY_API_URL) return [process.env.DAILY_API_URL];
    const year = new Date().getFullYear();
    return [
        `${BASE}/wp-content/plugins/db-connect/pninayomit-${year}/he_py.php`,
        `${BASE}/wp-content/plugins/db-connect/pninayomit-${year - 1}/he_py.php`,
        `${BASE}/wp-content/plugins/db-connect/pninayomit/he_py.php`,
    ];
}

async function fetchHTML(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.text();
}

function parseHalachot(html) {
    const $ = cheerio.load(html);

    const results = [];
    $('.ym-hala-1, .ym-hala-2').each((i, container) => {
        const $c = $(container);
        const link = $c.find('h3 a[href]').first();
        let url = link.attr('href') || DAILY_URL;
        const title = link.text().trim() || 'הלכה';
        let audioUrl = $c.find('audio source').attr('src') || $c.find('audio').attr('src') || null;

        // Fallback: derive audio URL from page URL (e.g. /20-26-12/ → mp3/20-26-12.mp3)
        if (!audioUrl) {
            const id = url.match(/(\d{2}-\d{2}-\d{2})/)?.[1];
            if (id) audioUrl = `https://cdn1.yhb.org.il/mp3/${id}.mp3`;
        }

        if (audioUrl?.startsWith('//')) audioUrl = 'https:' + audioUrl;
        else if (audioUrl?.startsWith('/')) audioUrl = BASE + audioUrl;

        // Validate scraped URLs against allowed domains
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

async function scrapeDailyHalachot() {
    const urls = dailyApiUrls();
    const errors = [];

    for (const apiUrl of urls) {
        const fullUrl = `${apiUrl}?date=${Date.now()}`;
        try {
            const html = await fetchHTML(fullUrl);
            const results = parseHalachot(html);
            if (results.length > 0) {
                console.log(`[scraper] Success from ${apiUrl}`);
                return results;
            }
            errors.push(`${apiUrl}: returned HTML but no halachot found`);
        } catch (e) {
            errors.push(`${apiUrl}: ${e.message}`);
        }
    }

    // Last resort: try scraping the main pninayomit page directly
    try {
        const html = await fetchHTML(DAILY_URL);
        const results = parseHalachot(html);
        if (results.length > 0) {
            console.log(`[scraper] Success from main page fallback (${DAILY_URL})`);
            return results;
        }
    } catch (e) {
        errors.push(`${DAILY_URL}: ${e.message}`);
    }

    throw new Error(
        `No halacha links found after trying ${errors.length} sources — site structure may have changed.\n` +
        errors.map(e => `  • ${e}`).join('\n')
    );
}

// --- Bot ---
const bot = new Bot(TOKEN);

bot.command('start', async (ctx) => {
    addSub.run(ctx.chat.id);
    await ctx.reply(
        '🕯️ ברוכים הבאים!\n\n' +
        'כל יום בשעה 5:00 תקבלו שתי הלכות מוקלטות מ"הפנינה היומית" של פניני הלכה.\n\n' +
        '/today — הלכות היום עכשיו\n' +
        '/stop — הפסקה'
    );
});

bot.command('stop', async (ctx) => {
    removeSub.run(ctx.chat.id);
    await ctx.reply('👋 הוסרת. תמיד אפשר לחזור עם /start');
});

bot.command('today', async (ctx) => {
    await ctx.reply('🔄 מחפש...');
    try {
        const halachot = await scrapeDailyHalachot();
        await sendHalachot(ctx.chat.id, halachot);
    } catch (e) {
        console.error(`[/today] chat=${ctx.chat.id} failed:`, e);
        await ctx.reply('⚠️ לא הצלחתי. נסו שוב מאוחר יותר:\n' + DAILY_URL);
    }
});

bot.command('send', async (ctx) => {
    if (!ADMIN || ctx.chat.id !== ADMIN) {
        console.warn(`[/send] Unauthorized attempt from chat_id=${ctx.chat.id}`);
        return;
    }
    console.log(`[/send] Admin triggered manual broadcast`);
    await ctx.reply('🚀 שולח...');
    try { await dailyJob(); }
    catch (e) { await ctx.reply(`🚨 Failed: ${e.message}`); }
});

bot.catch((err) => {
    const chatId = err.ctx?.chat?.id ?? 'unknown';
    console.error(`Bot error [chat=${chatId}]:`, err.error ?? err);
});

// --- Send halachot to one chat ---
async function sendHalachot(chatId, halachot) {
    for (let i = 0; i < halachot.length; i++) {
        const h = halachot[i];
        const safeUrl = h.url.replace(/\)/g, '%29');
        const caption = `📖 *הלכה ${i === 0 ? 'א' : 'ב'}:* ${escMd(h.title)}\n🔗 [לקריאה באתר](${safeUrl})`;
        if (h.audioUrl) {
            try {
                await bot.api.sendAudio(chatId, new InputFile(new URL(h.audioUrl)), {
                    caption, parse_mode: 'Markdown', title: h.title, performer: 'פניני הלכה',
                });
                continue;
            } catch (e) {
                console.warn(`[audio-fallback] chat=${chatId} url=${h.audioUrl}: ${e.message}`);
                /* fall through to text */
            }
        }
        await bot.api.sendMessage(chatId, caption + '\n\n_⚠️ הקלטה לא זמינה_', {
            parse_mode: 'Markdown', disable_web_page_preview: true,
        });
    }
}

// Legacy Markdown only needs these 4 characters escaped (not MarkdownV2 set)
function escMd(s) { return (s || '').replace(/([_*`\[])/g, '\\$1'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Daily job ---
let dailyJobRunning = false;

async function dailyJob() {
    if (dailyJobRunning) { console.warn('[daily-job] Already running, skipping'); return; }
    dailyJobRunning = true;
    console.log(`[${new Date().toISOString()}] Daily job started`);
    try {
        const halachot = await scrapeDailyHalachot();
        const subs = getSubs.all();
        let sent = 0, failed = 0;
        for (const { chat_id } of subs) {
            try { await sendHalachot(chat_id, halachot); sent++; }
            catch (e) {
                const errCode = e?.error_code ?? e?.payload?.error_code;
                if (errCode === 403) {
                    console.log(`[broadcast] Removing blocked/deactivated user ${chat_id}`);
                    removeSub.run(chat_id);
                } else if (errCode === 429) {
                    const retryAfter = e?.parameters?.retry_after ?? 30;
                    console.warn(`[broadcast] Rate limited, sleeping ${retryAfter}s`);
                    await sleep(retryAfter * 1000);
                } else {
                    console.error(`[broadcast] Failed for chat_id=${chat_id}: ${e.message}`);
                }
                failed++;
            }
            await sleep(50);
        }
        const msg = `✅ Sent ${sent}/${subs.length} (${failed} failed)\n📖 ${halachot.map(h => h.title).join('\n📖 ')}`;
        console.log(msg);
        if (ADMIN) await bot.api.sendMessage(ADMIN, msg).catch(e => {
            console.error(`Failed to notify admin: ${e.message}`);
        });
    } catch (e) {
        console.error('Daily job failed:', e);
        if (ADMIN) await bot.api.sendMessage(ADMIN, `🚨 Daily job failed: ${e.message}`).catch(e2 => {
            console.error(`Failed to notify admin of failure: ${e2.message}`);
        });
    } finally {
        dailyJobRunning = false;
    }
}

// --- Schedule: 05:00 Israel time, DST-aware ---
cron.schedule('0 5 * * *', dailyJob, { timezone: 'Asia/Jerusalem' });

// --- Start ---
bot.start({ onStart: (info) => {
    console.log(`Bot @${info.username} running. Delivering daily at 05:00 IST.`);
    if (ADMIN) bot.api.sendMessage(ADMIN, `🟢 @${info.username} started`).catch(e => {
        console.error(`Failed to notify admin of startup: ${e.message}`);
    });
}});

// --- Graceful shutdown ---
let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${signal}] Shutting down...`);
    cron.getTasks().forEach(task => task.stop());
    await bot.stop();
    db.close();
    console.log('Shutdown complete');
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
