import type Database from 'better-sqlite3';
import { rowToParticipant, rowToSetting, rowToShare } from './database.js';
import type { ParticipantRow, ShareRow } from '../shared/types.js';

type ShareColumns = Record<string, unknown>;

export class DatabaseStore {
  private readonly getShareStatement;
  private readonly listSharesStatement;
  private readonly insertShareStatement;
  private readonly updateShareStatement;
  private readonly deleteShareStatement;
  private readonly listParticipantsStatement;
  private readonly upsertParticipantStatement;
  private readonly deleteParticipantStatement;
  private readonly countParticipantsStatement;
  private readonly getSettingStatement;
  private readonly upsertSettingStatement;
  private readonly deleteSettingStatement;

  constructor(private readonly db: Database.Database) {
    this.getShareStatement = db.prepare('SELECT * FROM shares WHERE token = ? LIMIT 1');
    this.listSharesStatement = db.prepare('SELECT * FROM shares ORDER BY created_at DESC');
    this.insertShareStatement = db.prepare(`
      INSERT INTO shares (
        token,
        note_id,
        note_name,
        note_relative_path,
        source_path,
        source_real_path,
        source_hash,
        source_mtime_ms,
        y_state,
        created_at,
        expires_at,
        revoked_at,
        last_exported_at,
        last_exported_hash,
        dirty,
        conflict,
        conflict_copy_path,
        last_error,
        updated_at
      ) VALUES (
        @token,
        @noteId,
        @noteName,
        @noteRelativePath,
        @sourcePath,
        @sourceRealPath,
        @sourceHash,
        @sourceMtimeMs,
        @yState,
        @createdAt,
        @expiresAt,
        @revokedAt,
        @lastExportedAt,
        @lastExportedHash,
        @dirty,
        @conflict,
        @conflictCopyPath,
        @lastError,
        @updatedAt
      )
    `);
    this.updateShareStatement = db.prepare('UPDATE shares SET source_hash = source_hash WHERE token = ?');
    this.deleteShareStatement = db.prepare('DELETE FROM shares WHERE token = ?');
    this.listParticipantsStatement = db.prepare('SELECT * FROM participants WHERE share_token = ? ORDER BY joined_at ASC');
    this.countParticipantsStatement = db.prepare('SELECT COUNT(*) AS count FROM participants WHERE share_token = ?');
    this.getSettingStatement = db.prepare('SELECT * FROM settings WHERE key = ? LIMIT 1');
    this.upsertSettingStatement = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (@key, @value)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value
    `);
    this.deleteSettingStatement = db.prepare('DELETE FROM settings WHERE key = ?');
    this.upsertParticipantStatement = db.prepare(`
      INSERT INTO participants (
        share_token,
        connection_id,
        display_name,
        joined_at,
        last_seen_at
      ) VALUES (
        @shareToken,
        @connectionId,
        @displayName,
        @joinedAt,
        @lastSeenAt
      )
      ON CONFLICT(share_token, connection_id) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at
    `);
    this.deleteParticipantStatement = db.prepare('DELETE FROM participants WHERE share_token = ? AND connection_id = ?');
  }

  getShare(token: string): ShareRow | null {
    const row = this.getShareStatement.get(token) as Record<string, unknown> | undefined;
    return row ? rowToShare(row) : null;
  }

  listShares(): ShareRow[] {
    return (this.listSharesStatement.all() as Record<string, unknown>[]).map(rowToShare);
  }

  insertShare(row: Omit<ShareRow, 'id'>): void {
    this.insertShareStatement.run({
      token: row.token,
      noteId: row.noteId,
      noteName: row.noteName,
      noteRelativePath: row.noteRelativePath,
      sourcePath: row.sourcePath,
      sourceRealPath: row.sourceRealPath,
      sourceHash: row.sourceHash,
      sourceMtimeMs: row.sourceMtimeMs,
      yState: row.yState,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      lastExportedAt: row.lastExportedAt,
      lastExportedHash: row.lastExportedHash,
      dirty: row.dirty,
      conflict: row.conflict,
      conflictCopyPath: row.conflictCopyPath,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    });
  }

  updateShare(token: string, columns: ShareColumns): void {
    const entries = Object.entries(columns).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }

    const assignments = entries.map(([column]) => `"${column}" = @${column}`).join(', ');
    const statement = this.db.prepare(`UPDATE shares SET ${assignments} WHERE token = @token`);
    statement.run({ token, ...Object.fromEntries(entries) });
  }

  deleteShare(token: string): void {
    this.deleteShareStatement.run(token);
  }

  listParticipants(token: string): ParticipantRow[] {
    return (this.listParticipantsStatement.all(token) as Record<string, unknown>[]).map(rowToParticipant);
  }

  countParticipants(token: string): number {
    const row = this.countParticipantsStatement.get(token) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  getSetting(key: string): string | null {
    const row = this.getSettingStatement.get(key) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return rowToSetting(row).value;
  }

  setSetting(key: string, value: string): void {
    this.upsertSettingStatement.run({ key, value });
  }

  deleteSetting(key: string): void {
    this.deleteSettingStatement.run(key);
  }

  upsertParticipant(participant: {
    shareToken: string;
    connectionId: string;
    displayName: string;
    joinedAt: number;
    lastSeenAt: number;
  }): void {
    this.upsertParticipantStatement.run(participant);
  }

  removeParticipant(shareToken: string, connectionId: string): void {
    this.deleteParticipantStatement.run(shareToken, connectionId);
  }
}
