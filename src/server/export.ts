import path from 'node:path';
import { promises as fs } from 'node:fs';
import { hashFile, sha256Hex } from '../shared/hash.js';
import { assertExistingMarkdownFile, assertWritableMarkdownTarget } from '../shared/path-safety.js';
import { ensureDirectory, safeAtomicWriteTextFile } from '../shared/file-ops.js';
import type { ShareRow } from '../shared/types.js';

export interface SourceSnapshot {
  realPath: string;
  hash: string;
  mtimeMs: number;
  size: number;
}

export interface ExportMarkdownShareInput {
  share: ShareRow;
  notesRoot: string;
  backupsRoot: string;
  content: string;
  /** Kept for compatibility with legacy callers. Exports now always use the single-owner policy. */
  force?: boolean;
  now?: Date;
}

export interface ExportMarkdownShareResult {
  status: 'exported';
  backupPath: string;
  conflictCopyPath: null;
  sourceSnapshot: SourceSnapshot;
  exportedHash: string;
}

export async function readSourceSnapshot(sourcePath: string): Promise<SourceSnapshot | null> {
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return null;
  }

  const realPath = await fs.realpath(sourcePath).catch(() => null);
  if (!realPath) {
    return null;
  }

  return {
    realPath,
    hash: await hashFile(realPath),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

export function hasSourceChangedExternally(share: ShareRow, sourceSnapshot: SourceSnapshot | null): boolean {
  if (!sourceSnapshot) {
    return true;
  }

  if (sourceSnapshot.realPath !== share.sourceRealPath) {
    return true;
  }

  return sourceSnapshot.hash !== share.sourceHash;
}

function createBackupPath(backupsRoot: string, share: ShareRow, contentHash: string): string {
  const baseName = path.basename(share.sourcePath);
  return path.join(backupsRoot, share.token, `${contentHash}-${baseName}`);
}

/**
 * Keep displaced NAS content under data/backups. The content hash is part of
 * the name, so repeated sync checks for the same NAS version are idempotent.
 */
async function createContentBackup(
  backupsRoot: string,
  share: ShareRow,
  sourceContent: string,
  contentHash: string,
): Promise<string> {
  const backupPath = createBackupPath(backupsRoot, share, contentHash);
  await ensureDirectory(path.dirname(backupPath));

  try {
    await fs.writeFile(backupPath, sourceContent, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }

    const existingContent = await fs.readFile(backupPath);
    if (sha256Hex(existingContent) !== contentHash) {
      throw new Error('Backup path already exists with different content');
    }
  }

  return backupPath;
}

export async function exportMarkdownShare({
  share,
  notesRoot,
  backupsRoot,
  content,
}: ExportMarkdownShareInput): Promise<ExportMarkdownShareResult> {
  await assertWritableMarkdownTarget(notesRoot, share.sourcePath);

  const sourceSnapshot = await readSourceSnapshot(share.sourcePath);
  if (!sourceSnapshot) {
    throw new Error('Source file is missing');
  }
  const safeSource = await assertExistingMarkdownFile(notesRoot, share.sourcePath);
  if (safeSource.realPath !== sourceSnapshot.realPath) {
    throw new Error('Source path changed during export');
  }

  const sourceContent = await fs.readFile(sourceSnapshot.realPath, 'utf8');
  const sourceContentHash = sha256Hex(sourceContent);
  const backupPath = await createContentBackup(backupsRoot, share, sourceContent, sourceContentHash);
  const exportedHash = sha256Hex(content);

  await safeAtomicWriteTextFile(share.sourcePath, content);
  const exportedSnapshot = await readSourceSnapshot(share.sourcePath);
  if (!exportedSnapshot) {
    throw new Error('Source file could not be read after export');
  }

  return {
    status: 'exported',
    backupPath,
    conflictCopyPath: null,
    sourceSnapshot: exportedSnapshot,
    exportedHash,
  };
}
