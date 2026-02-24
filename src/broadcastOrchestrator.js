/**
 * Broadcast Orchestrator
 *
 * Core broadcast logic extracted for testability.
 * Handles delivery to admin, channel, and subscribers with deduplication.
 */

import { sendDailyContent } from './sender.js';

/**
 * Run the broadcast delivery pipeline.
 *
 * Delivery order:
 *   1. Admin (always, if configured — guaranteed recipient)
 *   2. Channel (if configured and not already delivered)
 *   3. Subscribers (skip already-delivered chat IDs)
 *
 * @param {object} params
 * @param {object} params.bot - Telegram bot instance
 * @param {Array}  params.halachot - Parsed halachot to send
 * @param {Function} params.fetchFn - fetch implementation
 * @param {number|null} params.adminChatId - Admin chat ID
 * @param {string|null} params.channelId - Channel ID
 * @param {number[]} params.subscribers - Subscriber chat IDs
 * @param {Function} params.removeSubscriber - Remove a subscriber by chat ID
 * @param {Function} params.sleep - Sleep function (for rate limiting)
 * @returns {Promise<object>} Broadcast stats and summary
 */
export async function runBroadcastDelivery({
  bot,
  halachot,
  fetchFn,
  adminChatId,
  channelId,
  subscribers,
  removeSubscriber,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
}) {
  // Track which chat IDs already received content (to avoid duplicates)
  const delivered = new Set();

  const stats = {
    admin: false,
    adminAudio: 0,
    channel: false,
    channelAudio: 0,
    subscribers: { sent: 0, failed: 0, removed: 0, audioDelivered: 0, textOnly: 0 },
  };

  // --- Admin delivery (always send content to admin first) ---
  if (adminChatId) {
    try {
      const result = await sendDailyContent(bot, adminChatId, halachot, fetchFn);
      stats.admin = true;
      stats.adminAudio = result.audioCount;
      delivered.add(String(adminChatId));
      console.log(`Admin ${adminChatId}: sent (audio: ${result.audioCount}/${halachot.length})`);
    } catch (e) {
      console.error(`Admin ${adminChatId} delivery failed: ${e.message}`);
    }
  }

  // --- Channel broadcast (skip if same as admin) ---
  if (channelId && !delivered.has(String(channelId))) {
    try {
      const result = await sendDailyContent(bot, channelId, halachot, fetchFn);
      stats.channel = true;
      stats.channelAudio = result.audioCount;
      delivered.add(String(channelId));
      console.log(`Channel ${channelId}: sent (audio: ${result.audioCount}/${halachot.length})`);
    } catch (e) {
      console.error(`Channel ${channelId} failed: ${e.message}`);
    }
  } else if (channelId && delivered.has(String(channelId))) {
    stats.channel = true;
    stats.channelAudio = stats.adminAudio;
    console.log(`Channel ${channelId}: already delivered via admin`);
  }

  // --- Subscriber broadcast (skip already-delivered chats) ---
  for (const chatId of subscribers) {
    if (delivered.has(String(chatId))) {
      stats.subscribers.sent++;
      console.log(`Subscriber ${chatId}: already delivered, skipping`);
      continue;
    }

    try {
      const result = await sendDailyContent(bot, chatId, halachot, fetchFn);
      stats.subscribers.sent++;
      stats.subscribers.audioDelivered += result.audioCount;
      stats.subscribers.textOnly += result.textCount;
      delivered.add(String(chatId));
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

  // --- Summary ---
  const anySuccess = stats.admin || stats.channel || stats.subscribers.sent > 0;
  const totalRecipients = delivered.size;
  const totalAudio = stats.adminAudio + stats.channelAudio + stats.subscribers.audioDelivered;

  const summary =
    `✅ Broadcast complete\n` +
    `📖 ${halachot.map(h => h.title).join('\n📖 ')}\n` +
    `👤 Admin: ${stats.admin ? `sent (🔊 ${stats.adminAudio}/${halachot.length} audio)` : 'not configured'}\n` +
    `📢 Channel: ${stats.channel ? `sent (🔊 ${stats.channelAudio}/${halachot.length} audio)` : (channelId ? 'failed' : 'not configured')}\n` +
    `👥 Subscribers: ${stats.subscribers.sent}/${subscribers.length} sent` +
    (stats.subscribers.failed ? `, ${stats.subscribers.failed} failed` : '') +
    (stats.subscribers.removed ? `, ${stats.subscribers.removed} removed` : '') +
    `\n📊 Total: ${totalRecipients} recipients, ${totalAudio} audio messages`;

  return { stats, summary, anySuccess, delivered };
}
