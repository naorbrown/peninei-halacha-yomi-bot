/**
 * Israel time utilities for scheduling.
 *
 * The broadcast must fire at (or after) 03:00 Israel time regardless of
 * daylight-saving transitions. GitHub Actions cron fires on UTC, so every
 * comparison against "Israel time" routes through the Asia/Jerusalem
 * timezone, which handles DST automatically.
 */

/** Earliest Israel time (minutes since midnight) we're allowed to broadcast. */
export const BROADCAST_START_MINUTES = 3 * 60; // 03:00
/** Latest Israel time we'll still broadcast; past this we skip and wait for the next day. */
export const BROADCAST_END_MINUTES = 7 * 60; // 07:00

function getIsraelTimeParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem',
  }).formatToParts(now);
  let hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  if (hour === 24) hour = 0;
  return { hour, minute };
}

/**
 * Get current hour in Israel time as a number.
 * @returns {number} Current hour (0-23) in Israel timezone
 */
export function getIsraelHour() {
  return getIsraelTimeParts().hour;
}

/**
 * Get current Israel time as minutes since midnight (0-1439).
 * @returns {number}
 */
export function getIsraelMinutes() {
  const { hour, minute } = getIsraelTimeParts();
  return hour * 60 + minute;
}

/**
 * Get today's date in Israel timezone as YYYY-MM-DD.
 * @returns {string}
 */
export function getIsraelDate() {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date());
}

/**
 * Check if current Israel time is within the broadcast window
 * [03:00, 07:00). Before 03:00 we refuse to fire; after 07:00 we assume
 * something went wrong and skip (operator can rerun via workflow_dispatch).
 * Duplicate prevention is handled by the sentinel cache and state file.
 * @returns {boolean}
 */
export function isIsraelBroadcastWindow() {
  const minutes = getIsraelMinutes();
  return minutes >= BROADCAST_START_MINUTES && minutes < BROADCAST_END_MINUTES;
}
