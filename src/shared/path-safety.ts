import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { MarkdownFileEntry } from './types.js';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export interface MarkdownAssetResolution {
  realPath: string;
  contentType: string;
  size: number;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function isMarkdownPath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

function isGeneratedConflictCopyName(fileName: string): boolean {
  const baseName = path.basename(fileName, path.extname(fileName));
  return /\.conflict-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(baseName);
}

function isInsideRoot(rootRealPath: string, candidateRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidateRealPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function fileIdFromRealPath(realPath: string): string {
  return createHash('sha256').update(realPath).digest('hex');
}

function isImagePath(filePath: string): boolean {
  return Boolean(IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()]);
}

function imageMimeType(filePath: string): string | null {
  return IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

function normalizeMarkdownAssetPath(assetPath: string): string {
  return assetPath.trim().split(/[?#]/, 1)[0].trim();
}

function isPotentialUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//');
}

async function walkMarkdownFiles(
  rootRealPath: string,
  currentDirectory: string,
  results: MarkdownFileEntry[],
  query: string,
): Promise<void> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      await walkMarkdownFiles(rootRealPath, absolutePath, results, query);
      continue;
    }

    if (!entry.isFile() || !isMarkdownPath(entry.name)) {
      continue;
    }

    if (isGeneratedConflictCopyName(entry.name)) {
      continue;
    }

    const realPath = await fs.realpath(absolutePath).catch(() => null);
    if (!realPath || !isInsideRoot(rootRealPath, realPath)) {
      continue;
    }

    const stat = await fs.stat(realPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootRealPath, realPath);
    const name = path.basename(realPath);
    const haystack = `${name}\n${relativePath}`.toLowerCase();
    if (query && !haystack.includes(query)) {
      continue;
    }

    results.push({
      id: fileIdFromRealPath(realPath),
      name,
      relativePath,
      absolutePath,
      realPath,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
    });
  }
}

export async function scanMarkdownFiles(notesRoot: string, search = ''): Promise<MarkdownFileEntry[]> {
  const rootRealPath = await fs.realpath(notesRoot);
  const results: MarkdownFileEntry[] = [];
  const normalizedQuery = normalizeQuery(search);

  await walkMarkdownFiles(rootRealPath, rootRealPath, results, normalizedQuery);

  results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return results;
}

export async function findMarkdownFileById(notesRoot: string, noteId: string): Promise<MarkdownFileEntry | null> {
  const files = await scanMarkdownFiles(notesRoot);
  return files.find((file) => file.id === noteId) ?? null;
}

export async function assertExistingMarkdownFile(notesRoot: string, candidatePath: string): Promise<MarkdownFileEntry> {
  const rootRealPath = await fs.realpath(notesRoot);
  const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(rootRealPath, candidatePath);
  const realPath = await fs.realpath(absolutePath);

  if (!isInsideRoot(rootRealPath, realPath)) {
    throw new Error('Path escapes the notes root');
  }

  if (!isMarkdownPath(realPath)) {
    throw new Error('Only .md files can be shared');
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new Error('Markdown target is not a file');
  }

  return {
    id: fileIdFromRealPath(realPath),
    name: path.basename(realPath),
    relativePath: path.relative(rootRealPath, realPath),
    absolutePath,
    realPath,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

export async function assertWritableMarkdownTarget(notesRoot: string, targetPath: string): Promise<void> {
  const rootRealPath = await fs.realpath(notesRoot);
  const absolutePath = path.resolve(targetPath);
  const parentRealPath = await fs.realpath(path.dirname(absolutePath));

  if (!isInsideRoot(rootRealPath, parentRealPath)) {
    throw new Error('Write target escapes the notes root');
  }

  if (!isMarkdownPath(absolutePath)) {
    throw new Error('Only .md files can be written');
  }
}

export async function resolveMarkdownAsset(
  notesRoot: string,
  sourcePath: string,
  assetPath: string,
): Promise<MarkdownAssetResolution | null> {
  const normalizedAssetPath = normalizeMarkdownAssetPath(assetPath);
  if (!normalizedAssetPath || normalizedAssetPath.includes('\0') || isPotentialUrl(normalizedAssetPath)) {
    return null;
  }

  const rootRealPath = await fs.realpath(notesRoot);
  const sourceRealPath = await fs.realpath(sourcePath).catch(() => null);
  if (!sourceRealPath || !isInsideRoot(rootRealPath, sourceRealPath)) {
    return null;
  }

  const absolutePath = path.resolve(path.dirname(sourceRealPath), normalizedAssetPath);
  const realPath = await fs.realpath(absolutePath).catch(() => null);
  if (!realPath || !isInsideRoot(rootRealPath, realPath)) {
    return null;
  }

  const stat = await fs.stat(realPath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > MAX_IMAGE_BYTES || !isImagePath(realPath)) {
    return null;
  }

  const contentType = imageMimeType(realPath);
  if (!contentType) {
    return null;
  }

  return {
    realPath,
    contentType,
    size: stat.size,
  };
}

export function createMarkdownConflictPath(sourcePath: string, timestamp = new Date()): string {
  const dir = path.dirname(sourcePath);
  const ext = path.extname(sourcePath) || '.md';
  const base = path.basename(sourcePath, ext);
  const stamp = timestamp.toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${base}.conflict-${stamp}${ext}`);
}
