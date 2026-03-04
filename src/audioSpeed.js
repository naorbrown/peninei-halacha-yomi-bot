/**
 * Audio Speed Processor
 *
 * Uses ffmpeg's atempo filter to change playback speed of audio buffers.
 * Requires ffmpeg to be installed on the system.
 */

import { execFile } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const ALLOWED_SPEEDS = [1.5, 2];

/**
 * Speed up an audio buffer using ffmpeg's atempo filter.
 *
 * @param {Buffer} inputBuffer - Original MP3 audio buffer
 * @param {number} speed - Playback speed (1.5 or 2)
 * @returns {Promise<Buffer>} - Sped-up MP3 audio buffer
 */
export async function changeSpeed(inputBuffer, speed) {
  if (!ALLOWED_SPEEDS.includes(speed)) {
    throw new Error(`Unsupported speed: ${speed}. Allowed: ${ALLOWED_SPEEDS.join(', ')}`);
  }

  const id = randomBytes(6).toString('hex');
  const inputPath = join(tmpdir(), `ph-in-${id}.mp3`);
  const outputPath = join(tmpdir(), `ph-out-${id}.mp3`);

  try {
    await writeFile(inputPath, inputBuffer);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', inputPath,
        '-filter:a', `atempo=${speed}`,
        '-vn',
        '-y',
        outputPath,
      ], { timeout: 30_000 }, (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg failed: ${error.message}\n${stderr}`));
        } else {
          resolve();
        }
      });
    });

    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
