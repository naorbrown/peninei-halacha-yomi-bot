#!/usr/bin/env node
require('dotenv').config();
const { Bot } = require('grammy');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { mkdirSync, existsSync } = require('fs');
const { dirname } = require('path');
const lib = require('./lib');

// --- Config ---
const TOKEN = process.env.BOT_TOKEN;
const DB_PATH = process.env.DB_PATH || './data/bot.db';

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

// --- Scraper (uses lib.js with global fetch) ---
function getApiUrls() {
    if (process.env.DAILY_API_URL) return [process.env.DAILY_API_URL];
    return lib.dailyApiUrls();
}

async function scrapeDailyHalachot() {
    return lib.scrapeDailyHalachot(fetch, getApiUrls());
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
        await ctx.reply('⚠️ לא הצלחתי. נסו שוב מאוחר יותר:\n' + lib.DAILY_URL);
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
        const caption = lib.buildCaption(h, i);
        if (h.audioUrl) {
            try {
                // Pass URL string directly so Telegram downloads the file itself.
                // This avoids bot-detection issues on the CDN (Cloudflare etc.)
                // that would block Grammy's own fetch.
                await bot.api.sendAudio(chatId, h.audioUrl, {
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Daily job ---
let dailyJobRunning = false;

async function dailyJob() {
    if (dailyJobRunning) { console.warn('[daily-job] Already running, skipping'); return; }
    dailyJobRunning = true;
    // Clear cache at start of daily job so we always get fresh content
    lib.clearCache();
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
