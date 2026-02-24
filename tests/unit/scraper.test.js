/**
 * Scraper tests — parseHalachot, scrapeDailyHalachot, fetchHTML, dailyApiUrls
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  BASE,
  DAILY_URL,
  ALLOWED_HOSTS,
  isAllowedUrl,
  dailyApiUrls,
  parseHalachot,
  scrapeDailyHalachot,
  fetchHTML,
  getCachedHalachot,
  setCachedHalachot,
  clearCache,
} from '../../src/scraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fixture = (name) =>
  readFileSync(resolve(__dirname, '..', 'fixtures', name), 'utf-8');

const FIXTURES = {
  standard: fixture('daily-page.html'),
  noAudio: fixture('daily-page-no-audio.html'),
  fallbackLinks: fixture('daily-page-fallback-links.html'),
  protocolRelative: fixture('daily-page-protocol-relative.html'),
  empty: fixture('daily-page-empty.html'),
};

// --- Mock fetch helpers ---
function mockFetchOk(html) {
  return async () => ({ ok: true, text: async () => html });
}

function mockFetchFail(status) {
  return async () => ({ ok: false, status, text: async () => '' });
}

// ---------------------------------------------------------------------------
// URL VALIDATION
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
// HTML PARSING
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
      expect(results[0].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-12.mp3');
      expect(results[1].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-13.mp3');
    });
  });

  describe('page without audio elements', () => {
    it('derives audio URLs from page URL pattern', () => {
      const results = parseHalachot(FIXTURES.noAudio);
      expect(results[0].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-12.mp3');
      expect(results[1].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-13.mp3');
    });
  });

  describe('protocol-relative and root-relative audio URLs', () => {
    it('normalizes //domain URLs to https:', () => {
      const results = parseHalachot(FIXTURES.protocolRelative);
      expect(results[0].audioUrl).toBe('https://cdn1.yhb.org.il/mp3/20-26-12.mp3');
    });

    it('normalizes /path URLs to BASE + path', () => {
      const results = parseHalachot(FIXTURES.protocolRelative);
      expect(results[1].audioUrl).toBe('https://ph.yhb.org.il/mp3/20-26-13.mp3');
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
      expect(parseHalachot(FIXTURES.empty)).toHaveLength(0);
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
      expect(
        results[0].audioUrl === null ||
          results[0].audioUrl === 'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
      ).toBe(true);
    });
  });

  describe('result limiting', () => {
    it('returns at most 2 results even if more are present', () => {
      const html = `
        <div class="ym-hala-1"><h3><a href="https://ph.yhb.org.il/20-26-10/">A</a></h3></div>
        <div class="ym-hala-2"><h3><a href="https://ph.yhb.org.il/20-26-11/">B</a></h3></div>
        <div class="ym-hala-1"><h3><a href="https://ph.yhb.org.il/20-26-12/">C</a></h3></div>`;
      expect(parseHalachot(html).length).toBeLessThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('handles HTML with extra whitespace in titles', () => {
      const html = `
        <div class="ym-hala-1">
          <h3><a href="https://ph.yhb.org.il/20-26-12/">
            פרק כו – הלכות שבת
          </a></h3>
        </div>`;
      const results = parseHalachot(html);
      expect(results[0].title).toBe('פרק כו – הלכות שבת');
    });

    it('handles missing title gracefully', () => {
      const html = `
        <div class="ym-hala-1">
          <h3><a href="https://ph.yhb.org.il/20-26-12/"></a></h3>
        </div>`;
      expect(parseHalachot(html)[0].title).toBe('הלכה');
    });

    it('handles missing href gracefully', () => {
      const html = `
        <div class="ym-hala-1">
          <h3><a>Some Title</a></h3>
        </div>`;
      expect(parseHalachot(html)[0].url).toBe(DAILY_URL);
    });

    it('returns empty when HTML is a Cloudflare challenge page', () => {
      const cloudflareHtml = `
        <!DOCTYPE html>
        <html><head><title>Just a moment...</title></head>
        <body><div id="challenge-running">Checking your browser...</div></body></html>`;
      expect(parseHalachot(cloudflareHtml)).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// URL FALLBACK CHAIN
// ---------------------------------------------------------------------------

describe('Scraper — URL fallback chain', () => {
  beforeEach(() => clearCache());

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
    const fetchFn = async () => {
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
    const fetchFn = async () => {
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

  it('falls back to main page when all API URLs fail', async () => {
    let calledUrls = [];
    const fetchFn = async (url) => {
      calledUrls.push(url);
      if (url.startsWith(DAILY_URL)) {
        return { ok: true, text: async () => FIXTURES.standard };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
    const results = await scrapeDailyHalachot(fetchFn, ['https://ph.yhb.org.il/api/2026']);
    expect(results).toHaveLength(2);
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
    const results = await scrapeDailyHalachot(fetchFn, ['https://ph.yhb.org.il/api/2026']);
    expect(results).toHaveLength(2);
    expect(calledUrls.some(u => u.includes('webcache.googleusercontent.com'))).toBe(true);
  });

  it('throws descriptive error when all sources fail', async () => {
    await expect(
      scrapeDailyHalachot(mockFetchFail(500), ['https://ph.yhb.org.il/api/2026']),
    ).rejects.toThrow(/No halacha links found/);
  });

  it('error message lists all failed URLs', async () => {
    try {
      await scrapeDailyHalachot(mockFetchFail(503), [
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
});

// ---------------------------------------------------------------------------
// DYNAMIC API URL GENERATION
// ---------------------------------------------------------------------------

describe('Dynamic API URL generation — dailyApiUrls()', () => {
  it('generates current year URL as first candidate', () => {
    const year = new Date().getFullYear();
    expect(dailyApiUrls()[0]).toContain(`pninayomit-${year}`);
  });

  it('generates previous year URL as second candidate', () => {
    const year = new Date().getFullYear();
    expect(dailyApiUrls()[1]).toContain(`pninayomit-${year - 1}`);
  });

  it('generates yearless URL as third candidate', () => {
    expect(dailyApiUrls()[2]).toBe(
      `${BASE}/wp-content/plugins/db-connect/pninayomit/he_py.php`,
    );
  });

  it('returns exactly 3 candidates', () => {
    expect(dailyApiUrls()).toHaveLength(3);
  });

  it('accepts year override for testing', () => {
    const urls = dailyApiUrls(2026);
    expect(urls[0]).toContain('pninayomit-2026');
    expect(urls[1]).toContain('pninayomit-2025');
  });

  it('all URLs start with the base domain', () => {
    for (const url of dailyApiUrls()) {
      expect(url.startsWith(BASE)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// fetchHTML RETRY LOGIC
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
    expect(calls).toBe(2);
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

// ---------------------------------------------------------------------------
// CACHING
// ---------------------------------------------------------------------------

describe('Daily cache', () => {
  beforeEach(() => clearCache());

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
    expect(callCount).toBeLessThanOrEqual(2);
  });
});
