/**
 * Subscriber management tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'fs/promises';
import { dirname } from 'path';

// We test the module by manipulating the underlying JSON file directly
// since the module reads/writes to .github/state/subscribers.json
import {
  loadSubscribers,
  saveSubscribers,
  addSubscriber,
  removeSubscriber,
} from '../../src/utils/subscribers.js';

const STATE_DIR = '.github/state';
const SUBS_FILE = `${STATE_DIR}/subscribers.json`;

describe('Subscriber management', () => {
  beforeEach(async () => {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(
      SUBS_FILE,
      JSON.stringify({ subscribers: [], updatedAt: new Date().toISOString() }, null, 2)
    );
  });

  afterEach(async () => {
    // Reset to empty
    await writeFile(
      SUBS_FILE,
      JSON.stringify({ subscribers: [], updatedAt: new Date().toISOString() }, null, 2)
    );
  });

  it('loads empty subscriber list', async () => {
    const subs = await loadSubscribers();
    expect(subs).toEqual([]);
  });

  it('adds a new subscriber', async () => {
    const isNew = await addSubscriber(12345);
    expect(isNew).toBe(true);
    const subs = await loadSubscribers();
    expect(subs).toContain(12345);
  });

  it('rejects duplicate subscriber', async () => {
    await addSubscriber(12345);
    const isNew = await addSubscriber(12345);
    expect(isNew).toBe(false);
    const subs = await loadSubscribers();
    expect(subs.filter(id => id === 12345)).toHaveLength(1);
  });

  it('removes a subscriber', async () => {
    await addSubscriber(100);
    await addSubscriber(200);
    const removed = await removeSubscriber(100);
    expect(removed).toBe(true);
    const subs = await loadSubscribers();
    expect(subs).toEqual([200]);
  });

  it('returns false when removing non-existent subscriber', async () => {
    const removed = await removeSubscriber(99999);
    expect(removed).toBe(false);
  });

  it('handles negative chat IDs (group chats)', async () => {
    await addSubscriber(-100123456);
    const subs = await loadSubscribers();
    expect(subs).toContain(-100123456);
  });

  it('supports many subscribers', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    await saveSubscribers(ids);
    const subs = await loadSubscribers();
    expect(subs).toHaveLength(100);
  });

  it('returns empty array when file is missing', async () => {
    await rm(SUBS_FILE, { force: true });
    const subs = await loadSubscribers();
    expect(subs).toEqual([]);
  });
});
