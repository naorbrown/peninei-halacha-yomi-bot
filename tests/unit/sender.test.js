/**
 * Sender tests — downloadAudio, sendHalacha, sendDailyContent
 *
 * Validates the audio fallback chain:
 *   1. Download MP3 → convert to OGG Opus → sendVoice (native speed controls)
 *   2. Text-only fallback (no sendAudio — speed controls must be preserved)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadAudio, sendHalacha, sendDailyContent } from '../../src/sender.js';

// Mock the OGG converter — returns a fake OGG buffer
vi.mock('../../src/audioSpeed.js', () => ({
  convertToOgg: vi.fn(async (buf) => {
    // Return a buffer marked as OGG (same size, different content)
    const ogg = Buffer.alloc(buf.length, 0xaa);
    ogg._isOgg = true;
    return ogg;
  }),
}));

// --- Helpers ---

/** Create a fake MP3 buffer (valid size) */
function fakeMp3Buffer(size = 5000) {
  return Buffer.alloc(size, 0xff);
}

/** Mock fetch that returns a successful audio response */
function mockFetchAudioOk(buffer) {
  const buf = buffer || fakeMp3Buffer();
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }));
}

/** Mock fetch that fails */
function mockFetchFail(status = 500) {
  return vi.fn(async () => ({
    ok: false,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
}

/** Mock fetch that throws network error */
function mockFetchThrow(msg = 'network error') {
  return vi.fn(async () => { throw new Error(msg); });
}

/** Create a mock Telegram bot */
function createMockBot() {
  return {
    sendVoice: vi.fn(async () => ({ message_id: 1 })),
    sendAudio: vi.fn(async () => ({ message_id: 1 })),
    sendMessage: vi.fn(async () => ({ message_id: 2 })),
  };
}

/** Standard test halacha with audio */
const HALACHA_WITH_AUDIO = {
  url: 'https://ph.yhb.org.il/20-26-12/',
  title: 'פרק כו – הלכות שבת – סעיף יב',
  audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
};

/** Test halacha without audio */
const HALACHA_NO_AUDIO = {
  url: 'https://ph.yhb.org.il/20-26-12/',
  title: 'פרק כו – הלכות שבת – סעיף יב',
  audioUrl: null,
};

// ---------------------------------------------------------------------------
// downloadAudio
// ---------------------------------------------------------------------------

describe('downloadAudio()', () => {
  it('downloads and returns a buffer on success', async () => {
    const expected = fakeMp3Buffer(8000);
    const fetchFn = mockFetchAudioOk(expected);

    const result = await downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 0);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(8000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('passes correct headers including audio Accept', async () => {
    const fetchFn = mockFetchAudioOk();

    await downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 0);

    const [, opts] = fetchFn.mock.calls[0];
    expect(opts.headers.Accept).toContain('audio/mpeg');
    expect(opts.headers['User-Agent']).toBeDefined();
  });

  it('retries on failure and succeeds', async () => {
    let calls = 0;
    const buf = fakeMp3Buffer();
    const fetchFn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('network error');
      return {
        ok: true,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    });

    const result = await downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 2);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    const fetchFn = mockFetchThrow('timeout');

    await expect(
      downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 1),
    ).rejects.toThrow('timeout');
  });

  it('throws on HTTP error status', async () => {
    const fetchFn = mockFetchFail(404);

    await expect(
      downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 0),
    ).rejects.toThrow('HTTP 404');
  });

  it('rejects audio files that are too small', async () => {
    const tinyBuf = Buffer.alloc(100);
    const fetchFn = mockFetchAudioOk(tinyBuf);

    await expect(
      downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 0),
    ).rejects.toThrow('too small');
  });

  it('retries on HTTP error then succeeds', async () => {
    let calls = 0;
    const buf = fakeMp3Buffer();
    const fetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
      return {
        ok: true,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    });

    const result = await downloadAudio('https://cdn1.yhb.org.il/mp3/test.mp3', fetchFn, 1);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// sendHalacha — fallback chain
// ---------------------------------------------------------------------------

describe('sendHalacha()', () => {
  let bot;

  beforeEach(() => {
    bot = createMockBot();
  });

  describe('Strategy 1: voice upload (download + convert + sendVoice)', () => {
    it('downloads audio, converts to OGG, and sends as voice', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendVoice).toHaveBeenCalledTimes(1);
      expect(bot.sendAudio).not.toHaveBeenCalled();
      expect(bot.sendMessage).not.toHaveBeenCalled();

      // Verify buffer was passed (not URL string)
      const voiceArg = bot.sendVoice.mock.calls[0][1];
      expect(Buffer.isBuffer(voiceArg)).toBe(true);
    });

    it('passes correct file options for voice upload', async () => {
      const fetchFn = mockFetchAudioOk();

      await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      const [, , options, fileOptions] = bot.sendVoice.mock.calls[0];
      expect(fileOptions.filename).toBe('halacha-1.ogg');
      expect(fileOptions.contentType).toBe('audio/ogg');
      expect(options.parse_mode).toBe('Markdown');
    });

    it('uses correct filename based on index', async () => {
      const fetchFn = mockFetchAudioOk();

      await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 1, fetchFn);

      const [, , , fileOptions] = bot.sendVoice.mock.calls[0];
      expect(fileOptions.filename).toBe('halacha-2.ogg');
    });
  });

  describe('Strategy 2: text-only fallback', () => {
    it('sends text when no audioUrl exists', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, 123, HALACHA_NO_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(false);
      expect(bot.sendVoice).not.toHaveBeenCalled();
      expect(bot.sendAudio).not.toHaveBeenCalled();
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);

      const msgText = bot.sendMessage.mock.calls[0][1];
      expect(msgText).toContain('הקלטה לא זמינה');
    });

    it('sends text when voice upload fails', async () => {
      const fetchFn = mockFetchFail(500);

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(false);
      expect(bot.sendAudio).not.toHaveBeenCalled();
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);

      const msgText = bot.sendMessage.mock.calls[0][1];
      expect(msgText).toContain('הקלטה לא זמינה');
    });

    it('sends text when sendVoice to Telegram fails', async () => {
      const fetchFn = mockFetchAudioOk();
      bot.sendVoice.mockRejectedValueOnce(new Error('upload failed'));

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(false);
      expect(bot.sendAudio).not.toHaveBeenCalled();
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('includes caption in text fallback', async () => {
      const result = await sendHalacha(bot, 123, HALACHA_NO_AUDIO, 0, mockFetchAudioOk());

      const msgText = bot.sendMessage.mock.calls[0][1];
      expect(msgText).toContain('הלכה א');
      expect(msgText).toContain(HALACHA_NO_AUDIO.title.replace(/([_*`\[])/g, '\\$1'));
    });

    it('text fallback disables web preview', async () => {
      await sendHalacha(bot, 123, HALACHA_NO_AUDIO, 0, mockFetchAudioOk());

      const opts = bot.sendMessage.mock.calls[0][2];
      expect(opts.disable_web_page_preview).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty audioUrl string as no audio', async () => {
      const halacha = { ...HALACHA_WITH_AUDIO, audioUrl: '' };

      const result = await sendHalacha(bot, 123, halacha, 0, mockFetchAudioOk());

      expect(result.audio).toBe(false);
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('works with negative chat IDs (group chats)', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, -100123456, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendVoice.mock.calls[0][0]).toBe(-100123456);
    });

    it('works with string chat IDs (channels)', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, '@mychannel', HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendVoice.mock.calls[0][0]).toBe('@mychannel');
    });
  });
});

// ---------------------------------------------------------------------------
// sendDailyContent
// ---------------------------------------------------------------------------

describe('sendDailyContent()', () => {
  let bot;

  beforeEach(() => {
    bot = createMockBot();
  });

  it('sends all halachot and counts audio deliveries', async () => {
    const fetchFn = mockFetchAudioOk();
    const halachot = [HALACHA_WITH_AUDIO, { ...HALACHA_WITH_AUDIO, audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-13.mp3' }];

    const result = await sendDailyContent(bot, 123, halachot, fetchFn);

    expect(result.audioCount).toBe(2);
    expect(result.textCount).toBe(0);
    expect(bot.sendVoice).toHaveBeenCalledTimes(2);
  });

  it('counts mixed audio and text correctly', async () => {
    const halachot = [HALACHA_WITH_AUDIO, HALACHA_NO_AUDIO];
    const fetchFn = mockFetchAudioOk();

    const result = await sendDailyContent(bot, 123, halachot, fetchFn);

    expect(result.audioCount).toBe(1);
    expect(result.textCount).toBe(1);
  });

  it('returns all text when audio completely fails', async () => {
    const fetchFn = mockFetchFail(500);
    const halachot = [HALACHA_WITH_AUDIO, HALACHA_WITH_AUDIO];

    const result = await sendDailyContent(bot, 123, halachot, fetchFn);

    expect(result.audioCount).toBe(0);
    expect(result.textCount).toBe(2);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('handles empty halachot array', async () => {
    const result = await sendDailyContent(bot, 123, [], mockFetchAudioOk());

    expect(result.audioCount).toBe(0);
    expect(result.textCount).toBe(0);
  });

  it('propagates sendMessage errors (text fallback failure)', async () => {
    bot.sendVoice.mockRejectedValue(new Error('voice fail'));
    bot.sendMessage.mockRejectedValue(new Error('blocked by user'));
    const fetchFn = mockFetchFail(500);

    await expect(
      sendDailyContent(bot, 123, [HALACHA_WITH_AUDIO], fetchFn),
    ).rejects.toThrow('blocked by user');
  });
});
