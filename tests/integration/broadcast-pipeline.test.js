/**
 * Integration test — Full broadcast pipeline (E2E)
 *
 * Tests the complete flow: scrape HTML → parse halachot → download audio →
 * convert to OGG Opus → send via Telegram bot. All external I/O is mocked
 * but the pipeline logic is real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { scrapeDailyHalachot, clearCache } from '../../src/scraper.js';
import { sendDailyContent } from '../../src/sender.js';

// Mock the OGG converter
vi.mock('../../src/audioSpeed.js', () => ({
  convertToOgg: vi.fn(async (buf) => Buffer.alloc(buf.length, 0xaa)),
}));

const __dirname = dirname(fileURLToPath(import.meta.url));

const fixture = (name) =>
  readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');

const FIXTURES = {
  standard: fixture('daily-page.html'),
  noAudio: fixture('daily-page-no-audio.html'),
};

/** Create a realistic fake MP3 buffer */
function fakeMp3(size = 5000) {
  return Buffer.alloc(size, 0xff);
}

/** Create a mock bot */
function createBot() {
  return {
    sendVoice: vi.fn(async () => ({ message_id: 1 })),
    sendAudio: vi.fn(async () => ({ message_id: 1 })),
    sendMessage: vi.fn(async () => ({ message_id: 2 })),
  };
}

/**
 * Create a mock fetch that serves HTML for scraper URLs and audio for CDN URLs.
 * The scraper calls .text() and the sender calls .arrayBuffer().
 *
 * @param {string} html - HTML to return for scraper requests
 * @param {object} audioOpts - { succeed: boolean, buffer?: Buffer }
 */
function createPipelineFetch(html, audioOpts = { succeed: true }) {
  const buf = audioOpts.buffer || fakeMp3();

  return vi.fn(async (url) => {
    // Audio download requests (CDN URLs)
    if (url.includes('cdn1.yhb.org.il') || url.includes('.mp3')) {
      if (!audioOpts.succeed) {
        if (audioOpts.throw) throw new Error(audioOpts.errorMsg || 'CDN unreachable');
        return { ok: false, status: audioOpts.status || 403, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return {
        ok: true,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        text: async () => '', // not used for audio
      };
    }

    // Scraper HTML requests
    return {
      ok: true,
      text: async () => html,
      arrayBuffer: async () => new ArrayBuffer(0), // not used for HTML
    };
  });
}

// ---------------------------------------------------------------------------
// Full pipeline: scrape → send with audio
// ---------------------------------------------------------------------------

describe('Broadcast pipeline — full E2E', () => {
  beforeEach(() => clearCache());

  it('scrapes HTML and sends voice messages for both halachot', async () => {
    const fetchFn = createPipelineFetch(FIXTURES.standard);
    const bot = createBot();

    // Step 1: Scrape
    const halachot = await scrapeDailyHalachot(fetchFn, ['https://ph.yhb.org.il/api/test']);
    expect(halachot).toHaveLength(2);
    expect(halachot[0].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-12.mp3');
    expect(halachot[1].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-13.mp3');

    // Step 2: Send
    const result = await sendDailyContent(bot, 123, halachot, fetchFn);

    // Verify: both sent as voice
    expect(result.audioCount).toBe(2);
    expect(result.textCount).toBe(0);
    expect(bot.sendVoice).toHaveBeenCalledTimes(2);
    expect(bot.sendMessage).not.toHaveBeenCalled();

    // Verify: buffers were uploaded (not URLs)
    for (const call of bot.sendVoice.mock.calls) {
      expect(Buffer.isBuffer(call[1])).toBe(true);
    }
  });

  it('scrapes page without audio tags, derives URLs, and sends voice messages', async () => {
    const fetchFn = createPipelineFetch(FIXTURES.noAudio);
    const bot = createBot();

    const halachot = await scrapeDailyHalachot(fetchFn, ['https://ph.yhb.org.il/api/test']);
    // Audio URLs derived from page URL pattern
    expect(halachot[0].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-12.mp3');

    const result = await sendDailyContent(bot, 456, halachot, fetchFn);

    expect(result.audioCount).toBe(2);
    expect(result.textCount).toBe(0);
  });

  it('falls back to URL passthrough when audio download fails', async () => {
    const scrapeFetch = createPipelineFetch(FIXTURES.standard);
    const bot = createBot();

    // Scrape first with working fetch
    const halachot = await scrapeDailyHalachot(scrapeFetch, ['https://ph.yhb.org.il/api/test']);

    // Send with fetch that fails on audio downloads
    const audioFailFetch = createPipelineFetch(FIXTURES.standard, { succeed: false, status: 403 });
    const result = await sendDailyContent(bot, 789, halachot, audioFailFetch);

    // Should still succeed via URL passthrough (sendAudio)
    expect(result.audioCount).toBe(2);
    expect(result.textCount).toBe(0);

    // Verify URL strings were passed via sendAudio (not sendVoice)
    expect(bot.sendVoice).not.toHaveBeenCalled();
    for (const call of bot.sendAudio.mock.calls) {
      expect(typeof call[1]).toBe('string');
    }
  });

  it('falls back to text when both voice and URL passthrough fail', async () => {
    const scrapeFetch = createPipelineFetch(FIXTURES.standard);
    const bot = createBot();
    // URL passthrough also fails
    bot.sendAudio.mockRejectedValue(new Error('Telegram cannot fetch URL'));

    const halachot = await scrapeDailyHalachot(scrapeFetch, ['https://ph.yhb.org.il/api/test']);

    // Send with fetch that throws on audio downloads
    const audioFailFetch = createPipelineFetch(FIXTURES.standard, { succeed: false, throw: true, errorMsg: 'CDN down' });
    const result = await sendDailyContent(bot, 999, halachot, audioFailFetch);

    // Falls back to text
    expect(result.audioCount).toBe(0);
    expect(result.textCount).toBe(2);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);

    // Verify text contains halacha info
    const msg1 = bot.sendMessage.mock.calls[0][1];
    expect(msg1).toContain('הלכה א');
    expect(msg1).toContain('הקלטה לא זמינה');
  });

  it('handles mixed success: voice for first, URL passthrough for second', async () => {
    const scrapeFetch = createPipelineFetch(FIXTURES.standard);
    const bot = createBot();

    const halachot = await scrapeDailyHalachot(scrapeFetch, ['https://ph.yhb.org.il/api/test']);

    // Create fetch that succeeds for first audio, fails for second
    let audioCallCount = 0;
    const mixedFetch = vi.fn(async (url) => {
      if (url.includes('cdn1.yhb.org.il') || url.includes('.mp3')) {
        audioCallCount++;
        if (audioCallCount <= 1) {
          const buf = fakeMp3();
          return {
            ok: true,
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          };
        }
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, text: async () => FIXTURES.standard };
    });

    const result = await sendDailyContent(bot, 555, halachot, mixedFetch);

    // Both should be audio (first via voice, second via URL passthrough)
    expect(result.audioCount).toBe(2);
    expect(result.textCount).toBe(0);

    // First call: sendVoice with buffer
    expect(bot.sendVoice).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(bot.sendVoice.mock.calls[0][1])).toBe(true);
    // Second call: sendAudio with URL string (fallback)
    expect(bot.sendAudio).toHaveBeenCalledTimes(1);
    expect(typeof bot.sendAudio.mock.calls[0][1]).toBe('string');
  });

  it('broadcasts to multiple subscribers with independent error handling', async () => {
    const fetchFn = createPipelineFetch(FIXTURES.standard);

    const halachot = await scrapeDailyHalachot(fetchFn, ['https://ph.yhb.org.il/api/test']);

    // Simulate broadcasting to 3 subscribers
    const subscribers = [111, 222, 333];
    const results = [];

    for (const chatId of subscribers) {
      const bot = createBot();
      if (chatId === 222) {
        // Subscriber 222 is blocked
        bot.sendVoice.mockRejectedValue({ response: { body: { error_code: 403 } } });
        bot.sendAudio.mockRejectedValue({ response: { body: { error_code: 403 } } });
        bot.sendMessage.mockRejectedValue({ response: { body: { error_code: 403 } } });
        try {
          await sendDailyContent(bot, chatId, halachot, fetchFn);
          results.push({ chatId, success: true });
        } catch {
          results.push({ chatId, success: false });
        }
      } else {
        const result = await sendDailyContent(bot, chatId, halachot, fetchFn);
        results.push({ chatId, success: true, ...result });
      }
    }

    // Subscriber 111 and 333 should succeed
    expect(results[0].success).toBe(true);
    expect(results[0].audioCount).toBe(2);
    expect(results[2].success).toBe(true);
    expect(results[2].audioCount).toBe(2);

    // Subscriber 222 should fail
    expect(results[1].success).toBe(false);
  });

  it('full pipeline preserves halacha metadata through caption', async () => {
    const fetchFn = createPipelineFetch(FIXTURES.standard);
    const bot = createBot();

    const halachot = await scrapeDailyHalachot(fetchFn, ['https://ph.yhb.org.il/api/test']);
    await sendDailyContent(bot, 123, halachot, fetchFn);

    // First halacha
    const [, , opts1] = bot.sendVoice.mock.calls[0];
    expect(opts1.caption).toContain('הלכה א');
    expect(opts1.caption).toContain('ph.yhb.org.il/20-26-12');

    // Second halacha
    const [, , opts2] = bot.sendVoice.mock.calls[1];
    expect(opts2.caption).toContain('הלכה ב');
    expect(opts2.caption).toContain('ph.yhb.org.il/20-26-13');
  });
});
