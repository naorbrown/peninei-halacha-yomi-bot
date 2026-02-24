#!/usr/bin/env node
/**
 * Daily Broadcast Script
 *
 * Run by GitHub Actions on a daily schedule.
 * Scrapes today's halachot and broadcasts to admin + optional channel + subscribers.
 *
 * Usage: node scripts/broadcast.js
 * Env:   TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, TELEGRAM_CHANNEL_ID (optional)
 *        FORCE_BROADCAST=true to bypass time/duplicate checks
 */

import TelegramBot from 'node-telegram-bot-api';
import { scrapeDailyHalachot, dailyApiUrls, clearCache } from '../src/scraper.js';
import { loadSubscribers, removeSubscriber } from '../src/utils/subscribers.js';
import { wasBroadcastSentToday, markBroadcastSent } from '../src/utils/broadcastState.js';
import { isIsraelBroadcastWindow } from '../src/utils/israelTime.js';
import { runBroadcastDelivery } from '../src/broadcastOrchestrator.js';

// --- Config ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || null;
const ADMIN_CHAT_ID = (() => {
  const n = Number(process.env.ADMIN_CHAT_ID);
  return Number.isInteger(n) && n !== 0 ? n : null;
})();
const FORCE = process.env.FORCE_BROADCAST === 'true';

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN required');
  process.exit(1);
}

// Diagnostic warnings
if (ADMIN_CHAT_ID && CHANNEL_ID && String(ADMIN_CHAT_ID) === String(CHANNEL_ID)) {
  console.warn('⚠️  ADMIN_CHAT_ID equals CHANNEL_ID — admin messages will go to the channel');
}

const bot = new TelegramBot(BOT_TOKEN);

/**
 * Main broadcast function
 */
async function runBroadcast() {
  // --- Guards ---
  if (!FORCE) {
    if (!isIsraelBroadcastWindow()) {
      console.log('Outside Israel broadcast window (0-7), skipping.');
      return;
    }
    if (await wasBroadcastSentToday()) {
      console.log('Broadcast already sent today, skipping.');
      return;
    }
  } else {
    console.log('FORCE_BROADCAST=true — bypassing time and duplicate checks');
  }

  // --- Scrape ---
  clearCache();
  console.log('Scraping daily halachot...');
  const apiUrls = process.env.DAILY_API_URL
    ? [process.env.DAILY_API_URL]
    : dailyApiUrls();
  const halachot = await scrapeDailyHalachot(fetch, apiUrls);
  console.log(`Found ${halachot.length} halachot: ${halachot.map(h => h.title).join(', ')}`);
  console.log(`Audio URLs: ${halachot.map(h => h.audioUrl || '(none)').join(', ')}`);

  // --- Deliver ---
  const subscribers = await loadSubscribers();
  console.log(`Broadcasting to admin + ${subscribers.length} subscribers...`);

  const { summary, anySuccess } = await runBroadcastDelivery({
    bot,
    halachot,
    fetchFn: fetch,
    adminChatId: ADMIN_CHAT_ID,
    channelId: CHANNEL_ID,
    subscribers,
    removeSubscriber,
  });

  // --- Mark as sent ---
  if (anySuccess) {
    await markBroadcastSent();
  }

  console.log(summary);
}

// --- Run ---
runBroadcast()
  .then(() => {
    console.log('Broadcast script finished');
    process.exit(0);
  })
  .catch(err => {
    console.error('Broadcast failed:', err);
    // Notify admin of failure
    if (ADMIN_CHAT_ID) {
      bot.sendMessage(ADMIN_CHAT_ID, `🚨 Broadcast failed: ${err.message}`)
        .catch(() => {})
        .finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  });
