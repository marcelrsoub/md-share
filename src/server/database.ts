import Database from 'better-sqlite3';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ParticipantRow, ShareRow } from '../shared/types.js';
import { SCHEMA_SQL } from './schema.js';

export type SqliteDatabase = Database.Database;

export async function openDatabase(databasePath: string): Promise<SqliteDatabase> {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function rowToShare(row: Record<string, unknown>): ShareRow {
  return {
    id: Number(row.id),
    token: String(row.token),
    noteId: String(row.note_id),
    noteName: String(row.note_name),
    noteRelativePath: String(row.note_relative_path),
    sourcePath: String(row.source_path),
    sourceRealPath: String(row.source_real_path),
    sourceHash: String(row.source_hash),
    sourceMtimeMs: Number(row.source_mtime_ms),
    yState: row.y_state instanceof Buffer ? row.y_state : Buffer.from(row.y_state as ArrayBuffer),
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
    lastExportedAt: row.last_exported_at == null ? null : Number(row.last_exported_at),
    lastExportedHash: row.last_exported_hash == null ? null : String(row.last_exported_hash),
    dirty: Number(row.dirty),
    conflict: Number(row.conflict),
    conflictCopyPath: row.conflict_copy_path == null ? null : String(row.conflict_copy_path),
    lastError: row.last_error == null ? null : String(row.last_error),
    updatedAt: Number(row.updated_at),
  };
}

export function rowToParticipant(row: Record<string, unknown>): ParticipantRow {
  return {
    id: Number(row.id),
    shareToken: String(row.share_token),
    connectionId: String(row.connection_id),
    displayName: String(row.display_name),
    joinedAt: Number(row.joined_at),
    lastSeenAt: Number(row.last_seen_at),
  };
}

