import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function hashFile(filePath: string): Promise<string> {
  await fs.access(filePath);

  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

