/**
 * Shared Halacha Sending Module
 *
 * Downloads audio files directly and uploads them as buffers to Telegram,
 * bypassing the unreliable URL-pass-through where Telegram servers fetch
 * from the CDN (which may block non-browser user agents).
 *
 * Fallback chain per halacha:
 *   1. Download MP3 ourselves → upload buffer to Telegram
 *   2. Pass audio URL to Telegram (let Telegram fetch)
 *   3. Send text-only message with "audio unavailable" note
 */

import { FETCH_HEADERS } from './scraper.js';
import { buildCaption } from './messageBuilder.js';

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
 *   1. Download audio → upload buffer (most reliable)
 *   2. Pass URL to Telegram API (Telegram downloads)
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
    // Strategy 1: Download audio ourselves and upload buffer
    try {
      const buffer = await downloadAudio(halacha.audioUrl, fetchFn);
      await bot.sendAudio(chatId, buffer, {
        caption,
        parse_mode: 'Markdown',
        title: halacha.title,
        performer: 'פניני הלכה',
      }, {
        filename: `halacha-${index + 1}.mp3`,
        contentType: 'audio/mpeg',
      });
      return { audio: true };
    } catch (dlErr) {
      console.warn(`[audio] Buffer upload failed for ${halacha.audioUrl}: ${dlErr.message}`);
    }

    // Strategy 2: Pass URL directly to Telegram
    try {
      await bot.sendAudio(chatId, halacha.audioUrl, {
        caption,
        parse_mode: 'Markdown',
        title: halacha.title,
        performer: 'פניני הלכה',
      });
      return { audio: true };
    } catch (urlErr) {
      console.warn(`[audio] URL passthrough failed for ${halacha.audioUrl}: ${urlErr.message}`);
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
