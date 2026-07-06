import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

interface TranscodeOptions {
  inputPath: string;
  outputDir: string;
  hlsListSize: number;
}

export async function transcodeMp4ToHls(options: TranscodeOptions): Promise<void> {
  await fs.mkdir(options.outputDir, { recursive: true });

  const playlistPath = path.join(options.outputDir, 'playlist.m3u8');
  const segmentPattern = path.join(options.outputDir, 'segment_%03d.ts');

  await runCommand('ffmpeg', [
    '-y',
    '-i', options.inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', String(options.hlsListSize),
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', segmentPattern,
    playlistPath
  ]);
}

export async function createThumbnail(inputPath: string, thumbnailPath: string): Promise<void> {
  await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });

  await runCommand('ffmpeg', [
    '-y',
    '-ss', '00:00:01',
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', 'scale=480:-1',
    thumbnailPath
  ]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-4000)}`));
    });
  });
}
