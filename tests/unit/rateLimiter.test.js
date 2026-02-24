/**
 * Rate limiter tests
 */

import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../../src/utils/rateLimiter.js';

describe('Rate limiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60000 });
    expect(limiter.isRateLimited(1)).toBe(false);
    expect(limiter.isRateLimited(1)).toBe(false);
    expect(limiter.isRateLimited(1)).toBe(false);
  });

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60000 });
    limiter.isRateLimited(1);
    limiter.isRateLimited(1);
    expect(limiter.isRateLimited(1)).toBe(true);
  });

  it('tracks separate users independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60000 });
    limiter.isRateLimited(1);
    expect(limiter.isRateLimited(2)).toBe(false);
  });

  it('resets all history', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60000 });
    limiter.isRateLimited(1);
    limiter.reset();
    expect(limiter.isRateLimited(1)).toBe(false);
  });

  it('reports size correctly', () => {
    const limiter = createRateLimiter();
    limiter.isRateLimited(1);
    limiter.isRateLimited(2);
    expect(limiter.size()).toBe(2);
  });
});
