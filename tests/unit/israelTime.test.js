/**
 * Israel time utility tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROADCAST_END_MINUTES,
  BROADCAST_START_MINUTES,
  getIsraelDate,
  getIsraelHour,
  getIsraelMinutes,
  isIsraelBroadcastWindow,
} from '../../src/utils/israelTime.js';

/**
 * Build a UTC Date whose Asia/Jerusalem wall-clock is h:m by applying the
 * active DST offset. Works for any date the host Intl DB knows about.
 */
function israelWallClock(hour, minute = 0, referenceISO = '2026-04-24T12:00:00Z') {
  const reference = new Date(referenceISO);
  const israelHourAtReference = parseInt(
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jerusalem',
    }).format(reference),
    10,
  );
  const referenceUTCHour = reference.getUTCHours();
  const offsetHours = (israelHourAtReference - referenceUTCHour + 24) % 24;
  const utcHour = (hour - offsetHours + 24) % 24;
  const d = new Date(reference);
  d.setUTCHours(utcHour, minute, 0, 0);
  return d;
}

describe('Israel time utilities', () => {
  afterEach(() => vi.useRealTimers());

  it('getIsraelHour returns a number between 0 and 23', () => {
    const hour = getIsraelHour();
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it('getIsraelMinutes returns 0..1439', () => {
    const m = getIsraelMinutes();
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThan(24 * 60);
  });

  it('getIsraelDate returns a YYYY-MM-DD string', () => {
    const date = getIsraelDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('broadcast window constants target 03:00–07:00 Israel', () => {
    expect(BROADCAST_START_MINUTES).toBe(180);
    expect(BROADCAST_END_MINUTES).toBe(420);
  });

  describe('isIsraelBroadcastWindow', () => {
    beforeEach(() => vi.useFakeTimers());

    it('rejects 02:59 Israel (one minute before the window opens)', () => {
      vi.setSystemTime(israelWallClock(2, 59));
      expect(isIsraelBroadcastWindow()).toBe(false);
    });

    it('accepts 03:00 Israel (window opens)', () => {
      vi.setSystemTime(israelWallClock(3, 0));
      expect(isIsraelBroadcastWindow()).toBe(true);
    });

    it('accepts 04:30 Israel (typical cron-delay landing)', () => {
      vi.setSystemTime(israelWallClock(4, 30));
      expect(isIsraelBroadcastWindow()).toBe(true);
    });

    it('accepts 06:59 Israel (last minute of window)', () => {
      vi.setSystemTime(israelWallClock(6, 59));
      expect(isIsraelBroadcastWindow()).toBe(true);
    });

    it('rejects 07:00 Israel (window closed)', () => {
      vi.setSystemTime(israelWallClock(7, 0));
      expect(isIsraelBroadcastWindow()).toBe(false);
    });

    it('rejects 00:30 Israel (well before the window)', () => {
      vi.setSystemTime(israelWallClock(0, 30));
      expect(isIsraelBroadcastWindow()).toBe(false);
    });
  });
});
