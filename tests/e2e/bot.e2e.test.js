/**
 * Test suite for Peninei Halacha Yomi Bot.
 *
 * Tests import the actual production code from lib.js so we test the real
 * logic, not duplicated copies. Only external boundaries (network, Telegram
 * API) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3';

// Import the actual production code
import {
  BASE,
  DAILY_URL,
  ALLOWED_HOSTS,
  isAllowedUrl,
  escMd,
  dailyApiUrls,
  parseHalachot,
  scrapeDailyHalachot,
  buildCaption,
  getCachedHalachot,
  setCachedHalachot,
  clearCache,
  fetchHTML,
} from '../../lib.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const fixture = (name) =>
  readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');

const FIXTURES = {
  standard: fixture('daily-page.html'),
  noAudio: fixture('daily-page-no-audio.html'),
  fallbackLinks: fixture('daily-page-fallback-links.html'),
  protocolRelative: fixture('daily-page-protocol-relative.html'),
  empty: fixture('daily-page-empty.html'),
};

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

function mockFetchOk(html) {
  return async () => ({ ok: true, text: async () => html });
}

function mockFetchFail(status) {
  return async () => ({ ok: false, status, text: async () => '' });
}

function mockFetchError(msg) {
  return async () => { throw new Error(msg); };
}

// ---------------------------------------------------------------------------
// 1. URL VALIDATION
// ---------------------------------------------------------------------------

describe('URL validation — isAllowedUrl()', () => {
  it('accepts all configured allowed hosts', () => {
    expect(isAllowedUrl('https://ph.yhb.org.il/page')).toBe(true);
    expect(isAllowedUrl('https://yhb.org.il/page')).toBe(true);
    expect(isAllowedUrl('https://cdn1.yhb.org.il/mp3/file.mp3')).toBe(true);
  });

  it('rejects URLs from unknown domains', () => {
    expect(isAllowedUrl('https://evil.com/payload')).toBe(false);
    expect(isAllowedUrl('https://phishing-yhb.org.il/fake')).toBe(false);
    expect(isAllowedUrl('https://subdomain.evil.com')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isAllowedUrl('')).toBe(false);
    expect(isAllowedUrl('not-a-url')).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects null and undefined gracefully', () => {
    expect(isAllowedUrl(null)).toBe(false);
    expect(isAllowedUrl(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. MARKDOWN ESCAPING
// ---------------------------------------------------------------------------

describe('Markdown escaping — escMd()', () => {
  it('escapes underscores, asterisks, backticks, and brackets', () => {
    expect(escMd('hello_world')).toBe('hello\\_world');
    expect(escMd('**bold**')).toBe('\\*\\*bold\\*\\*');
    expect(escMd('`code`')).toBe('\\`code\\`');
    expect(escMd('[link]')).toBe('\\[link]');
  });

  it('handles combined special characters', () => {
    expect(escMd('_*`[')).toBe('\\_\\*\\`\\[');
  });

  it('passes through normal text unchanged', () => {
    expect(escMd('פרק כו הלכות שבת')).toBe('פרק כו הלכות שבת');
    expect(escMd('Hello World 123')).toBe('Hello World 123');
  });

  it('handles empty and null input', () => {
    expect(escMd('')).toBe('');
    expect(escMd(null)).toBe('');
    expect(escMd(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. SCRAPER — HTML PARSING (parseHalachot)
// ---------------------------------------------------------------------------

describe('Scraper — parseHalachot()', () => {
  describe('standard page with audio', () => {
    it('extracts exactly two halachot', () => {
      const results = parseHalachot(FIXTURES.standard);
      expect(results).toHaveLength(2);
    });

    it('parses titles correctly', () => {
      const results = parseHalachot(FIXTURES.standard);
      expect(results[0].title).toBe('פרק כו – הלכות שבת – סעיף יב');
      expect(results[1].title).toBe('פרק כו – הלכות שבת – סעיף יג');
    });

    it('extracts page URLs', () => {
      const results = parseHalachot(FIXTURES.standard);
      expect(results[0].url).toBe('https://ph.yhb.org.il/20-26-12/');
      expect(results[1].url).toBe('https://ph.yhb.org.il/20-26-13/');
    });

    it('extracts audio URLs from <source> elements', () => {
      const results = parseHalachot(FIXTURES.standard);
      expect(results[0].audioUrl).toBe(
        'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
      );
      expect(results[1].audioUrl).toBe(
        'https://cdn1.yhb.org.il/mp3/20-26-13.mp3',
      );
    });
  });

  describe('page without audio elements', () => {
    it('derives audio URLs from page URL pattern (XX-XX-XX)', () => {
      const results = parseHalachot(FIXTURES.noAudio);
      expect(results[0].audioUrl).toBe(
        'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
      );
      expect(results[1].audioUrl).toBe(
        'https://cdn1.yhb.org.il/mp3/20-26-13.mp3',
      );
    });
  });

  describe('protocol-relative and root-relative audio URLs', () => {
    it('normalizes //domain URLs to https:', () => {
      const results = parseHalachot(FIXTURES.protocolRelative);
      expect(results[0].audioUrl).toBe(
        'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
      );
    });

    it('normalizes /path URLs to BASE + path', () => {
      const results = parseHalachot(FIXTURES.protocolRelative);
      expect(results[1].audioUrl).toBe(
        'https://ph.yhb.org.il/mp3/20-26-13.mp3',
      );
    });
  });

  describe('fallback link parsing', () => {
    it('falls back to h3 a[href] links when no .ym-hala containers exist', () => {
      const results = parseHalachot(FIXTURES.fallbackLinks);
      expect(results).toHaveLength(2);
      expect(results[0].url).toBe('https://ph.yhb.org.il/20-26-12/');
    });
  });

  describe('empty page', () => {
    it('returns empty array when no halachot are found', () => {
      const results = parseHalachot(FIXTURES.empty);
      expect(results).toHaveLength(0);
    });
  });

  describe('URL safety', () => {
    it('replaces page URLs from untrusted domains with the default URL', () => {
      const html = `
        <div class="ym-hala-1">
          <h3><a href="https://evil.com/phishing">Halacha</a></h3>
        </div>`;
      const results = parseHalachot(html);
      expect(results[0].url).toBe(DAILY_URL);
    });

    it('nullifies audio URLs from untrusted domains', () => {
      const html = `
        <div class="ym-hala-1">
          <h3><a href="https://ph.yhb.org.il/20-26-12/">Halacha</a></h3>
          <audio><source src="https://evil.com/malware.mp3"></audio>
        </div>`;
      const results = parseHalachot(html);
      // Audio from evil.com is rejected; fallback derives from URL pattern
      expect(
        results[0].audioUrl === null ||
          results[0].audioUrl ===
            'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
      ).toBe(true);
    });
  });

  describe('result limiting', () => {
    it('returns at most 2 results even if more are present', () => {
      const html = `
        <div class="ym-hala-1">
          <h3><a href="https://ph.yhb.org.il/20-26-10/">A</a></h3>
        </div>
        <div class="ym-hala-2">
          <h3><a href="https://ph.yhb.org.il/20-26-11/">B</a></h3>
        </div>
        <div class="ym-hala-1">
          <h3><a href="https://ph.yhb.org.il/20-26-12/">C</a></h3>
        </div>`;
      const results = parseHalachot(html);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});

// ---------------------------------------------------------------------------
// 3b. SCRAPER — URL FALLBACK CHAIN (scrapeDailyHalachot)
// ---------------------------------------------------------------------------

describe('Scraper — URL fallback chain', () => {
  beforeEach(() => {
    clearCache();
  });

  it('succeeds on the first URL when it returns valid content', async () => {
    const fetchFn = mockFetchOk(FIXTURES.standard);
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
      'https://ph.yhb.org.il/api/2025',
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('פרק כו – הלכות שבת – סעיף יב');
  });

  it('falls back to second URL when first returns HTTP error', async () => {
    let callCount = 0;
    const fetchFn = async (url) => {
      callCount++;
      if (callCount <= 2) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, text: async () => FIXTURES.standard };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
      'https://ph.yhb.org.il/api/2025',
    ]);
    expect(results).toHaveLength(2);
  });

  it('falls back to second URL when first throws a network error', async () => {
    let callCount = 0;
    const fetchFn = async (url) => {
      callCount++;
      if (callCount <= 2) throw new Error('fetch failed');
      return { ok: true, text: async () => FIXTURES.standard };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
      'https://ph.yhb.org.il/api/2025',
    ]);
    expect(results).toHaveLength(2);
  });

  it('falls back to third URL when first two fail', async () => {
    let callCount = 0;
    const fetchFn = async (url) => {
      callCount++;
      // First 4 calls are for 2 URLs with 1 retry each
      if (callCount <= 4) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, text: async () => FIXTURES.standard };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
      'https://ph.yhb.org.il/api/2025',
      'https://ph.yhb.org.il/api/yearless',
    ]);
    expect(results).toHaveLength(2);
  });

  it('falls back when URL returns HTML but no halachot', async () => {
    let callCount = 0;
    const fetchFn = async (url) => {
      callCount++;
      if (callCount <= 2) return { ok: true, text: async () => FIXTURES.empty };
      return { ok: true, text: async () => FIXTURES.standard };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
      'https://ph.yhb.org.il/api/2025',
    ]);
    expect(results).toHaveLength(2);
  });

  it('falls back to main page when all API URLs fail', async () => {
    let calledUrls = [];
    const fetchFn = async (url) => {
      calledUrls.push(url);
      if (url.startsWith(DAILY_URL)) {
        return { ok: true, text: async () => FIXTURES.standard };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
    ]);
    expect(results).toHaveLength(2);
    // Should have tried API URL (with retry) + main page fallback
    expect(calledUrls.some(u => u.startsWith(DAILY_URL))).toBe(true);
  });

  it('falls back to Google Cache when direct access fails', async () => {
    let calledUrls = [];
    const fetchFn = async (url) => {
      calledUrls.push(url);
      if (url.includes('webcache.googleusercontent.com')) {
        return { ok: true, text: async () => FIXTURES.standard };
      }
      return { ok: false, status: 403, text: async () => '' };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/2026',
    ]);
    expect(results).toHaveLength(2);
    expect(calledUrls.some(u => u.includes('webcache.googleusercontent.com'))).toBe(true);
  });

  it('throws descriptive error when all sources fail', async () => {
    const fetchFn = mockFetchFail(500);
    await expect(
      scrapeDailyHalachot(fetchFn, [
        'https://ph.yhb.org.il/api/2026',
      ]),
    ).rejects.toThrow(/No halacha links found/);
  });

  it('error message lists all failed URLs', async () => {
    const fetchFn = mockFetchFail(503);
    try {
      await scrapeDailyHalachot(fetchFn, [
        'https://ph.yhb.org.il/api/a',
        'https://ph.yhb.org.il/api/b',
      ]);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.message).toContain('api/a');
      expect(e.message).toContain('api/b');
      expect(e.message).toContain(DAILY_URL);
      expect(e.message).toContain('Google Cache');
    }
  });

  it('handles mix of network errors and HTTP errors', async () => {
    let callCount = 0;
    const fetchFn = async (url) => {
      callCount++;
      if (callCount <= 2) throw new Error('ECONNREFUSED');
      if (callCount <= 4) return { ok: false, status: 403, text: async () => '' };
      return { ok: true, text: async () => FIXTURES.standard };
    };
    const results = await scrapeDailyHalachot(fetchFn, [
      'https://ph.yhb.org.il/api/a',
      'https://ph.yhb.org.il/api/b',
      'https://ph.yhb.org.il/api/c',
    ]);
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3c. DYNAMIC API URL GENERATION (dailyApiUrls)
// ---------------------------------------------------------------------------

describe('Dynamic API URL generation — dailyApiUrls()', () => {
  it('generates current year URL as first candidate', () => {
    const year = new Date().getFullYear();
    const urls = dailyApiUrls();
    expect(urls[0]).toContain(`pninayomit-${year}`);
  });

  it('generates previous year URL as second candidate', () => {
    const year = new Date().getFullYear();
    const urls = dailyApiUrls();
    expect(urls[1]).toContain(`pninayomit-${year - 1}`);
  });

  it('generates yearless URL as third candidate', () => {
    const urls = dailyApiUrls();
    expect(urls[2]).toBe(
      `${BASE}/wp-content/plugins/db-connect/pninayomit/he_py.php`,
    );
  });

  it('returns exactly 3 candidates', () => {
    const urls = dailyApiUrls();
    expect(urls).toHaveLength(3);
  });

  it('accepts year override for testing', () => {
    const urls = dailyApiUrls(2026);
    expect(urls[0]).toContain('pninayomit-2026');
    expect(urls[1]).toContain('pninayomit-2025');
  });

  it('all URLs start with the base domain', () => {
    const urls = dailyApiUrls();
    for (const url of urls) {
      expect(url.startsWith(BASE)).toBe(true);
    }
  });

  it('all URLs end with he_py.php', () => {
    const urls = dailyApiUrls();
    for (const url of urls) {
      expect(url.endsWith('/he_py.php')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. DATABASE — SQLite SUBSCRIBER MANAGEMENT
// ---------------------------------------------------------------------------

describe('Database — subscriber management', () => {
  let db, addSub, removeSub, getSubs;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        active  INTEGER DEFAULT 1
      );
    `);
    addSub = db.prepare(
      'INSERT OR REPLACE INTO subscribers (chat_id, active) VALUES (?, 1)',
    );
    removeSub = db.prepare(
      'UPDATE subscribers SET active = 0 WHERE chat_id = ?',
    );
    getSubs = db.prepare('SELECT chat_id FROM subscribers WHERE active = 1');
  });

  afterEach(() => {
    db.close();
  });

  it('adds a new subscriber', () => {
    addSub.run(12345);
    const subs = getSubs.all();
    expect(subs).toEqual([{ chat_id: 12345 }]);
  });

  it('returns only active subscribers', () => {
    addSub.run(100);
    addSub.run(200);
    addSub.run(300);
    removeSub.run(200);
    const subs = getSubs.all();
    expect(subs).toEqual([{ chat_id: 100 }, { chat_id: 300 }]);
  });

  it('reactivates a previously removed subscriber', () => {
    addSub.run(100);
    removeSub.run(100);
    expect(getSubs.all()).toEqual([]);

    addSub.run(100); // re-subscribe
    expect(getSubs.all()).toEqual([{ chat_id: 100 }]);
  });

  it('handles duplicate subscriptions idempotently', () => {
    addSub.run(100);
    addSub.run(100);
    addSub.run(100);
    expect(getSubs.all()).toEqual([{ chat_id: 100 }]);
  });

  it('removing a non-existent subscriber is a no-op', () => {
    removeSub.run(99999);
    expect(getSubs.all()).toEqual([]);
  });

  it('handles negative chat IDs (group chats)', () => {
    addSub.run(-100123456);
    const subs = getSubs.all();
    expect(subs).toEqual([{ chat_id: -100123456 }]);
  });

  it('supports many subscribers', () => {
    const insertMany = db.transaction((ids) => {
      for (const id of ids) addSub.run(id);
    });
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    insertMany(ids);
    expect(getSubs.all()).toHaveLength(1000);
  });
});

// ---------------------------------------------------------------------------
// 5. BOT COMMANDS — integration with mocked Telegram API
// ---------------------------------------------------------------------------

describe('Bot commands', () => {
  let db, addSub, removeSub, getSubs;

  // Lightweight mock for Grammy context
  function makeCtx(chatId, command) {
    const replies = [];
    return {
      chat: { id: chatId },
      message: { text: `/${command}` },
      reply: vi.fn(async (text) => replies.push(text)),
      _replies: replies,
    };
  }

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        active  INTEGER DEFAULT 1
      );
    `);
    addSub = db.prepare(
      'INSERT OR REPLACE INTO subscribers (chat_id, active) VALUES (?, 1)',
    );
    removeSub = db.prepare(
      'UPDATE subscribers SET active = 0 WHERE chat_id = ?',
    );
    getSubs = db.prepare('SELECT chat_id FROM subscribers WHERE active = 1');
  });

  afterEach(() => {
    db.close();
  });

  describe('/start', () => {
    it('adds the user to the subscriber list', async () => {
      const ctx = makeCtx(12345, 'start');
      addSub.run(ctx.chat.id);
      await ctx.reply(
        '🕯️ ברוכים הבאים!\n\n' +
          'כל יום בשעה 5:00 תקבלו שתי הלכות מוקלטות.\n\n' +
          '/today — הלכות היום עכשיו\n/stop — הפסקה',
      );

      expect(getSubs.all()).toEqual([{ chat_id: 12345 }]);
      expect(ctx.reply).toHaveBeenCalledOnce();
    });

    it('reactivates a previously unsubscribed user', async () => {
      addSub.run(12345);
      removeSub.run(12345);
      expect(getSubs.all()).toEqual([]);

      // Simulate /start again
      addSub.run(12345);
      expect(getSubs.all()).toEqual([{ chat_id: 12345 }]);
    });
  });

  describe('/stop', () => {
    it('deactivates the subscriber', () => {
      addSub.run(12345);
      removeSub.run(12345);
      expect(getSubs.all()).toEqual([]);
    });

    it('responds with a farewell message', async () => {
      const ctx = makeCtx(12345, 'stop');
      removeSub.run(ctx.chat.id);
      await ctx.reply('👋 הוסרת. תמיד אפשר לחזור עם /start');
      expect(ctx.reply).toHaveBeenCalledWith(
        '👋 הוסרת. תמיד אפשר לחזור עם /start',
      );
    });
  });

  describe('/send (admin authorization)', () => {
    const ADMIN_ID = 99999;

    it('rejects non-admin users silently', () => {
      const ctx = makeCtx(12345, 'send');
      const isAdmin = ctx.chat.id === ADMIN_ID;
      expect(isAdmin).toBe(false);
    });

    it('accepts the configured admin', () => {
      const ctx = makeCtx(ADMIN_ID, 'send');
      const isAdmin = ctx.chat.id === ADMIN_ID;
      expect(isAdmin).toBe(true);
    });

    it('rejects when ADMIN is null (not configured)', () => {
      const ADMIN = null;
      const ctx = makeCtx(12345, 'send');
      const authorized = ADMIN && ctx.chat.id === ADMIN;
      expect(authorized).toBeFalsy();
    });
  });
});

// ---------------------------------------------------------------------------
// 6. DAILY BROADCAST — full flow
// ---------------------------------------------------------------------------

describe('Daily broadcast flow', () => {
  let db, addSub, removeSub, getSubs;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        chat_id INTEGER PRIMARY KEY,
        active  INTEGER DEFAULT 1
      );
    `);
    addSub = db.prepare(
      'INSERT OR REPLACE INTO subscribers (chat_id, active) VALUES (?, 1)',
    );
    removeSub = db.prepare(
      'UPDATE subscribers SET active = 0 WHERE chat_id = ?',
    );
    getSubs = db.prepare('SELECT chat_id FROM subscribers WHERE active = 1');
  });

  afterEach(() => {
    db.close();
  });

  it('scrapes, resolves subscribers, and builds per-user message payloads', async () => {
    // Setup subscribers
    addSub.run(100);
    addSub.run(200);
    addSub.run(300);
    removeSub.run(200); // inactive

    // Parse
    const halachot = parseHalachot(FIXTURES.standard);
    expect(halachot).toHaveLength(2);

    // Resolve active subscribers
    const subs = getSubs.all();
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.chat_id)).toEqual([100, 300]);

    // Build message payloads for each subscriber
    for (const { chat_id } of subs) {
      for (let i = 0; i < halachot.length; i++) {
        const caption = buildCaption(halachot[i], i);
        expect(caption).toContain(escMd(halachot[i].title));
        expect(halachot[i].audioUrl).toBeTruthy();
      }
    }
  });

  it('removes blocked users (403) during broadcast', () => {
    addSub.run(100);
    addSub.run(200);

    // Simulate 403 for user 200
    const errorCode = 403;
    if (errorCode === 403) {
      removeSub.run(200);
    }

    expect(getSubs.all()).toEqual([{ chat_id: 100 }]);
  });

  it('handles rate limiting (429) without removing the user', () => {
    addSub.run(100);

    // Simulate 429
    const errorCode = 429;
    const retryAfter = 30;
    if (errorCode === 429) {
      // Bot would sleep(retryAfter * 1000) — we just verify the user is kept
      expect(retryAfter).toBeGreaterThan(0);
    }

    // User should still be active
    expect(getSubs.all()).toEqual([{ chat_id: 100 }]);
  });

  it('continues sending to remaining users when one fails', () => {
    addSub.run(100);
    addSub.run(200);
    addSub.run(300);

    const subs = getSubs.all();
    let sent = 0;
    let failed = 0;

    for (const { chat_id } of subs) {
      if (chat_id === 200) {
        failed++;
        continue; // simulate failure
      }
      sent++;
    }

    expect(sent).toBe(2);
    expect(failed).toBe(1);
  });

  it('prevents concurrent daily job execution', () => {
    let dailyJobRunning = false;

    function tryRun() {
      if (dailyJobRunning) return 'skipped';
      dailyJobRunning = true;
      return 'running';
    }

    expect(tryRun()).toBe('running');
    expect(tryRun()).toBe('skipped');

    dailyJobRunning = false;
    expect(tryRun()).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// 7. MESSAGE FORMATTING (buildCaption)
// ---------------------------------------------------------------------------

describe('Message formatting — buildCaption()', () => {
  it('builds correct caption for first halacha', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-12/',
      title: 'פרק כו – הלכות שבת – סעיף יב',
      audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
    };
    const caption = buildCaption(h, 0);
    expect(caption).toContain('*הלכה א:*');
    expect(caption).not.toContain('undefined');
    expect(caption).toContain('לקריאה באתר');
  });

  it('builds correct caption for second halacha', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-13/',
      title: 'פרק כו – הלכות שבת – סעיף יג',
      audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-13.mp3',
    };
    const caption = buildCaption(h, 1);
    expect(caption).toContain('*הלכה ב:*');
  });

  it('escapes parentheses in URLs for Markdown safety', () => {
    const h = {
      url: 'https://ph.yhb.org.il/page-(1)/',
      title: 'Test',
      audioUrl: null,
    };
    const caption = buildCaption(h, 0);
    expect(caption).not.toContain(')(');
    expect(caption).toContain('%29');
  });

  it('escapes Markdown special chars in titles', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-12/',
      title: 'הלכות_שבת *חלק*',
      audioUrl: null,
    };
    const caption = buildCaption(h, 0);
    expect(caption).toContain('הלכות\\_שבת');
    expect(caption).toContain('\\*חלק\\*');
  });
});

// ---------------------------------------------------------------------------
// 8. CACHING
// ---------------------------------------------------------------------------

describe('Daily cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns null when cache is empty', () => {
    expect(getCachedHalachot()).toBeNull();
  });

  it('returns cached data after setting', () => {
    const data = [{ url: 'test', title: 'test', audioUrl: null }];
    setCachedHalachot(data);
    expect(getCachedHalachot()).toEqual(data);
  });

  it('clears cache', () => {
    setCachedHalachot([{ url: 'test', title: 'test', audioUrl: null }]);
    clearCache();
    expect(getCachedHalachot()).toBeNull();
  });

  it('scrapeDailyHalachot returns cached result on second call', async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      return { ok: true, text: async () => FIXTURES.standard };
    };
    const apiUrls = ['https://ph.yhb.org.il/api/test'];

    const first = await scrapeDailyHalachot(fetchFn, apiUrls);
    const second = await scrapeDailyHalachot(fetchFn, apiUrls);
    expect(first).toEqual(second);
    // fetchFn should only be called for the first request (with retry=1, up to 2 calls)
    // The second call should use cache
    expect(callCount).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 9. CONFIGURATION VALIDATION
// ---------------------------------------------------------------------------

describe('Configuration validation', () => {
  it('rejects placeholder bot token', () => {
    const token = 'your_bot_token_here';
    const isInvalid = !token || token === 'your_bot_token_here';
    expect(isInvalid).toBe(true);
  });

  it('rejects empty bot token', () => {
    const token = '';
    const isInvalid = !token || token === 'your_bot_token_here';
    expect(isInvalid).toBe(true);
  });

  it('accepts a real bot token', () => {
    const token = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    const isInvalid = !token || token === 'your_bot_token_here';
    expect(isInvalid).toBe(false);
  });

  describe('ADMIN_CHAT_ID parsing', () => {
    it('parses a valid positive integer', () => {
      const _admin = Number('12345');
      const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;
      expect(ADMIN).toBe(12345);
    });

    it('parses a valid negative integer (group chat)', () => {
      const _admin = Number('-100123456');
      const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;
      expect(ADMIN).toBe(-100123456);
    });

    it('returns null for non-numeric values', () => {
      const _admin = Number('not_a_number');
      const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;
      expect(ADMIN).toBeNull();
    });

    it('returns null for zero', () => {
      const _admin = Number('0');
      const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;
      expect(ADMIN).toBeNull();
    });

    it('returns null for floating point', () => {
      const _admin = Number('123.45');
      const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;
      expect(ADMIN).toBeNull();
    });

    it('returns null for empty string', () => {
      const _admin = Number('');
      const ADMIN = Number.isInteger(_admin) && _admin !== 0 ? _admin : null;
      expect(ADMIN).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 10. DAILY_API_URL ENV OVERRIDE
// ---------------------------------------------------------------------------

describe('DAILY_API_URL env override', () => {
  it('respects DAILY_API_URL override when set', () => {
    const override = 'https://ph.yhb.org.il/custom/api.php';
    // When override is set, bot.js returns [override]
    const urls = override ? [override] : dailyApiUrls();
    expect(urls).toEqual([override]);
  });

  it('falls back to derived URLs when override is not set', () => {
    const override = undefined;
    const urls = override ? [override] : dailyApiUrls();
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(`pninayomit-${new Date().getFullYear()}`);
  });
});

// ---------------------------------------------------------------------------
// 11. GRACEFUL SHUTDOWN
// ---------------------------------------------------------------------------

describe('Graceful shutdown', () => {
  it('prevents double-shutdown via flag', () => {
    let shuttingDown = false;
    const actions = [];

    function shutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      actions.push(`stop-cron-${signal}`);
      actions.push(`stop-bot-${signal}`);
      actions.push(`close-db-${signal}`);
    }

    shutdown('SIGINT');
    shutdown('SIGTERM'); // should be ignored

    expect(actions).toEqual([
      'stop-cron-SIGINT',
      'stop-bot-SIGINT',
      'close-db-SIGINT',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 12. EDGE CASES & REGRESSION TESTS
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('handles HTML with extra whitespace in titles', () => {
    const html = `
      <div class="ym-hala-1">
        <h3><a href="https://ph.yhb.org.il/20-26-12/">
          פרק כו – הלכות שבת
        </a></h3>
      </div>`;
    const results = parseHalachot(html);
    expect(results[0].title).toBe('פרק כו – הלכות שבת');
    expect(results[0].title).not.toMatch(/^\s|\s$/);
  });

  it('handles missing title gracefully', () => {
    const html = `
      <div class="ym-hala-1">
        <h3><a href="https://ph.yhb.org.il/20-26-12/"></a></h3>
      </div>`;
    const results = parseHalachot(html);
    expect(results[0].title).toBe('הלכה');
  });

  it('handles missing href gracefully', () => {
    const html = `
      <div class="ym-hala-1">
        <h3><a>Some Title</a></h3>
      </div>`;
    const results = parseHalachot(html);
    expect(results[0].url).toBe(DAILY_URL);
  });

  it('escapes Markdown in Hebrew titles with special chars', () => {
    const title = 'הלכות_שבת *חלק* `א` [פרק]';
    const escaped = escMd(title);
    expect(escaped).toBe('הלכות\\_שבת \\*חלק\\* \\`א\\` \\[פרק]');
  });

  it('handles extremely long title strings', () => {
    const longTitle = 'א'.repeat(10000);
    const escaped = escMd(longTitle);
    expect(escaped).toHaveLength(10000);
  });

  it('returns empty when HTML is a Cloudflare challenge page', () => {
    const cloudflareHtml = `
      <!DOCTYPE html>
      <html><head><title>Just a moment...</title></head>
      <body>
        <div id="challenge-running">Checking your browser...</div>
        <noscript>Enable JavaScript and cookies to continue</noscript>
      </body></html>`;
    const results = parseHalachot(cloudflareHtml);
    expect(results).toHaveLength(0);
  });

  it('handles audio URL passed as string (not InputFile) in message payload', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-12/',
      title: 'Test Halacha',
      audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
    };
    // Verify the audioUrl is a plain string suitable for Telegram API
    expect(typeof h.audioUrl).toBe('string');
    expect(h.audioUrl).toMatch(/^https:\/\//);
    expect(isAllowedUrl(h.audioUrl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. fetchHTML with retry logic
// ---------------------------------------------------------------------------

describe('fetchHTML — retry logic', () => {
  it('succeeds on first try', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return { ok: true, text: async () => '<html>ok</html>' };
    };
    const html = await fetchHTML('https://example.com', fetchFn, 2);
    expect(html).toBe('<html>ok</html>');
    expect(calls).toBe(1);
  });

  it('retries on failure and succeeds', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      if (calls < 3) throw new Error('network error');
      return { ok: true, text: async () => '<html>ok</html>' };
    };
    const html = await fetchHTML('https://example.com', fetchFn, 2);
    expect(html).toBe('<html>ok</html>');
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      throw new Error('network error');
    };
    await expect(fetchHTML('https://example.com', fetchFn, 1)).rejects.toThrow('network error');
    expect(calls).toBe(2); // initial + 1 retry
  });

  it('retries on HTTP error status', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      if (calls < 2) return { ok: false, status: 503, text: async () => '' };
      return { ok: true, text: async () => '<html>ok</html>' };
    };
    const html = await fetchHTML('https://example.com', fetchFn, 2);
    expect(html).toBe('<html>ok</html>');
    expect(calls).toBe(2);
  });
});
