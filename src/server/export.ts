import path from 'node:path';
import { promises as fs } from 'node:fs';
import { hashFile, sha256Hex } from '../shared/hash.js';
import { assertWritableMarkdownTarget, createMarkdownConflictPath } from '../shared/path-safety.js';
import { copyFileToPath, ensureDirectory, safeAtomicWriteTextFile, writeTextToPath } from '../shared/file-ops.js';
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
  now?: Date;
}

export interface ExportMarkdownShareResult {
  status: 'exported' | 'conflict';
  backupPath: string;
  conflictCopyPath: string | null;
  sourceSnapshot: SourceSnapshot | null;
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

function createBackupPath(backupsRoot: string, share: ShareRow, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(share.sourcePath);
  return path.join(backupsRoot, share.token, `${stamp}-${baseName}`);
}

async function createBackup(share: ShareRow, backupsRoot: string, content: string, now: Date): Promise<string> {
  const backupPath = createBackupPath(backupsRoot, share, now);
  await ensureDirectory(path.dirname(backupPath));

  const existingSnapshot = await fs.stat(share.sourcePath).catch(() => null);
  if (existingSnapshot?.isFile()) {
    await copyFileToPath(share.sourcePath, backupPath);
  } else {
    await writeTextToPath(backupPath, content);
  }

  return backupPath;
}

export async function exportMarkdownShare({
  share,
  notesRoot,
  backupsRoot,
  content,
  now = new Date(),
}: ExportMarkdownShareInput): Promise<ExportMarkdownShareResult> {
  await assertWritableMarkdownTarget(notesRoot, share.sourcePath);

  const backupPath = await createBackup(share, backupsRoot, content, now);
  const sourceSnapshot = await readSourceSnapshot(share.sourcePath);
  const exportedHash = sha256Hex(content);

  if (hasSourceChangedExternally(share, sourceSnapshot)) {
    const conflictCopyPath = createMarkdownConflictPath(share.sourcePath, now);
    await writeTextToPath(conflictCopyPath, content);

    return {
      status: 'conflict',
      backupPath,
      conflictCopyPath,
      sourceSnapshot,
      exportedHash,
    };
  }

  await safeAtomicWriteTextFile(share.sourcePath, content);

  return {
    status: 'exported',
    backupPath,
    conflictCopyPath: null,
    sourceSnapshot,
    exportedHash,
  };
}

