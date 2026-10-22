import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import chromium from '@sparticuz/chromium';

// Minimal sandboxes may not ship NSS. Use the libraries bundled with our pinned
// headless Chromium rather than fetching a browser or altering system packages.
export default async function prepareChromium() {
  await chromium.executablePath();
  const root = '/tmp/cove-chrome-libs';
  if (existsSync(`${root}/lib/libnss3.so`)) return;
  await mkdir(root, { recursive: true });
  const archive = resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
  const tar = `${root}/al2023.tar`;
  await pipeline(createReadStream(archive), createBrotliDecompress(), createWriteStream(tar));
  try { execFileSync('tar', ['xf', tar, '-C', root]); }
  finally { await unlink(tar); }
}
