/**
 * Broadcast state management tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';

import {
  loadBroadcastState,
  saveBroadcastState,
  wasBroadcastSentToday,
  markBroadcastSent,
} from '../../src/utils/broadcastState.js';
import { getIsraelDate } from '../../src/utils/israelTime.js';

const STATE_DIR = '.github/state';
const STATE_FILE = `${STATE_DIR}/broadcast-state.json`;

describe('Broadcast state', () => {
  beforeEach(async () => {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(
      STATE_FILE,
      JSON.stringify({ lastBroadcastDate: null, updatedAt: new Date().toISOString() }, null, 2)
    );
  });

  it('loads default state when file has null date', async () => {
    const state = await loadBroadcastState();
    expect(state.lastBroadcastDate).toBeNull();
  });

  it('reports not sent today when state is empty', async () => {
    const sent = await wasBroadcastSentToday();
    expect(sent).toBe(false);
  });

  it('marks broadcast as sent and detects it', async () => {
    await markBroadcastSent();
    const sent = await wasBroadcastSentToday();
    expect(sent).toBe(true);
  });

  it('saves and loads state correctly', async () => {
    const today = getIsraelDate();
    await saveBroadcastState({ lastBroadcastDate: today, updatedAt: new Date().toISOString() });
    const state = await loadBroadcastState();
    expect(state.lastBroadcastDate).toBe(today);
  });

  it('does not falsely report sent for a different date', async () => {
    await saveBroadcastState({ lastBroadcastDate: '2020-01-01', updatedAt: new Date().toISOString() });
    const sent = await wasBroadcastSentToday();
    expect(sent).toBe(false);
  });
});
