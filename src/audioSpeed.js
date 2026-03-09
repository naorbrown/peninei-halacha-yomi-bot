/**
 * Audio Converter — MP3 to OGG Opus
 *
 * Converts MP3 buffers to OGG Opus format so Telegram's sendVoice
 * can be used, which provides native speed controls for any duration.
 * Requires ffmpeg with libopus support.
 */

import { execFile } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Convert an MP3 buffer to OGG Opus format.
 *
 * @param {Buffer} inputBuffer - Original MP3 audio buffer
 * @returns {Promise<Buffer>} - OGG Opus audio buffer
 */
export async function convertToOgg(inputBuffer) {
  const id = randomBytes(6).toString('hex');
  const inputPath = join(tmpdir(), `ph-in-${id}.mp3`);
  const outputPath = join(tmpdir(), `ph-out-${id}.ogg`);

  try {
    await writeFile(inputPath, inputBuffer);

    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', inputPath,
        '-c:a', 'libopus',
        '-b:a', '48k',
        '-vbr', 'on',
        '-compression_level', '10',
        '-application', 'voip',
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
