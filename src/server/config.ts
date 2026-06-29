import path from 'node:path';

export interface AppConfig {
  notesDir: string;
  dataDir: string;
  databasePath: string;
  backupsDir: string;
  adminPort: number;
  publicPort: number;
  adminBaseUrl: string;
  publicBaseUrl: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env): AppConfig {
  const notesDir = path.resolve(env.NOTES_DIR ?? '/notes');
  const dataDir = path.resolve(env.DATA_DIR ?? '/data');
  const adminPort = parsePort(env.ADMIN_PORT, 3020);
  const publicPort = parsePort(env.PUBLIC_PORT, 3021);
  const adminBaseUrl = env.ADMIN_BASE_URL ?? `http://localhost:${adminPort}`;
  const publicBaseUrl = env.PUBLIC_BASE_URL ?? `http://localhost:${publicPort}`;

  return {
    notesDir,
    dataDir,
    databasePath: path.join(dataDir, 'md-share.sqlite'),
    backupsDir: path.join(dataDir, 'backups'),
    adminPort,
    publicPort,
    adminBaseUrl,
    publicBaseUrl,
  };
}

