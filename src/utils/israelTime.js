/**
 * Israel time utilities for scheduling
 */

/**
 * Get current hour in Israel time as a number
 * @returns {number} Current hour (0-23) in Israel timezone
 */
export function getIsraelHour() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Asia/Jerusalem',
  });
  const hour = parseInt(formatter.format(now), 10);
  return hour === 24 ? 0 : hour;
}

/**
 * Get today's date in Israel timezone as YYYY-MM-DD
 * @returns {string} Date string
 */
export function getIsraelDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
  return formatter.format(now);
}

/**
 * Check if current Israel time is within the broadcast window (midnight-7am).
 * Uses a window instead of an exact hour to tolerate GitHub Actions cron delays,
 * which can be 30-90+ minutes. Duplicate prevention is handled separately by
 * the sentinel cache and broadcastState.
 * @returns {boolean} true if Israel hour is 0-7
 */
export function isIsraelBroadcastWindow() {
  const hour = getIsraelHour();
  return hour >= 0 && hour <= 7;
}
