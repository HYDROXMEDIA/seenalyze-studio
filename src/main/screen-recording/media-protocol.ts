// Serves the files an editor window works with (the recording, its camera
// track and background images) over a private scheme. Only files registered
// here are reachable, each under an unguessable address, and byte ranges are
// supported so the video can seek. Pages load from the dev server or from
// disk, so the same address works in both.

import { protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

const SCHEME = 'recording-media';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const files = new Map<string, string>();
const tokens = new Map<string, string>();

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ]);
}

/** The address of a file for the editor; the same file keeps its address. */
export function mediaUrl(path: string, version: number | string = 0): string {
  let token = tokens.get(path);
  if (token === undefined) {
    token = randomUUID();
    tokens.set(path, token);
    files.set(token, path);
  }
  return `${SCHEME}://file/${token}${extname(path).toLowerCase()}?v=${encodeURIComponent(String(version))}`;
}

/** Forgets a file, for example after it was deleted. */
export function forgetMedia(path: string): void {
  const token = tokens.get(path);
  if (token === undefined) return;
  tokens.delete(path);
  files.delete(token);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, first, last] = match;
  if (first === '' && last === '') return null;
  // "bytes=-N" asks for the last N bytes.
  const start = first === '' ? Math.max(0, size - Number(last)) : Number(first);
  const end = first === '' || last === '' ? size - 1 : Math.min(size - 1, Number(last));
  return start <= end && start < size ? { start, end } : null;
}

export function handleMediaScheme(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const token = url.pathname.slice(1).replace(/\.[a-z0-9]+$/, '');
    const path = url.hostname === 'file' ? files.get(token) : undefined;
    const stat = path === undefined ? null : await fs.stat(path).catch(() => null);
    if (path === undefined || stat === null || !stat.isFile()) return new Response(null, { status: 404 });
    const headers = new Headers({
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    const range = parseRange(request.headers.get('Range'), stat.size);
    if (request.headers.has('Range') && range === null) {
      headers.set('Content-Range', `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    const { start, end } = range ?? { start: 0, end: stat.size - 1 };
    headers.set('Content-Length', String(Math.max(0, end - start + 1)));
    if (range !== null) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status: range ? 206 : 200, headers });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}
