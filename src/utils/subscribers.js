/**
 * Subscriber Management
 * Tracks users who have started the bot for daily broadcasts.
 * Storage: .github/state/subscribers.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const SUBSCRIBERS_FILE = '.github/state/subscribers.json';

/**
 * Load all subscriber chat IDs
 * @returns {Promise<number[]>} Array of chat IDs
 */
export async function loadSubscribers() {
  try {
    const content = await readFile(SUBSCRIBERS_FILE, 'utf-8');
    const data = JSON.parse(content);
    return data.subscribers || [];
  } catch {
    return [];
  }
}

/**
 * Save subscriber list
 * @param {number[]} subscribers Array of chat IDs
 */
export async function saveSubscribers(subscribers) {
  await mkdir(dirname(SUBSCRIBERS_FILE), { recursive: true });
  await writeFile(
    SUBSCRIBERS_FILE,
    JSON.stringify({ subscribers, updatedAt: new Date().toISOString() }, null, 2) + '\n'
  );
}

/**
 * Add a subscriber (if not already subscribed)
 * @param {number} chatId Chat ID to add
 * @returns {Promise<boolean>} True if newly added, false if already exists
 */
export async function addSubscriber(chatId) {
  const subscribers = await loadSubscribers();
  if (subscribers.includes(chatId)) {
    return false;
  }
  subscribers.push(chatId);
  await saveSubscribers(subscribers);
  return true;
}

/**
 * Remove a subscriber
 * @param {number} chatId Chat ID to remove
 * @returns {Promise<boolean>} True if removed, false if not found
 */
export async function removeSubscriber(chatId) {
  const subscribers = await loadSubscribers();
  const index = subscribers.indexOf(chatId);
  if (index === -1) {
    return false;
  }
  subscribers.splice(index, 1);
  await saveSubscribers(subscribers);
  return true;
}
