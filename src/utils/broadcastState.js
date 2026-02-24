/**
 * Broadcast state management — prevents duplicate daily broadcasts.
 * State persisted to .github/state/broadcast-state.json and committed
 * back by the GitHub Actions workflow.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { getIsraelDate } from './israelTime.js';

const STATE_FILE = '.github/state/broadcast-state.json';

/**
 * Load broadcast state from file
 * @returns {Promise<{lastBroadcastDate: string|null}>}
 */
export async function loadBroadcastState() {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { lastBroadcastDate: null };
  }
}

/**
 * Save broadcast state to file
 * @param {object} state
 */
export async function saveBroadcastState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Check if broadcast was already sent today (Israel time)
 * @returns {Promise<boolean>}
 */
export async function wasBroadcastSentToday() {
  const state = await loadBroadcastState();
  const today = getIsraelDate();
  return state.lastBroadcastDate === today;
}

/**
 * Mark broadcast as sent for today (Israel time)
 */
export async function markBroadcastSent() {
  const today = getIsraelDate();
  await saveBroadcastState({
    lastBroadcastDate: today,
    updatedAt: new Date().toISOString(),
  });
}
