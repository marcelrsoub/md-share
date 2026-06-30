import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exportMarkdownShare, hasSourceChangedExternally } from '../src/server/export.js';
import { hashFile, sha256Hex } from '../src/shared/hash.js';
import {
  assertExistingMarkdownFile,
  createMarkdownConflictPath,
  resolveMarkdownAsset,
  scanMarkdownFiles,
} from '../src/shared/path-safety.js';
import { safeAtomicWriteTextFile } from '../src/shared/file-ops.js';
import { generateShareToken, isShareToken } from '../src/shared/token.js';
import type { ShareRow } from '../src/shared/types.js';

const createdDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (createdDirs.length) {
    const dir = createdDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('token generation', () => {
  it('creates secure, URL-safe share tokens', () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const token = generateShareToken();
      expect(isShareToken(token)).toBe(true);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }

    expect(tokens.size).toBe(100);
  });
});

describe('hash comparison', () => {
  it('detects file content changes with sha256 hashes', async () => {
    const dir = await makeTempDir('md-share-hash-');
    const filePath = path.join(dir, 'note.md');

    await fs.writeFile(filePath, 'alpha', 'utf8');
    const firstHash = await hashFile(filePath);
    expect(firstHash).toBe(sha256Hex('alpha'));

    await fs.writeFile(filePath, 'beta', 'utf8');
    const secondHash = await hashFile(filePath);

    expect(secondHash).toBe(sha256Hex('beta'));
    expect(secondHash).not.toBe(firstHash);
  });

  it('flags external source changes', async () => {
    const dir = await makeTempDir('md-share-hash-compare-');
    const sourcePath = path.join(dir, 'note.md');

    await fs.writeFile(sourcePath, 'original', 'utf8');
    const initialHash = await hashFile(sourcePath);
    const stat = await fs.stat(sourcePath);
    const share = makeShareRow({
      sourcePath,
      sourceRealPath: await fs.realpath(sourcePath),
      sourceHash: initialHash,
      sourceMtimeMs: stat.mtimeMs,
    });

    expect(
      hasSourceChangedExternally(share, {
        realPath: share.sourceRealPath,
        hash: initialHash,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      }),
    ).toBe(false);

    expect(
      hasSourceChangedExternally(share, {
        realPath: share.sourceRealPath,
        hash: sha256Hex('changed'),
        mtimeMs: stat.mtimeMs + 1,
        size: 7,
      }),
    ).toBe(true);
  });
});

describe('path safety', () => {
  it('only scans markdown files inside the notes root and ignores symlink escapes', async () => {
    const notesRoot = await makeTempDir('md-share-notes-');
    const outsideRoot = await makeTempDir('md-share-outside-');

    await fs.writeFile(path.join(notesRoot, 'visible.md'), '# visible', 'utf8');
    await fs.writeFile(
      createMarkdownConflictPath(path.join(notesRoot, 'visible.md'), new Date('2026-06-29T15:41:07.108Z')),
      '# stale conflict copy',
      'utf8',
    );
    await fs.writeFile(path.join(notesRoot, 'ignore.txt'), 'ignore', 'utf8');
    await fs.writeFile(path.join(outsideRoot, 'secret.md'), '# secret', 'utf8');
    await fs.symlink(path.join(outsideRoot, 'secret.md'), path.join(notesRoot, 'escape.md'));

    const files = await scanMarkdownFiles(notesRoot);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('visible.md');

    await expect(assertExistingMarkdownFile(notesRoot, path.join(notesRoot, 'escape.md'))).rejects.toThrow(
      /escapes the notes root/,
    );
  });

  it('resolves only safe local image assets for markdown previews', async () => {
    const notesRoot = await makeTempDir('md-share-assets-');
    const sourcePath = path.join(notesRoot, 'note.md');
    const imagePath = path.join(notesRoot, 'image.png');

    await fs.writeFile(sourcePath, '# note', 'utf8');
    await fs.writeFile(
      imagePath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4X5ioAAAAASUVORK5CYII=', 'base64'),
    );

    const resolution = await resolveMarkdownAsset(notesRoot, sourcePath, 'image.png');
    expect(resolution?.realPath).toBe(await fs.realpath(imagePath));
    expect(resolution?.contentType).toBe('image/png');

    await expect(resolveMarkdownAsset(notesRoot, sourcePath, '../escape.png')).resolves.toBeNull();
    await expect(resolveMarkdownAsset(notesRoot, sourcePath, 'https://example.com/image.png')).resolves.toBeNull();
  });
});

describe('safe writes and conflict exports', () => {
  it('writes files atomically', async () => {
    const dir = await makeTempDir('md-share-write-');
    const target = path.join(dir, 'draft.md');

    await safeAtomicWriteTextFile(target, 'first version');
    expect(await fs.readFile(target, 'utf8')).toBe('first version');

    await safeAtomicWriteTextFile(target, 'second version');
    expect(await fs.readFile(target, 'utf8')).toBe('second version');
  });

  it('creates backups and conflict copies when the source changed externally', async () => {
    const notesRoot = await makeTempDir('md-share-export-notes-');
    const backupsRoot = await makeTempDir('md-share-export-backups-');
    const sourcePath = path.join(notesRoot, 'shared.md');

    await fs.writeFile(sourcePath, 'original content', 'utf8');
    const originalSnapshot = await fs.stat(sourcePath);
    const share: ShareRow = makeShareRow({
      sourcePath,
      sourceRealPath: await fs.realpath(sourcePath),
      sourceHash: await hashFile(sourcePath),
      sourceMtimeMs: originalSnapshot.mtimeMs,
    });

    await fs.writeFile(sourcePath, 'external change', 'utf8');

    const result = await exportMarkdownShare({
      share,
      notesRoot,
      backupsRoot,
      content: 'edited draft',
      now: new Date('2026-06-29T12:00:00.000Z'),
    });

    expect(result.status).toBe('conflict');
    expect(result.conflictCopyPath).toBeTruthy();
    expect(result.backupPath).toContain(path.join(backupsRoot, share.token));
    expect(await fs.readFile(sourcePath, 'utf8')).toBe('external change');
    expect(await fs.readFile(result.conflictCopyPath as string, 'utf8')).toBe('edited draft');
    expect(await fs.readFile(result.backupPath, 'utf8')).toBe('external change');
  });
});

function makeShareRow(overrides: Partial<ShareRow>): ShareRow {
  const now = Date.parse('2026-06-29T12:00:00.000Z');
  const sourcePath = overrides.sourcePath ?? '/tmp/note.md';
  return {
    id: overrides.id ?? 1,
    token: overrides.token ?? 'A'.repeat(43),
    noteId: overrides.noteId ?? 'note-id',
    noteName: overrides.noteName ?? path.basename(sourcePath),
    noteRelativePath: overrides.noteRelativePath ?? path.basename(sourcePath),
    sourcePath,
    sourceRealPath: overrides.sourceRealPath ?? sourcePath,
    sourceHash: overrides.sourceHash ?? sha256Hex('original content'),
    sourceMtimeMs: overrides.sourceMtimeMs ?? now,
    yState: overrides.yState ?? Buffer.from('state'),
    createdAt: overrides.createdAt ?? now,
    expiresAt: overrides.expiresAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    lastExportedAt: overrides.lastExportedAt ?? null,
    lastExportedHash: overrides.lastExportedHash ?? null,
    dirty: overrides.dirty ?? 1,
    conflict: overrides.conflict ?? 0,
    conflictCopyPath: overrides.conflictCopyPath ?? null,
    lastError: overrides.lastError ?? null,
    updatedAt: overrides.updatedAt ?? now,
  };
}
