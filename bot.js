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
const ADMIN = process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null;
const DB_PATH = process.env.DB_PATH || './data/bot.db';
const BASE = 'https://ph.yhb.org.il';
const DAILY_API = `${BASE}/wp-content/plugins/db-connect/pninayomit-2025/he_py.php`;
const DAILY_URL = `${BASE}/pninayomit/`;
const UA = 'PenineiHalachaYomiBot/1.0';

if (!TOKEN || TOKEN === 'your_bot_token_here') {
    console.error('Set BOT_TOKEN in .env'); process.exit(1);
}

// --- Database (SQLite) ---
if (!existsSync(dirname(DB_PATH))) mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        active  INTEGER DEFAULT 1
    );
`);

const addSub    = db.prepare('INSERT OR REPLACE INTO subscribers (chat_id, active) VALUES (?, 1)');
const removeSub = db.prepare('UPDATE subscribers SET active = 0 WHERE chat_id = ?');
const getSubs   = db.prepare('SELECT chat_id FROM subscribers WHERE active = 1');

// --- Scraper ---
async function fetchHTML(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.text();
}

async function scrapeDailyHalachot() {
    // The site loads content dynamically via API with a timestamp parameter
    const html = await fetchHTML(`${DAILY_API}?date=${Date.now()}`);
    const $ = cheerio.load(html);

    const results = [];
    $('.ym-hala-1, .ym-hala-2').each((i, container) => {
        const $c = $(container);
        const link = $c.find('h3 a[href]').first();
        const url = link.attr('href') || DAILY_URL;
        const title = link.text().trim() || 'הלכה';
        let audioUrl = $c.find('audio source').attr('src') || $c.find('audio').attr('src') || null;

        // Fallback: derive audio URL from page URL (e.g. /20-26-12/ → mp3/20-26-12.mp3)
        if (!audioUrl) {
            const id = url.match(/(\d{2}-\d{2}-\d{2})/)?.[1];
            if (id) audioUrl = `https://cdn1.yhb.org.il/mp3/${id}.mp3`;
        }

        if (audioUrl?.startsWith('//')) audioUrl = 'https:' + audioUrl;
        else if (audioUrl?.startsWith('/')) audioUrl = BASE + audioUrl;

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

    if (results.length === 0) throw new Error('No halacha links found — site structure may have changed');
    return results.slice(0, 2);
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
        await ctx.reply('⚠️ לא הצלחתי. נסו שוב מאוחר יותר:\n' + DAILY_URL);
    }
});

bot.command('send', async (ctx) => {
    if (ctx.chat.id !== ADMIN) return;
    await ctx.reply('🚀 שולח...');
    await dailyJob();
});

bot.catch((err) => console.error('Bot error:', err.message));

// --- Send halachot to one chat ---
async function sendHalachot(chatId, halachot) {
    for (let i = 0; i < halachot.length; i++) {
        const h = halachot[i];
        const caption = `📖 *הלכה ${i === 0 ? 'א' : 'ב'}:* ${escMd(h.title)}\n🔗 [לקריאה באתר](${h.url})`;
        if (h.audioUrl) {
            try {
                await bot.api.sendAudio(chatId, new InputFile(new URL(h.audioUrl)), {
                    caption, parse_mode: 'Markdown', title: h.title, performer: 'פניני הלכה',
                });
                continue;
            } catch { /* fall through to text */ }
        }
        await bot.api.sendMessage(chatId, caption + '\n\n_⚠️ הקלטה לא זמינה_', {
            parse_mode: 'Markdown', disable_web_page_preview: true,
        });
    }
}

function escMd(s) { return (s || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Daily job ---
async function dailyJob() {
    console.log(`[${new Date().toISOString()}] Daily job started`);
    try {
        const halachot = await scrapeDailyHalachot();
        const subs = getSubs.all();
        let sent = 0, failed = 0;
        for (const { chat_id } of subs) {
            try { await sendHalachot(chat_id, halachot); sent++; }
            catch (e) {
                if (e.message?.includes('blocked') || e.message?.includes('deactivated') || e.error_code === 403)
                    removeSub.run(chat_id);
                failed++;
            }
            await sleep(50);
        }
        const msg = `✅ Sent ${sent}/${subs.length} (${failed} failed)\n📖 ${halachot.map(h => h.title).join('\n📖 ')}`;
        console.log(msg);
        if (ADMIN) await bot.api.sendMessage(ADMIN, msg).catch(() => {});
    } catch (e) {
        console.error('Daily job failed:', e.message);
        if (ADMIN) await bot.api.sendMessage(ADMIN, `🚨 Daily job failed: ${e.message}`).catch(() => {});
    }
}

// --- Schedule: 05:00 Israel time, DST-aware ---
cron.schedule('0 5 * * *', dailyJob, { timezone: 'Asia/Jerusalem' });

// --- Start ---
bot.start({ onStart: (info) => {
    console.log(`Bot @${info.username} running. Delivering daily at 05:00 IST.`);
    if (ADMIN) bot.api.sendMessage(ADMIN, `🟢 @${info.username} started`).catch(() => {});
}});

process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
