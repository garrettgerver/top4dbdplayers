import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type VideoStatus = 'processing' | 'ready' | 'failed';

export interface VideoRow {
  id: string;
  title: string;
  tags_json: string;
  status: VideoStatus;
  original_filename: string;
  manifest_path: string | null;
  thumbnail_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoDto {
  id: string;
  title: string;
  tags: string[];
  status: VideoStatus;
  originalFilename: string;
  manifestUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function openDb(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('processing', 'ready', 'failed')),
      original_filename TEXT NOT NULL,
      manifest_path TEXT,
      thumbnail_path TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
  `);

  return db;
}

export function toVideoDto(row: VideoRow): VideoDto {
  const tags = safeJsonArray(row.tags_json);
  return {
    id: row.id,
    title: row.title,
    tags,
    status: row.status,
    originalFilename: row.original_filename,
    manifestUrl: row.manifest_path ? `/videos/${row.id}/playlist.m3u8` : null,
    thumbnailUrl: row.thumbnail_path ? `/videos/${row.id}/thumbnail.jpg` : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
