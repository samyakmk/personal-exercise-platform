import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { brotliCompress, createBrotliCompress, createGzip, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { preferredEncoding } from './http.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};
const compressible = new Set(['.html', '.js', '.css', '.json']);
const spaPaths = new Set(['/', '/explore', '/workouts', '/progress', '/form-review', '/photo-credits']);
const fingerprint = /(?:[.-])[\da-f]{32}\.[a-z]+$/i;
const brotli = promisify(brotliCompress);
const zipped = promisify(gzip);
const maxCachedAsset = 4 * 1024 * 1024;
const maxEncodedAssets = 8;
const brotliOptions = { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } };
const gzipOptions = { level: 5 };
const browserPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  'frame-src https://www.youtube-nocookie.com',
  "connect-src 'self'",
].join('; ');

async function locate(dist, pathname) {
  const candidate = resolve(dist, '.' + pathname);
  const fromDist = relative(dist, candidate);
  if (!fromDist || fromDist === '..' || fromDist.startsWith('..' + sep)) return null;
  const [root, file] = await Promise.all([realpath(dist), realpath(candidate)]).catch((error) => {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return [];
    throw error;
  });
  if (!file || file !== resolve(root, fromDist)) return null;
  const info = await stat(file);
  return info.isFile() ? { file, info } : null;
}

export function createStaticHandler(directory) {
  const dist = resolve(directory);
  const encoded = new Map();
  function compressedAsset(file, tag, coding) {
    const key = file + '\n' + tag;
    if (encoded.has(key)) return encoded.get(key);
    const result = readFile(file).then((bytes) => coding === 'br'
      ? brotli(bytes, brotliOptions) : zipped(bytes, gzipOptions)).catch((error) => {
      if (encoded.get(key) === result) encoded.delete(key);
      throw error;
    });
    if (encoded.size >= maxEncodedAssets) encoded.delete(encoded.keys().next().value);
    encoded.set(key, result);
    return result;
  }
  return async function serve(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.split(/[\\/]/).some((part) => part.startsWith('.')) || pathname.includes('\0')) {
      res.writeHead(404).end();
      return;
    }
    const resource = spaPaths.has(pathname.replace(/\/$/, '') || '/') ? '/index.html' : pathname;
    const found = await locate(dist, resource);
    if (!found) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
      return;
    }
    const { file, info } = found;
    const ext = extname(resource);
    const canCompress = info.size >= 1024 && compressible.has(ext);
    const coding = canCompress ? preferredEncoding(req.headers['accept-encoding'], ['br', 'gzip']) : null;
    const fingerprinted = fingerprint.test(resource);
    const buffered = Boolean(coding && fingerprinted && info.size <= maxCachedAsset);
    const representation = coding === 'br' ? (buffered ? 'br6' : 'br4') : coding ?? 'identity';
    const tag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}-${representation}"`;
    const headers = {
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Cache-Control': fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
      'ETag': tag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (ext === '.html') {
      headers['Content-Security-Policy'] = browserPolicy;
      headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    }
    if (canCompress) headers.Vary = 'Accept-Encoding';
    if (coding) headers['Content-Encoding'] = coding;
    const conditions = req.headers['if-none-match']?.split(',').map((part) => part.trim().replace(/^W\//, ''));
    if (conditions?.includes('*') || conditions?.includes(tag.slice(2))) {
      res.writeHead(304, headers).end();
      return;
    }
    if (buffered) {
      const bytes = await compressedAsset(file, tag, coding);
      headers['Content-Length'] = bytes.length;
      res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : bytes);
      return;
    }
    if (!coding) headers['Content-Length'] = info.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const source = createReadStream(file);
    if (coding === 'br') {
      await pipeline(source, createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }), res);
    } else if (coding === 'gzip') {
      await pipeline(source, createGzip(gzipOptions), res);
    } else {
      await pipeline(source, res);
    }
  };
}
