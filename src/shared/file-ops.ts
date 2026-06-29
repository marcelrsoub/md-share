import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

export async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

export async function safeAtomicWriteTextFile(targetPath: string, content: string): Promise<void> {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(directory, `${path.basename(targetPath)}.${randomUUID()}.tmp`);

  await ensureDirectory(directory);
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, targetPath);
}

export async function copyFileToPath(sourcePath: string, targetPath: string): Promise<void> {
  const directory = path.dirname(targetPath);
  await ensureDirectory(directory);
  await fs.copyFile(sourcePath, targetPath);
}

export async function writeTextToPath(targetPath: string, content: string): Promise<void> {
  const directory = path.dirname(targetPath);
  await ensureDirectory(directory);
  await fs.writeFile(targetPath, content, 'utf8');
}

