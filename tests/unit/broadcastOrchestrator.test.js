/**
 * Broadcast Orchestrator Tests
 *
 * Tests the delivery pipeline: admin → channel → subscribers,
 * including deduplication, error handling, and summary generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBroadcastDelivery } from '../../src/broadcastOrchestrator.js';

// Mock the OGG converter so ffmpeg is not required
vi.mock('../../src/audioSpeed.js', () => ({
  convertToOgg: vi.fn(async (buf) => Buffer.alloc(buf.length, 0xaa)),
}));

// --- Helpers ---

function fakeMp3(size = 5000) {
  return Buffer.alloc(size, 0xff);
}

function createBot() {
  return {
    sendVoice: vi.fn(async () => ({ message_id: 1 })),
    sendAudio: vi.fn(async () => ({ message_id: 1 })),
    sendMessage: vi.fn(async () => ({ message_id: 2 })),
  };
}

function mockFetchAudioOk() {
  const buf = fakeMp3();
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }));
}

const noSleep = () => Promise.resolve();

const HALACHOT = [
  {
    url: 'https://ph.yhb.org.il/20-26-12/',
    title: 'הלכה א',
    audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
  },
  {
    url: 'https://ph.yhb.org.il/20-26-13/',
    title: 'הלכה ב',
    audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-13.mp3',
  },
];

// ---------------------------------------------------------------------------
// Admin delivery
// ---------------------------------------------------------------------------

describe('Admin delivery', () => {
  it('sends halachot to admin when configured', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats, anySuccess } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.admin).toBe(true);
    expect(stats.adminAudio).toBe(2);
    expect(anySuccess).toBe(true);
    // 2 sendVoice calls (one per halacha)
    expect(bot.sendVoice).toHaveBeenCalledTimes(2);
    expect(bot.sendVoice.mock.calls[0][0]).toBe(12345);
    expect(bot.sendVoice.mock.calls[1][0]).toBe(12345);
  });

  it('handles admin delivery failure gracefully', async () => {
    const bot = createBot();
    bot.sendVoice.mockRejectedValue(new Error('bot blocked'));
    bot.sendAudio.mockRejectedValue(new Error('bot blocked'));
    bot.sendMessage.mockRejectedValue(new Error('bot blocked'));

    const { stats, anySuccess } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn: mockFetchAudioOk(),
      adminChatId: 12345,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.admin).toBe(false);
    expect(anySuccess).toBe(false);
  });

  it('skips admin delivery when not configured', async () => {
    const bot = createBot();

    const { stats } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn: mockFetchAudioOk(),
      adminChatId: null,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.admin).toBe(false);
    expect(bot.sendVoice).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Channel delivery
// ---------------------------------------------------------------------------

describe('Channel delivery', () => {
  it('sends to channel when configured and different from admin', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: '@mychannel',
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.admin).toBe(true);
    expect(stats.channel).toBe(true);
    // 2 for admin + 2 for channel = 4 sendVoice calls
    expect(bot.sendVoice).toHaveBeenCalledTimes(4);
  });

  it('skips duplicate when channel ID equals admin chat ID', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats, delivered } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: '12345',  // Same as admin (as string)
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.admin).toBe(true);
    expect(stats.channel).toBe(true);
    // Only 2 sendVoice calls (admin), channel deduped
    expect(bot.sendVoice).toHaveBeenCalledTimes(2);
    expect(delivered.size).toBe(1);
  });

  it('reports channel as not configured when null', async () => {
    const bot = createBot();

    const { summary } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn: mockFetchAudioOk(),
      adminChatId: 12345,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(summary).toContain('Channel: not configured');
  });
});

// ---------------------------------------------------------------------------
// Subscriber delivery
// ---------------------------------------------------------------------------

describe('Subscriber delivery', () => {
  it('sends to subscribers', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,
      subscribers: [111, 222, 333],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.subscribers.sent).toBe(3);
    // 2 admin + 2*3 subscribers = 8
    expect(bot.sendVoice).toHaveBeenCalledTimes(8);
  });

  it('skips subscriber that matches admin chat ID', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats, delivered } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,
      subscribers: [12345, 222],  // Admin is also a subscriber
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    // Admin already delivered, subscriber 12345 skipped but counted
    expect(stats.subscribers.sent).toBe(2);  // Both counted as sent
    // 2 admin + 2 for subscriber 222 = 4 (not 6)
    expect(bot.sendVoice).toHaveBeenCalledTimes(4);
    expect(delivered.size).toBe(2);  // admin + subscriber 222
  });

  it('removes blocked subscriber (403)', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();
    const removeSub = vi.fn();

    // First 2 calls succeed (admin), next 2 fail with 403
    let callCount = 0;
    bot.sendVoice.mockImplementation(async (chatId) => {
      callCount++;
      if (chatId === 999) {
        throw { response: { body: { error_code: 403 } } };
      }
      return { message_id: callCount };
    });
    // Text fallback also fails for blocked user
    bot.sendMessage.mockImplementation(async (chatId) => {
      if (chatId === 999) {
        throw { response: { body: { error_code: 403 } } };
      }
      return { message_id: 1 };
    });

    const { stats } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,
      subscribers: [999],
      removeSubscriber: removeSub,
      sleep: noSleep,
    });

    expect(stats.subscribers.removed).toBe(1);
    expect(removeSub).toHaveBeenCalledWith(999);
  });

  it('handles rate limiting (429)', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();
    const sleepFn = vi.fn(async () => {});

    let callCount = 0;
    bot.sendVoice.mockImplementation(async (chatId) => {
      callCount++;
      if (chatId === 777) {
        throw { response: { body: { error_code: 429, parameters: { retry_after: 5 } } } };
      }
      return { message_id: callCount };
    });
    bot.sendMessage.mockImplementation(async (chatId) => {
      if (chatId === 777) {
        throw { response: { body: { error_code: 429, parameters: { retry_after: 5 } } } };
      }
      return { message_id: 1 };
    });

    const { stats } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,
      subscribers: [777],
      removeSubscriber: vi.fn(),
      sleep: sleepFn,
    });

    expect(stats.subscribers.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Deduplication across all targets
// ---------------------------------------------------------------------------

describe('Deduplication', () => {
  it('admin = channel = subscriber: sends only once', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats, delivered } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: '12345',
      subscribers: [12345],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(stats.admin).toBe(true);
    expect(stats.channel).toBe(true);
    expect(stats.subscribers.sent).toBe(1);
    // Only 2 sendVoice calls total (one per halacha, to admin only)
    expect(bot.sendVoice).toHaveBeenCalledTimes(2);
    expect(delivered.size).toBe(1);
  });

  it('no dedup when all targets are different', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { delivered } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 111,
      channelId: '@chan',
      subscribers: [222, 333],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    // admin + channel + 2 subscribers = 4 unique recipients
    expect(delivered.size).toBe(4);
    // 4 recipients * 2 halachot = 8 sendVoice calls
    expect(bot.sendVoice).toHaveBeenCalledTimes(8);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('Summary', () => {
  it('includes admin sent status', async () => {
    const bot = createBot();

    const { summary } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn: mockFetchAudioOk(),
      adminChatId: 12345,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(summary).toContain('Admin: sent');
    expect(summary).toContain('🔊 2/2 audio');
    expect(summary).toContain('Total: 1 recipients');
  });

  it('shows admin not configured when no admin', async () => {
    const bot = createBot();

    const { summary } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn: mockFetchAudioOk(),
      adminChatId: null,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(summary).toContain('Admin: not configured');
  });

  it('shows correct subscriber counts with failures', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    let callCount = 0;
    bot.sendVoice.mockImplementation(async (chatId) => {
      callCount++;
      if (chatId === 222) throw new Error('random failure');
      return { message_id: callCount };
    });
    bot.sendMessage.mockImplementation(async (chatId) => {
      if (chatId === 222) throw new Error('random failure');
      return { message_id: 1 };
    });

    const { summary } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,
      subscribers: [111, 222, 333],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(summary).toContain('Subscribers: 2/3 sent');
    expect(summary).toContain('1 failed');
  });

  it('includes halacha titles', async () => {
    const bot = createBot();

    const { summary } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn: mockFetchAudioOk(),
      adminChatId: 12345,
      channelId: null,
      subscribers: [],
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    expect(summary).toContain('הלכה א');
    expect(summary).toContain('הלכה ב');
  });
});

// ---------------------------------------------------------------------------
// Real-world scenario: admin-only (the exact failure case from production)
// ---------------------------------------------------------------------------

describe('Production scenario: admin-only, no channel, no subscribers', () => {
  it('delivers halachot to admin and reports success', async () => {
    const bot = createBot();
    const fetchFn = mockFetchAudioOk();

    const { stats, summary, anySuccess, delivered } = await runBroadcastDelivery({
      bot,
      halachot: HALACHOT,
      fetchFn,
      adminChatId: 12345,
      channelId: null,       // Not configured
      subscribers: [],        // Empty
      removeSubscriber: vi.fn(),
      sleep: noSleep,
    });

    // Admin got the halachot
    expect(stats.admin).toBe(true);
    expect(stats.adminAudio).toBe(2);
    expect(anySuccess).toBe(true);

    // Content was actually sent
    expect(bot.sendVoice).toHaveBeenCalledTimes(2);
    expect(delivered.size).toBe(1);

    // Summary reflects delivery
    expect(summary).toContain('Admin: sent');
    expect(summary).not.toContain('skipped');
    expect(summary).toContain('1 recipients');
    expect(summary).toContain('2 audio messages');
  });
});
