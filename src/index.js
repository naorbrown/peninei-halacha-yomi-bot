#!/usr/bin/env node
/**
 * Peninei Halacha Yomi — Interactive Telegram Bot
 *
 * Handles user commands via long polling:
 *   /start  — Subscribe and get today's halachot
 *   /stop   — Unsubscribe
 *   /today  — Get today's halachot immediately
 *   /send   — Admin-only manual broadcast trigger
 *
 * Daily broadcasts are handled by GitHub Actions (scripts/broadcast.js).
 * This process only handles interactive commands.
 */

import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { scrapeDailyHalachot, dailyApiUrls, clearCache, DAILY_URL } from './scraper.js';
import { buildWelcomeMessage } from './messageBuilder.js';
import { sendDailyContent, sendSpedUpHalacha } from './sender.js';
import { addSubscriber, removeSubscriber } from './utils/subscribers.js';
import { createRateLimiter } from './utils/rateLimiter.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = (() => {
  const raw = process.env.ADMIN_CHAT_ID;
  const n = Number(raw);
  return Number.isInteger(n) && n !== 0 ? n : null;
})();

if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here') {
  console.error('TELEGRAM_BOT_TOKEN required');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const limiter = createRateLimiter();

// Resolve API URLs (respect env override)
function getApiUrls() {
  if (process.env.DAILY_API_URL) return [process.env.DAILY_API_URL];
  return dailyApiUrls();
}

// Initialize bot commands
(async () => {
  await bot.setMyCommands([
    { command: 'start', description: 'הרשמה — הלכה יומית' },
    { command: 'today', description: 'הלכות היום עכשיו' },
    { command: 'stop', description: 'הפסקת קבלה' },
  ]).catch(() => {});
  console.log('Peninei Halacha Yomi Bot started');
})();

// Command handler
bot.on('message', async msg => {
  if (!msg.text?.startsWith('/')) return;

  const chatId = msg.chat.id;
  const command = msg.text.split('@')[0].slice(1).split(' ')[0].toLowerCase();

  if (command === 'start') {
    if (limiter.isRateLimited(chatId)) {
      return bot.sendMessage(chatId, '_אנא המתינו._', { parse_mode: 'Markdown' });
    }

    try {
      const isNew = await addSubscriber(chatId);
      if (isNew) console.log(`New subscriber: ${chatId}`);

      await bot.sendMessage(chatId, buildWelcomeMessage(), { parse_mode: 'Markdown' });

      const halachot = await scrapeDailyHalachot(fetch, getApiUrls());
      const result = await sendDailyContent(bot, chatId, halachot, fetch);
      console.log(`[/start] chat=${chatId} audio=${result.audioCount} text=${result.textCount}`);
    } catch (err) {
      console.error('Command /start failed:', err.message);
      await bot.sendMessage(chatId, '⚠️ לא הצלחתי. נסו שוב מאוחר יותר:\n' + DAILY_URL).catch(() => {});
    }
  } else if (command === 'stop') {
    await removeSubscriber(chatId);
    await bot.sendMessage(chatId, '👋 הוסרת. תמיד אפשר לחזור עם /start');
  } else if (command === 'today') {
    if (limiter.isRateLimited(chatId)) {
      return bot.sendMessage(chatId, '_אנא המתינו._', { parse_mode: 'Markdown' });
    }

    await bot.sendMessage(chatId, '🔄 מחפש...');
    try {
      const halachot = await scrapeDailyHalachot(fetch, getApiUrls());
      const result = await sendDailyContent(bot, chatId, halachot, fetch);
      console.log(`[/today] chat=${chatId} audio=${result.audioCount} text=${result.textCount}`);
    } catch (e) {
      console.error(`[/today] chat=${chatId} failed:`, e);
      await bot.sendMessage(chatId, '⚠️ לא הצלחתי. נסו שוב מאוחר יותר:\n' + DAILY_URL).catch(() => {});
    }
  } else if (command === 'send') {
    if (!ADMIN_CHAT_ID || chatId !== ADMIN_CHAT_ID) {
      console.warn(`[/send] Unauthorized attempt from chat_id=${chatId}`);
      return;
    }
    console.log('[/send] Admin triggered manual broadcast');
    await bot.sendMessage(chatId, '🚀 שולח...');
    try {
      clearCache();
      const halachot = await scrapeDailyHalachot(fetch, getApiUrls());
      const result = await sendDailyContent(bot, chatId, halachot, fetch);
      await bot.sendMessage(chatId, `✅ נשלח (🔊 ${result.audioCount}/${halachot.length} audio)`);
    } catch (e) {
      await bot.sendMessage(chatId, `🚨 Failed: ${e.message}`).catch(() => {});
    }
  }
});

// --- Speed control callback handler ---
bot.on('callback_query', async (query) => {
  const data = query.data;
  if (!data?.startsWith('spd:')) return;

  const chatId = query.message.chat.id;
  const [, speedStr, indexStr] = data.split(':');
  const speed = parseFloat(speedStr);
  const index = parseInt(indexStr, 10);

  if (![1.5, 2].includes(speed) || ![0, 1].includes(index)) {
    return bot.answerCallbackQuery(query.id, { text: 'Invalid request' });
  }

  await bot.answerCallbackQuery(query.id, { text: `⏳ מכין ${speed}x...` });

  try {
    const halachot = await scrapeDailyHalachot(fetch, getApiUrls());
    if (!halachot[index]) {
      return bot.sendMessage(chatId, '⚠️ לא נמצאה הלכה.');
    }
    await sendSpedUpHalacha(bot, chatId, halachot[index], index, speed, fetch);
    console.log(`[speed] chat=${chatId} speed=${speed}x index=${index}`);
  } catch (err) {
    console.error(`[speed] chat=${chatId} failed:`, err.message);
    await bot.sendMessage(chatId, '⚠️ לא הצלחתי לשנות מהירות. נסו שוב מאוחר יותר.').catch(() => {});
  }
});

// Daily broadcasts are handled by GitHub Actions (scripts/broadcast.js)
console.log('Daily broadcasts delegated to GitHub Actions');

bot.on('polling_error', err => console.error('Polling error:', err.message));
bot.on('error', err => console.error('Bot error:', err.message));

process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });
process.on('SIGINT', () => { bot.stopPolling(); process.exit(0); });

process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection:', reason);
});
