/**
 * Sender tests — downloadAudio, sendHalacha, sendDailyContent
 *
 * Validates the three-strategy audio fallback chain:
 *   1. Download audio as buffer → upload to Telegram
 *   2. Pass URL to Telegram (Telegram fetches)
 *   3. Text-only fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadAudio, sendHalacha, sendDailyContent } from '../../src/sender.js';

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

  describe('Strategy 1: buffer upload (download + upload)', () => {
    it('downloads audio and uploads buffer to Telegram', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendAudio).toHaveBeenCalledTimes(1);
      expect(bot.sendMessage).not.toHaveBeenCalled();

      // Verify buffer was passed (not URL string)
      const audioArg = bot.sendAudio.mock.calls[0][1];
      expect(Buffer.isBuffer(audioArg)).toBe(true);
    });

    it('passes correct file options for buffer upload', async () => {
      const fetchFn = mockFetchAudioOk();

      await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      const [, , options, fileOptions] = bot.sendAudio.mock.calls[0];
      expect(fileOptions.filename).toBe('halacha-1.mp3');
      expect(fileOptions.contentType).toBe('audio/mpeg');
      expect(options.parse_mode).toBe('Markdown');
      expect(options.performer).toBe('פניני הלכה');
    });

    it('uses correct filename based on index', async () => {
      const fetchFn = mockFetchAudioOk();

      await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 1, fetchFn);

      const [, , , fileOptions] = bot.sendAudio.mock.calls[0];
      expect(fileOptions.filename).toBe('halacha-2.mp3');
    });
  });

  describe('Strategy 2: URL passthrough (fallback)', () => {
    it('falls back to URL when download fails', async () => {
      const fetchFn = mockFetchFail(404);

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendAudio).toHaveBeenCalledTimes(1);
      expect(bot.sendMessage).not.toHaveBeenCalled();

      // Verify URL string was passed (not buffer)
      const audioArg = bot.sendAudio.mock.calls[0][1];
      expect(typeof audioArg).toBe('string');
      expect(audioArg).toBe(HALACHA_WITH_AUDIO.audioUrl);
    });

    it('falls back to URL when buffer upload to Telegram fails', async () => {
      const fetchFn = mockFetchAudioOk();
      // First sendAudio (buffer) fails, second (URL) succeeds
      bot.sendAudio
        .mockRejectedValueOnce(new Error('upload failed'))
        .mockResolvedValueOnce({ message_id: 1 });

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendAudio).toHaveBeenCalledTimes(2);

      // Second call should use URL string
      const secondAudioArg = bot.sendAudio.mock.calls[1][1];
      expect(typeof secondAudioArg).toBe('string');
    });
  });

  describe('Strategy 3: text-only fallback', () => {
    it('sends text when no audioUrl exists', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, 123, HALACHA_NO_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(false);
      expect(bot.sendAudio).not.toHaveBeenCalled();
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);

      const msgText = bot.sendMessage.mock.calls[0][1];
      expect(msgText).toContain('הקלטה לא זמינה');
    });

    it('sends text when both download and URL passthrough fail', async () => {
      const fetchFn = mockFetchFail(500);
      bot.sendAudio.mockRejectedValue(new Error('Telegram rejected URL'));

      const result = await sendHalacha(bot, 123, HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(false);
      expect(bot.sendMessage).toHaveBeenCalledTimes(1);

      const msgText = bot.sendMessage.mock.calls[0][1];
      expect(msgText).toContain('הקלטה לא זמינה');
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
      expect(bot.sendAudio.mock.calls[0][0]).toBe(-100123456);
    });

    it('works with string chat IDs (channels)', async () => {
      const fetchFn = mockFetchAudioOk();

      const result = await sendHalacha(bot, '@mychannel', HALACHA_WITH_AUDIO, 0, fetchFn);

      expect(result.audio).toBe(true);
      expect(bot.sendAudio.mock.calls[0][0]).toBe('@mychannel');
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
    expect(bot.sendAudio).toHaveBeenCalledTimes(2);
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
    bot.sendAudio.mockRejectedValue(new Error('nope'));
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
    bot.sendAudio.mockRejectedValue(new Error('audio fail'));
    bot.sendMessage.mockRejectedValue(new Error('blocked by user'));
    const fetchFn = mockFetchFail(500);

    await expect(
      sendDailyContent(bot, 123, [HALACHA_WITH_AUDIO], fetchFn),
    ).rejects.toThrow('blocked by user');
  });
});
