/**
 * Israel time utility tests
 */

import { describe, it, expect } from 'vitest';
import { getIsraelHour, getIsraelDate, isIsraelBroadcastWindow } from '../../src/utils/israelTime.js';

describe('Israel time utilities', () => {
  it('getIsraelHour returns a number between 0 and 23', () => {
    const hour = getIsraelHour();
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it('getIsraelDate returns a YYYY-MM-DD string', () => {
    const date = getIsraelDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('isIsraelBroadcastWindow returns a boolean', () => {
    const result = isIsraelBroadcastWindow();
    expect(typeof result).toBe('boolean');
  });
});
