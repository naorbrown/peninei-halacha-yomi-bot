/**
 * Rate Limiter Utility
 * Prevents abuse by limiting requests per user
 */

/**
 * Create a rate limiter instance
 * @param {Object} options
 * @param {number} options.limit - Max requests per window (default: 5)
 * @param {number} options.windowMs - Time window in ms (default: 60000)
 * @param {number} options.maxEntries - Max tracked users before cleanup (default: 1000)
 * @returns {Object} Rate limiter with isRateLimited() and reset() methods
 */
export function createRateLimiter(options = {}) {
  const { limit = 5, windowMs = 60000, maxEntries = 1000 } = options;
  const history = new Map();

  function isRateLimited(chatId) {
    const now = Date.now();
    const userHistory = history.get(chatId) || [];
    const recentRequests = userHistory.filter(t => now - t < windowMs);

    if (recentRequests.length >= limit) {
      return true;
    }

    recentRequests.push(now);
    history.set(chatId, recentRequests);

    if (history.size > maxEntries) {
      for (const [id, times] of history) {
        if (times.every(t => now - t > windowMs)) {
          history.delete(id);
        }
      }
    }

    return false;
  }

  function reset() {
    history.clear();
  }

  function size() {
    return history.size;
  }

  return { isRateLimited, reset, size };
}
