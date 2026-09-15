// Generic fetch helpers for the blocklist ingestion pipeline. Shells out to `curl`/`tar` rather
// than pulling in an ftp client / tar library, since UT1's sources are ftp:// only and the repo
// already relies on system tools elsewhere in scripts/.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Fetches a URL (http/https/ftp) and returns its body as a UTF-8 string. */
export function fetchText(url) {
  return execFileSync('curl', ['-fsSL', '--retry', '3', url], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256,
  });
}

/** Fetches a tarball (.tar.gz) and returns the contents of one file inside it. */
export function fetchTarFile(url, innerPath) {
  const dir = mkdtempSync(path.join(tmpdir(), 'blocklist-tar-'));
  try {
    const archivePath = path.join(dir, 'archive.tar.gz');
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', archivePath, url], {
      maxBuffer: 1024 * 1024 * 256,
    });
    execFileSync('tar', ['-xzf', archivePath, '-C', dir, innerPath]);
    return readFileSync(path.join(dir, innerPath), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
