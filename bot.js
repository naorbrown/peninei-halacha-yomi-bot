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
    const html = await fetchHTML(DAILY_URL);
    const $ = cheerio.load(html);

    // Find halacha links (pattern: /XX-YY-ZZ/)
    const pattern = /^https?:\/\/ph\.yhb\.org\.il\/(\d{2}-\d{2}-\d{2})\/?$/;
    const urls = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && pattern.test(href) && !urls.includes(href)) urls.push(href);
    });

    // Also check script tags for dynamically injected URLs
    if (urls.length < 2) {
        $('script').each((_, el) => {
            const s = $(el).html() || '';
            const matches = s.match(/https?:\/\/ph\.yhb\.org\.il\/\d{2}-\d{2}-\d{2}\/?/g);
            if (matches) matches.forEach(m => { if (!urls.includes(m)) urls.push(m); });
        });
    }

    if (urls.length === 0) throw new Error('No halacha links found — site structure may have changed');

    const results = [];
    for (const url of urls.slice(0, 2)) {
        try { results.push(await scrapeHalachaPage(url)); }
        catch { results.push({ url, title: 'הלכה', audioUrl: null }); }
    }
    return results;
}

async function scrapeHalachaPage(url) {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim() || 'הלכה';

    let audioUrl = $('audio source').attr('src') || $('audio').attr('src') || null;

    if (!audioUrl) $('a[href*=".mp3"]').each((_, el) => { if (!audioUrl) audioUrl = $(el).attr('href'); });

    if (!audioUrl) {
        $('script').each((_, el) => {
            if (audioUrl) return;
            const m = ($(el).html() || '').match(/(https?:\/\/[^\s"']+\.mp3)/);
            if (m) audioUrl = m[1];
        });
    }

    if (!audioUrl) {
        const id = url.match(/(\d{2}-\d{2}-\d{2})/)?.[1];
        if (id) {
            const guess = `https://cdn1.yhb.org.il/uploads/audio/${id}.mp3`;
            try { if ((await fetch(guess, { method: 'HEAD', headers: { 'User-Agent': UA } })).ok) audioUrl = guess; } catch {}
        }
    }

    if (audioUrl?.startsWith('//')) audioUrl = 'https:' + audioUrl;
    else if (audioUrl?.startsWith('/')) audioUrl = BASE + audioUrl;

    return { url, title, audioUrl };
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
