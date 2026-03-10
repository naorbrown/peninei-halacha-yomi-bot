/**
 * Shared Halacha Sending Module
 *
 * Downloads audio files directly, converts to OGG Opus, and sends as
 * voice messages via Telegram. Voice messages get native speed controls
 * (0.5x, 1x, 1.5x, 2x) regardless of audio duration.
 *
 * Fallback chain per halacha:
 *   1. Download MP3 → convert to OGG Opus → sendVoice (native speed controls)
 *   2. Send as audio file via URL passthrough (no native speed controls)
 *   3. Send text-only message with "audio unavailable" note
 */

import { FETCH_HEADERS } from './scraper.js';
import { buildCaption } from './messageBuilder.js';
import { convertToOgg } from './audioSpeed.js';

// Suppress node-telegram-bot-api deprecation warning for Buffer filenames
process.env.NTBA_FIX_350 = '1';

/**
 * Download an audio file and return it as a Buffer.
 * Uses our custom headers so CDNs that block bots still serve the file.
 *
 * @param {string} url - Audio file URL
 * @param {Function} fetchFn - fetch implementation
 * @param {number} retries - number of retry attempts
 * @returns {Promise<Buffer>}
 */
export async function downloadAudio(url, fetchFn = fetch, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchFn(url, {
        headers: {
          ...FETCH_HEADERS,
          Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.5',
        },
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1000) {
        throw new Error(`Audio too small (${buffer.length} bytes), likely not a valid file`);
      }
      return buffer;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Send a single halacha to a chat.
 *
 * Tries three strategies in order:
 *   1. Download MP3 → convert to OGG Opus → sendVoice (native speed controls)
 *   2. Pass audio URL to Telegram as sendAudio (fallback, no speed controls)
 *   3. Text-only fallback
 *
 * @param {TelegramBot} bot
 * @param {number|string} chatId
 * @param {{ url: string, title: string, audioUrl: string|null }} halacha
 * @param {number} index - 0 or 1
 * @param {Function} fetchFn - fetch implementation (for downloading audio)
 * @returns {Promise<{ audio: boolean }>}
 */
export async function sendHalacha(bot, chatId, halacha, index, fetchFn = fetch) {
  const caption = buildCaption(halacha, index);

  if (halacha.audioUrl) {
    // Download MP3 → convert to OGG Opus → sendVoice (native speed controls)
    // Always send as voice message to preserve speed controls.
    // No fallback to sendAudio which lacks speed controls.
    try {
      const mp3Buffer = await downloadAudio(halacha.audioUrl, fetchFn);
      const oggBuffer = await convertToOgg(mp3Buffer);
      await bot.sendVoice(chatId, oggBuffer, {
        caption,
        parse_mode: 'Markdown',
      }, {
        filename: `halacha-${index + 1}.ogg`,
        contentType: 'audio/ogg',
      });
      return { audio: true };
    } catch (err) {
      console.warn(`[audio] Voice message failed for ${halacha.audioUrl}: ${err.message}`);
    }
  }

  // Strategy 3: Text-only fallback
  await bot.sendMessage(chatId, caption + '\n\n_⚠️ הקלטה לא זמינה_', {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
  return { audio: false };
}

/**
 * Send today's halachot to a single chat.
 *
 * @param {TelegramBot} bot
 * @param {number|string} chatId
 * @param {Array} halachot
 * @param {Function} fetchFn
 * @returns {Promise<{ audioCount: number, textCount: number }>}
 */
export async function sendDailyContent(bot, chatId, halachot, fetchFn = fetch) {
  let audioCount = 0;
  let textCount = 0;

  for (let i = 0; i < halachot.length; i++) {
    const result = await sendHalacha(bot, chatId, halachot[i], i, fetchFn);
    if (result.audio) audioCount++;
    else textCount++;
  }

  return { audioCount, textCount };
}
