# Hono HLS Backend

A Node/Hono backend that accepts MP4 uploads, uses ffmpeg to generate an HLS manifest and `.ts` chunks, stores metadata in SQLite, and serves the manifest/chunks for hls.js.

## Routes

- `POST /videos` multipart upload
  - `file`: MP4 file
  - `title`: optional title
  - `tags`: optional comma-separated string or JSON array
- `GET /videos` list metadata
- `GET /videos/:id` get one video's metadata
- `GET /videos/:id/playlist.m3u8` HLS manifest
- `GET /videos/:id/:segment` HLS `.ts` chunk
- `GET /videos/:id/thumbnail.jpg` generated thumbnail
- `GET /health`

## Install

```bash
npm install
cp .env.example .env
npm run dev
```

You also need ffmpeg installed and available on PATH.

```bash
ffmpeg -version
```

## Upload test

```bash
curl -X POST http://localhost:3000/videos \
  -F "file=@input.mp4;type=video/mp4" \
  -F "title=Example Video" \
  -F "tags=demo,test"
```

The response returns `202 Accepted` with `status: "processing"`. Poll `GET /videos/:id` until `status` becomes `ready`.

## hls.js frontend shape

```ts
const video = document.querySelector('video')!;
const manifestUrl = `http://localhost:3000/videos/${videoId}/playlist.m3u8`;

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(manifestUrl);
  hls.attachMedia(video);
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = manifestUrl;
}
```

## NAS storage with Tailscale

Recommended approach:

1. Install Tailscale on the backend server.
2. Install Tailscale on the NAS, or on a machine that has the NAS mounted.
3. Mount the NAS share on the backend host using the NAS Tailscale IP or MagicDNS name.
4. Set `STORAGE_ROOT` to the mounted NAS path, for example:

```env
STORAGE_ROOT=/mnt/nas/hls-videos
```

The backend does not need to know about Tailscale directly. It just writes files to a normal filesystem path.

## HLS list size

`HLS_LIST_SIZE=0` is best for normal uploaded videos because the playlist includes all segments.

Set this to `6` to match:

```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls -hls_time 2 -hls_list_size 6 playlist.m3u8
```

But for VOD playback, a list size of `6` means the playlist only references a moving window of six chunks.
