import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup as lookupMime } from 'mime-types';
import { z } from 'zod';
import { openDb, toVideoDto, type VideoRow } from './db.js';
import { createThumbnail, transcodeMp4ToHls } from './ffmpeg.js';
import { hlsDir, originalPath, safeHlsAssetPath, thumbnailPath, videoRoot } from './paths.js';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  STORAGE_ROOT: z.string().default('./storage'),
  DB_PATH: z.string().default('./data/videos.sqlite'),
  HLS_LIST_SIZE: z.coerce.number().int().min(0).default(0),
  CORS_ORIGIN: z.string().default('*')
});

const env = envSchema.parse(process.env);
const storageRoot = path.resolve(env.STORAGE_ROOT);
const db = openDb(path.resolve(env.DB_PATH));

await fs.mkdir(storageRoot, { recursive: true });

const app = new Hono();

app.use('*', cors({ origin: env.CORS_ORIGIN }));

app.get('/health', (c) => c.json({ ok: true }));

app.get('/videos', (c) => {
  const rows = db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as VideoRow[];
  return c.json(rows.map(toVideoDto));
});

app.get('/videos/:id', (c) => {
  const id = c.req.param('id');
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;

  if (!row) return c.json({ error: 'Video not found' }, 404);
  return c.json(toVideoDto(row));
});

app.post('/videos', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const file = body.file;

  if (!(file instanceof File)) {
    return c.json({ error: 'Expected multipart field named "file" containing an MP4 video.' }, 400);
  }

  if (file.type && file.type !== 'video/mp4') {
    return c.json({ error: `Expected video/mp4, received ${file.type}` }, 400);
  }

  const id = randomUUID();
  const title = String(body.title ?? file.name.replace(/\.mp4$/i, '')).trim() || 'Untitled video';
  const tags = parseTags(body.tags);

  const root = videoRoot(storageRoot, id);
  const inputPath = originalPath(storageRoot, id);
  const outputDir = hlsDir(storageRoot, id);
  const thumbPath = thumbnailPath(storageRoot, id);

  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

  db.prepare(`
    INSERT INTO videos (id, title, tags_json, status, original_filename, created_at, updated_at)
    VALUES (?, ?, ?, 'processing', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, title, JSON.stringify(tags), file.name);

  // Fire-and-track. The upload request returns quickly while ffmpeg runs on the server.
  processVideo(id, inputPath, outputDir, thumbPath).catch((error) => {
    console.error(`Processing failed for video ${id}`, error);
  });

  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow;
  return c.json(toVideoDto(row), 202);
});

app.get('/videos/:id/thumbnail.jpg', async (c) => {
  const id = c.req.param('id');
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as VideoRow | undefined;
  if (!row || !row.thumbnail_path) return c.json({ error: 'Thumbnail not found' }, 404);

  const filePath = thumbnailPath(storageRoot, id);
  return sendFile(c, filePath, 'image/jpeg');
});

// hls.js will request this first.
app.get('/videos/:id/playlist.m3u8', async (c) => {
  const id = c.req.param('id');
  const assetPath = safeHlsAssetPath(storageRoot, id, 'playlist.m3u8');
  if (!assetPath) return c.json({ error: 'Invalid path' }, 400);

  return sendFile(c, assetPath, 'application/vnd.apple.mpegurl');
});

// hls.js will request every segment listed inside playlist.m3u8.
app.get('/videos/:id/:segment', async (c) => {
  const id = c.req.param('id');
  const segment = c.req.param('segment');
  const assetPath = safeHlsAssetPath(storageRoot, id, segment);

  if (!assetPath) return c.json({ error: 'Invalid segment path' }, 400);
  return sendFile(c, assetPath, lookupMime(assetPath) || 'video/mp2t');
});

async function processVideo(id: string, inputPath: string, outputDir: string, thumbPath: string) {
  try {
    await createThumbnail(inputPath, thumbPath);
    await transcodeMp4ToHls({
      inputPath,
      outputDir,
      hlsListSize: env.HLS_LIST_SIZE
    });

    db.prepare(`
      UPDATE videos
      SET status = 'ready',
          manifest_path = ?,
          thumbnail_path = ?,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(path.join(outputDir, 'playlist.m3u8'), thumbPath, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE videos
      SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(message, id);
  }
}

async function sendFile(c: Parameters<Parameters<typeof app.get>[1]>[0], filePath: string, contentType: string) {
  try {
    const data = await fs.readFile(filePath);
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(data);
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((x) => x.trim()).filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((x) => x.trim()).filter(Boolean);
    }
  } catch {
    // Fall through to comma-separated tags.
  }

  return value.split(',').map((x) => x.trim()).filter(Boolean);
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Hono HLS backend listening on http://localhost:${info.port}`);
  console.log(`Storage root: ${storageRoot}`);
});
