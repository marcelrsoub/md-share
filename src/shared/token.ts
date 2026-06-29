import { randomBytes } from 'node:crypto';

const SHARE_TOKEN_BYTES = 32;

export function generateShareToken(bytes = SHARE_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

export function isShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43,}$/.test(token);
}

