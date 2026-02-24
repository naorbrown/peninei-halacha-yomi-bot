#!/usr/bin/env node
/**
 * Daily Broadcast Script
 *
 * Run by GitHub Actions on a daily schedule.
 * Scrapes today's halachot and broadcasts to all subscribers + optional channel.
 *
 * Usage: node scripts/broadcast.js
 * Env:   TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, TELEGRAM_CHANNEL_ID (optional)
 *        FORCE_BROADCAST=true to bypass time/duplicate checks
 */

import TelegramBot from 'node-telegram-bot-api';
import { scrapeDailyHalachot, dailyApiUrls, clearCache } from '../src/scraper.js';
import { sendDailyContent } from '../src/sender.js';
import { loadSubscribers, removeSubscriber } from '../src/utils/subscribers.js';
import { wasBroadcastSentToday, markBroadcastSent } from '../src/utils/broadcastState.js';
import { isIsraelBroadcastWindow } from '../src/utils/israelTime.js';

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

  const stats = {
    channel: false,
    channelAudio: 0,
    subscribers: { sent: 0, failed: 0, removed: 0, audioDelivered: 0, textOnly: 0 },
  };

  // --- Channel broadcast ---
  if (CHANNEL_ID) {
    try {
      const result = await sendDailyContent(bot, CHANNEL_ID, halachot, fetch);
      stats.channel = true;
      stats.channelAudio = result.audioCount;
      console.log(`Channel ${CHANNEL_ID}: sent (audio: ${result.audioCount}/${halachot.length})`);
    } catch (e) {
      console.error(`Channel ${CHANNEL_ID} failed: ${e.message}`);
    }
  }

  // --- Subscriber broadcast ---
  const subscribers = await loadSubscribers();
  console.log(`Broadcasting to ${subscribers.length} subscribers...`);

  for (const chatId of subscribers) {
    try {
      const result = await sendDailyContent(bot, chatId, halachot, fetch);
      stats.subscribers.sent++;
      stats.subscribers.audioDelivered += result.audioCount;
      stats.subscribers.textOnly += result.textCount;
    } catch (e) {
      const errCode = e?.response?.body?.error_code;
      if (errCode === 403) {
        console.log(`Removing blocked/deactivated user ${chatId}`);
        await removeSubscriber(chatId);
        stats.subscribers.removed++;
      } else if (errCode === 429) {
        const retryAfter = e?.response?.body?.parameters?.retry_after ?? 30;
        console.warn(`Rate limited, sleeping ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        stats.subscribers.failed++;
      } else {
        console.error(`Failed for chat_id=${chatId}: ${e.message}`);
        stats.subscribers.failed++;
      }
    }
    await sleep(100); // Rate-limit between users
  }

  // --- Mark as sent ---
  const anySuccess = stats.channel || stats.subscribers.sent > 0;
  if (anySuccess) {
    await markBroadcastSent();
  }

  // --- Summary ---
  const totalMessages = subscribers.length * halachot.length;
  const audioRate = totalMessages > 0
    ? Math.round((stats.subscribers.audioDelivered / totalMessages) * 100)
    : 0;

  const summary =
    `✅ Broadcast complete\n` +
    `📖 ${halachot.map(h => h.title).join('\n📖 ')}\n` +
    `📢 Channel: ${stats.channel ? `sent (🔊 ${stats.channelAudio}/${halachot.length} audio)` : 'skipped'}\n` +
    `👥 Subscribers: ${stats.subscribers.sent}/${subscribers.length} sent` +
    (stats.subscribers.failed ? `, ${stats.subscribers.failed} failed` : '') +
    (stats.subscribers.removed ? `, ${stats.subscribers.removed} removed` : '') +
    `\n🔊 Audio: ${stats.subscribers.audioDelivered} delivered, ${stats.subscribers.textOnly} text-only (${audioRate}% audio rate)`;

  console.log(summary);

  // --- Notify admin ---
  if (ADMIN_CHAT_ID) {
    try {
      await bot.sendMessage(ADMIN_CHAT_ID, summary);
    } catch (e) {
      console.error(`Failed to notify admin: ${e.message}`);
    }
  }
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
