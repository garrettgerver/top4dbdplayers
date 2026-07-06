import path from 'node:path';

export function videoRoot(storageRoot: string, videoId: string) {
  return path.join(storageRoot, 'videos', videoId);
}

export function originalPath(storageRoot: string, videoId: string) {
  return path.join(videoRoot(storageRoot, videoId), 'original.mp4');
}

export function hlsDir(storageRoot: string, videoId: string) {
  return path.join(videoRoot(storageRoot, videoId), 'hls');
}

export function thumbnailPath(storageRoot: string, videoId: string) {
  return path.join(videoRoot(storageRoot, videoId), 'thumbnail.jpg');
}

export function safeHlsAssetPath(storageRoot: string, videoId: string, assetName: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(assetName)) {
    return null;
  }

  if (!assetName.endsWith('.m3u8') && !assetName.endsWith('.ts')) {
    return null;
  }

  const base = hlsDir(storageRoot, videoId);
  const resolved = path.resolve(base, assetName);
  const resolvedBase = path.resolve(base);

  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    return null;
  }

  return resolved;
}
