import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { WebSocket } from 'ws';
import { ensureDirectory } from '../shared/file-ops.js';
import { generateShareToken, isShareToken } from '../shared/token.js';
import { hashFile, sha256Hex } from '../shared/hash.js';
import {
  findMarkdownFileById,
  scanMarkdownFiles,
} from '../shared/path-safety.js';
import type {
  MarkdownFileEntry,
  NotePreview,
  NoteSummary,
  ParticipantRow,
  PublicShareInfo,
  ShareRow,
  ShareStatus,
  ShareSummary,
} from '../shared/types.js';
import type { AppConfig } from './config.js';
import type { SqliteDatabase } from './database.js';
import { DatabaseStore } from './store.js';
import { exportMarkdownShare, hasSourceChangedExternally, readSourceSnapshot } from './export.js';

const DOC_NAME = 'content';
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const EXPIRATION_SWEEP_MS = 30 * 1000;
const PERSIST_DEBOUNCE_MS = 500;

type UpdateOrigin = string | { source: 'db' | 'persist' | 'export' | 'ws'; connectionId?: string };

interface RuntimeClient {
  connectionId: string;
  socket: WebSocket;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
}

interface RuntimeState {
  row: ShareRow;
  doc: Y.Doc;
  text: Y.Text;
  clients: Map<string, RuntimeClient>;
  persistTimer: NodeJS.Timeout | null;
  isPersisting: boolean;
  pendingPersist: boolean;
  exportInFlight: Promise<unknown> | null;
}

interface CreateShareInput {
  noteId: string;
  expiresAt?: number | null;
}

interface ShareSocketMessage {
  type: string;
  [key: string]: unknown;
}

function nowMs(): number {
  return Date.now();
}

function clampDisplayName(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'Anonymous';
  }

  return cleaned.slice(0, 64);
}

function decodeUpdate(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function encodeUpdate(update: Uint8Array): string {
  return Buffer.from(update).toString('base64');
}

function isExpired(row: ShareRow, timestamp = nowMs()): boolean {
  return row.expiresAt != null && row.expiresAt <= timestamp;
}

function computeShareStatus(row: ShareRow, timestamp = nowMs()): ShareStatus {
  if (row.revokedAt != null) {
    return 'revoked';
  }

  if (isExpired(row, timestamp)) {
    return 'expired';
  }

  if (row.conflict) {
    return 'conflict';
  }

  if (row.dirty) {
    return 'dirty';
  }

  return 'active';
}

function isCollaborativeShareStatus(status: ShareStatus): boolean {
  return status === 'active' || status === 'dirty';
}

function summarizeShare(row: ShareRow, participantCount: number, publicBaseUrl: string): ShareSummary {
  return {
    token: row.token,
    noteId: row.noteId,
    noteName: row.noteName,
    noteRelativePath: row.noteRelativePath,
    status: computeShareStatus(row),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    lastExportedAt: row.lastExportedAt,
    participantCount,
    shareUrl: new URL(`/s/${row.token}`, publicBaseUrl).toString(),
  };
}

function sanitizeParticipantNames(participants: Iterable<RuntimeClient>): string[] {
  const unique = new Set<string>();
  for (const participant of participants) {
    unique.add(participant.displayName);
  }

  return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

function runtimeToText(runtime: RuntimeState): string {
  return runtime.text.toString();
}

function yStateToText(snapshot: Buffer): string {
  const doc = new Y.Doc();
  if (snapshot.length > 0) {
    Y.applyUpdate(doc, snapshot, { source: 'db' });
  }
  return doc.getText(DOC_NAME).toString();
}

function isIgnoredUpdateOrigin(origin: UpdateOrigin | undefined): boolean {
  if (typeof origin === 'string') {
    return origin === 'db' || origin === 'persist' || origin === 'export';
  }

  return origin?.source === 'db' || origin?.source === 'persist' || origin?.source === 'export';
}

function getSenderConnectionId(origin: UpdateOrigin | undefined): string | null {
  if (typeof origin === 'object' && origin) {
    return origin.connectionId ?? null;
  }

  return null;
}

function sendJson(socket: WebSocket, payload: ShareSocketMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export class MdShareService {
  private readonly dbStore: DatabaseStore;
  private readonly runtimes = new Map<string, RuntimeState>();
  private readonly autosaveTimer: NodeJS.Timeout;
  private readonly expirationSweepTimer: NodeJS.Timeout;
  private isClosing = false;

  private constructor(
    private readonly config: AppConfig,
    private readonly db: SqliteDatabase,
    private readonly notesRootRealPath: string,
  ) {
    this.dbStore = new DatabaseStore(db);
    this.autosaveTimer = setInterval(() => {
      void this.exportDirtyShares('interval');
    }, FIVE_MINUTES_MS);
    this.expirationSweepTimer = setInterval(() => {
      void this.closeExpiredSessions();
    }, EXPIRATION_SWEEP_MS);
    this.autosaveTimer.unref?.();
    this.expirationSweepTimer.unref?.();
  }

  static async create(config: AppConfig, db: SqliteDatabase): Promise<MdShareService> {
    await ensureDirectory(config.notesDir);
    await ensureDirectory(config.dataDir);
    await ensureDirectory(config.backupsDir);

    const notesRootRealPath = await fs.realpath(config.notesDir);
    return new MdShareService(config, db, notesRootRealPath);
  }

  close(): void {
    this.isClosing = true;
    clearInterval(this.autosaveTimer);
    clearInterval(this.expirationSweepTimer);
    this.db.close();
  }

  async listNotes(search = ''): Promise<NoteSummary[]> {
    const files = await scanMarkdownFiles(this.notesRootRealPath, search);
    return files.map((file) => ({
      id: file.id,
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
    }));
  }

  async getNotePreview(noteId: string): Promise<NotePreview | null> {
    const note = await findMarkdownFileById(this.notesRootRealPath, noteId);
    if (!note) {
      return null;
    }

    const sourceText = await fs.readFile(note.realPath, 'utf8');
    const excerpt = sourceText
      .split(/\r?\n/)
      .slice(0, 24)
      .join('\n')
      .slice(0, 2_400)
      .trimEnd();

    return {
      id: note.id,
      name: note.name,
      relativePath: note.relativePath,
      modifiedAt: note.modifiedAt,
      size: note.size,
      excerpt,
    };
  }

  async createShare(input: CreateShareInput): Promise<ShareSummary> {
    const note = await findMarkdownFileById(this.notesRootRealPath, input.noteId);
    if (!note) {
      throw new Error('Markdown note not found');
    }

    const existingShares = this.dbStore.listShares();
    for (const existingShare of existingShares) {
      if (existingShare.noteId !== note.id) {
        continue;
      }

      const refreshedShare = await this.refreshShareFromDisk(existingShare);
      if (!isCollaborativeShareStatus(computeShareStatus(refreshedShare))) {
        continue;
      }

      this.ensureRuntime(refreshedShare);
      return summarizeShare(
        refreshedShare,
        this.dbStore.countParticipants(refreshedShare.token),
        this.config.publicBaseUrl,
      );
    }

    const sourceText = await fs.readFile(note.realPath, 'utf8');
    const sourceHash = await hashFile(note.realPath);
    const createdAt = nowMs();
    const token = generateShareToken();
    const doc = new Y.Doc();
    doc.getText(DOC_NAME).insert(0, sourceText);
    const yState = Buffer.from(Y.encodeStateAsUpdate(doc));

    const row: Omit<ShareRow, 'id'> = {
      token,
      noteId: note.id,
      noteName: note.name,
      noteRelativePath: note.relativePath,
      sourcePath: note.realPath,
      sourceRealPath: note.realPath,
      sourceHash,
      sourceMtimeMs: note.modifiedAt,
      yState,
      createdAt,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastExportedAt: null,
      lastExportedHash: null,
      dirty: 0,
      conflict: 0,
      conflictCopyPath: null,
      lastError: null,
      updatedAt: createdAt,
    };

    this.dbStore.insertShare(row);
    const saved = this.dbStore.getShare(token);
    if (!saved) {
      throw new Error('Failed to load newly created share');
    }

    this.createRuntime(saved);
    return summarizeShare(saved, 0, this.config.publicBaseUrl);
  }

  async listShares(): Promise<ShareSummary[]> {
    const rows = this.dbStore.listShares();
    const refreshed: ShareSummary[] = [];

    for (const row of rows) {
      const current = await this.refreshShareFromDisk(row);
      const participantCount = this.dbStore.countParticipants(current.token);
      refreshed.push(summarizeShare(current, participantCount, this.config.publicBaseUrl));
    }

    refreshed.sort((left, right) => right.createdAt - left.createdAt);
    return refreshed;
  }

  async revokeShare(token: string): Promise<ShareSummary> {
    const row = await this.requireShare(token);
    const revokedAt = nowMs();
    this.dbStore.updateShare(token, {
      revoked_at: revokedAt,
      updated_at: revokedAt,
    });

    const runtime = this.runtimes.get(token);
    if (runtime) {
      runtime.row = {
        ...runtime.row,
        revokedAt,
        updatedAt: revokedAt,
      };
      for (const client of runtime.clients.values()) {
        sendJson(client.socket, {
          type: 'status',
          status: 'revoked',
          lastExportedAt: runtime.row.lastExportedAt,
          participantNames: sanitizeParticipantNames(runtime.clients.values()),
        });
        client.socket.close(4403, 'share revoked');
      }
    }

    const updated = this.dbStore.getShare(token) ?? { ...row, revokedAt };
    return summarizeShare(updated, 0, this.config.publicBaseUrl);
  }

  async getPublicShareInfo(token: string): Promise<PublicShareInfo | null> {
    const row = await this.dbStore.getShare(token);
    if (!row) {
      return null;
    }

    const refreshed = await this.refreshShareFromDisk(row);
    const runtime = this.runtimes.get(token);
    const participantNames = runtime ? sanitizeParticipantNames(runtime.clients.values()) : this.dbStore.listParticipants(token).map((row) => row.displayName);

    return {
      token: refreshed.token,
      noteName: refreshed.noteName,
      status: computeShareStatus(refreshed),
      expiresAt: refreshed.expiresAt,
      lastExportedAt: refreshed.lastExportedAt,
      participantNames,
    };
  }

  async exportShare(token: string, reason: 'manual' | 'interval' | 'disconnect'): Promise<{
    status: 'exported' | 'conflict';
    backupPath: string;
    conflictCopyPath: string | null;
    exportedAt: number;
  }> {
    const row = await this.requireShare(token);
    if (row.revokedAt != null) {
      throw new Error('This share has been revoked');
    }

    const runtime = this.runtimes.get(token);
    if (runtime) {
      await this.persistRuntimeNow(runtime);
    }

    const freshRow = await this.refreshShareFromDisk(row);
    const content = runtime ? runtimeToText(runtime) : yStateToText(freshRow.yState);

    const result = await exportMarkdownShare({
      share: freshRow,
      notesRoot: this.notesRootRealPath,
      backupsRoot: this.config.backupsDir,
      content,
    });

    const exportedAt = nowMs();
    const yState = runtime
      ? Buffer.from(Y.encodeStateAsUpdate(runtime.doc))
      : freshRow.yState;

    if (result.status === 'exported') {
      const sourceSnapshot = result.sourceSnapshot ?? (await readSourceSnapshot(freshRow.sourcePath));
      const currentRealPath = sourceSnapshot?.realPath ?? freshRow.sourceRealPath;
      const currentMtime = sourceSnapshot?.mtimeMs ?? freshRow.sourceMtimeMs;
      this.dbStore.updateShare(token, {
        y_state: yState,
        source_hash: result.exportedHash,
        source_real_path: currentRealPath,
        source_mtime_ms: currentMtime,
        last_exported_at: exportedAt,
        last_exported_hash: result.exportedHash,
        dirty: 0,
        conflict: 0,
        conflict_copy_path: null,
        last_error: null,
        updated_at: exportedAt,
      });
    } else {
      this.dbStore.updateShare(token, {
        y_state: yState,
        last_exported_at: exportedAt,
        last_exported_hash: result.exportedHash,
        conflict: 1,
        dirty: 1,
        conflict_copy_path: result.conflictCopyPath,
        last_error: 'Source changed externally; wrote conflict copy instead',
        updated_at: exportedAt,
      });
    }

    const updatedRow = this.dbStore.getShare(token) ?? freshRow;
    const updatedRuntime = this.runtimes.get(token);
    if (updatedRuntime) {
      updatedRuntime.row = updatedRow;
    }
    this.broadcastShareState(token);

    return {
      status: result.status,
      backupPath: result.backupPath,
      conflictCopyPath: result.conflictCopyPath,
      exportedAt,
    };
  }

  async getPublicSnapshotToken(token: string): Promise<{ exists: boolean; active: boolean }> {
    const row = await this.dbStore.getShare(token);
    if (!row) {
      return { exists: false, active: false };
    }

    const refreshed = await this.refreshShareFromDisk(row);
    return { exists: true, active: isCollaborativeShareStatus(computeShareStatus(refreshed)) };
  }

  async handleWebSocketConnection(socket: WebSocket, token: string): Promise<void> {
    if (!isShareToken(token)) {
      socket.close(4401, 'invalid token');
      return;
    }

    const row = await this.dbStore.getShare(token);
    if (!row) {
      socket.close(4404, 'share not found');
      return;
    }

    const pendingMessages: Array<Buffer | ArrayBuffer | Buffer[]> = [];
    let runtime: RuntimeState | null = null;
    let session: RuntimeClient | null = null;
    let closed = false;

    const cleanupIfNeeded = (): void => {
      if (closed) {
        return;
      }

      closed = true;
      if (runtime && session) {
        void this.handleSocketClose(runtime, session);
      }
    };

    socket.on('message', (raw) => {
      if (closed) {
        return;
      }

      if (!runtime || !session) {
        pendingMessages.push(raw);
        return;
      }

      void this.handleSocketMessage(runtime, session, raw);
    });

    socket.on('close', cleanupIfNeeded);
    socket.on('error', cleanupIfNeeded);

    const refreshed = await this.refreshShareFromDisk(row);
    if (closed) {
      return;
    }

    if (!isCollaborativeShareStatus(computeShareStatus(refreshed))) {
      socket.close(4401, 'share unavailable');
      return;
    }

    runtime = this.ensureRuntime(refreshed);
    const connectionId = randomUUID();
    session = {
      connectionId,
      socket,
      displayName: 'Anonymous',
      joinedAt: nowMs(),
      lastSeenAt: nowMs(),
    };

    this.sendSnapshot(runtime, socket);

    for (const raw of pendingMessages) {
      void this.handleSocketMessage(runtime, session, raw);
    }
  }

  async closeExpiredSessions(): Promise<void> {
    const rows = this.dbStore.listShares();
    for (const row of rows) {
      if (row.revokedAt != null || !isExpired(row)) {
        continue;
      }

      const runtime = this.runtimes.get(row.token);
      if (!runtime) {
        continue;
      }

      for (const client of runtime.clients.values()) {
        client.socket.close(4401, 'share expired');
      }
    }
  }

  async exportDirtyShares(trigger: 'interval' | 'manual' | 'disconnect'): Promise<void> {
    const rows = this.dbStore.listShares();
    for (const row of rows) {
      if (row.revokedAt != null || row.dirty === 0) {
        continue;
      }

      await this.exportShare(row.token, trigger);
    }
  }

  private ensureRuntime(row: ShareRow): RuntimeState {
    const existing = this.runtimes.get(row.token);
    if (existing) {
      existing.row = row;
      return existing;
    }

    return this.createRuntime(row);
  }

  private createRuntime(row: ShareRow): RuntimeState {
    const doc = new Y.Doc();
    if (row.yState.length > 0) {
      Y.applyUpdate(doc, row.yState, { source: 'db' });
    }

    const runtime: RuntimeState = {
      row,
      doc,
      text: doc.getText(DOC_NAME),
      clients: new Map<string, RuntimeClient>(),
      persistTimer: null,
      isPersisting: false,
      pendingPersist: false,
      exportInFlight: null,
    };

    doc.on('update', (update, origin) => {
      if (isIgnoredUpdateOrigin(origin as UpdateOrigin | undefined)) {
        return;
      }

      runtime.row = {
        ...runtime.row,
        dirty: 1,
        updatedAt: nowMs(),
      };
      this.dbStore.updateShare(runtime.row.token, {
        dirty: 1,
        updated_at: runtime.row.updatedAt,
        last_error: null,
      });

      this.schedulePersist(runtime);
      const senderConnectionId = getSenderConnectionId(origin as UpdateOrigin | undefined);
      this.broadcastUpdate(runtime, update, senderConnectionId);
      this.broadcastShareState(runtime.row.token);
    });

    this.runtimes.set(row.token, runtime);
    return runtime;
  }

  private schedulePersist(runtime: RuntimeState): void {
    if (runtime.persistTimer) {
      clearTimeout(runtime.persistTimer);
    }

    runtime.persistTimer = setTimeout(() => {
      runtime.persistTimer = null;
      void this.persistRuntimeNow(runtime);
    }, PERSIST_DEBOUNCE_MS);
    runtime.persistTimer.unref?.();
  }

  private async persistRuntimeNow(runtime: RuntimeState): Promise<void> {
    if (runtime.isPersisting) {
      runtime.pendingPersist = true;
      return;
    }

    runtime.isPersisting = true;
    try {
      const snapshot = Buffer.from(Y.encodeStateAsUpdate(runtime.doc));
      const updatedAt = nowMs();
      this.dbStore.updateShare(runtime.row.token, {
        y_state: snapshot,
        updated_at: updatedAt,
      });
      runtime.row = {
        ...runtime.row,
        yState: snapshot,
        updatedAt,
      };
    } finally {
      runtime.isPersisting = false;
      if (runtime.pendingPersist) {
        runtime.pendingPersist = false;
        await this.persistRuntimeNow(runtime);
      }
    }
  }

  private async refreshShareFromDisk(row: ShareRow): Promise<ShareRow> {
    if (row.revokedAt != null) {
      return row;
    }

    const snapshot = await readSourceSnapshot(row.sourcePath);
    const updatedAt = nowMs();

    if (!snapshot) {
      if (!row.conflict || row.lastError !== 'Source file missing') {
        this.dbStore.updateShare(row.token, {
          conflict: 1,
          last_error: 'Source file missing',
          updated_at: updatedAt,
        });
      }

      return {
        ...row,
        conflict: 1,
        lastError: 'Source file missing',
        updatedAt,
      };
    }

    if (hasSourceChangedExternally(row, snapshot)) {
      if (!row.conflict || row.lastError !== 'Source changed externally') {
        this.dbStore.updateShare(row.token, {
          conflict: 1,
          last_error: 'Source changed externally',
          updated_at: updatedAt,
        });
      }

      return {
        ...row,
        conflict: 1,
        lastError: 'Source changed externally',
        updatedAt,
      };
    }

    const updates: Record<string, unknown> = {};
    if (row.conflict || row.lastError) {
      updates.conflict = 0;
      updates.last_error = null;
    }
    if (row.sourceMtimeMs !== snapshot.mtimeMs) {
      updates.source_mtime_ms = snapshot.mtimeMs;
    }
    if (row.sourceRealPath !== snapshot.realPath) {
      updates.source_real_path = snapshot.realPath;
    }
    if (Object.keys(updates).length > 0) {
      updates.updated_at = updatedAt;
      this.dbStore.updateShare(row.token, updates);
      return {
        ...row,
        conflict: 0,
        lastError: null,
        sourceMtimeMs: snapshot.mtimeMs,
        sourceRealPath: snapshot.realPath,
        updatedAt,
      };
    }

    return row;
  }

  private async requireShare(token: string): Promise<ShareRow> {
    const row = this.dbStore.getShare(token);
    if (!row) {
      throw new Error('Share not found');
    }

    return row;
  }

  private persistParticipantJoin(runtime: RuntimeState, session: RuntimeClient): void {
    this.dbStore.upsertParticipant({
      shareToken: runtime.row.token,
      connectionId: session.connectionId,
      displayName: session.displayName,
      joinedAt: session.joinedAt,
      lastSeenAt: session.lastSeenAt,
    });
    this.broadcastShareState(runtime.row.token);
  }

  private persistParticipantLeave(runtime: RuntimeState, session: RuntimeClient): void {
    this.dbStore.removeParticipant(runtime.row.token, session.connectionId);
    this.broadcastShareState(runtime.row.token);
  }

  private sendSnapshot(runtime: RuntimeState, socket: WebSocket): void {
    sendJson(socket, {
      type: 'snapshot',
      update: encodeUpdate(Buffer.from(Y.encodeStateAsUpdate(runtime.doc))),
      participantNames: sanitizeParticipantNames(runtime.clients.values()),
      status: computeShareStatus(runtime.row),
      lastExportedAt: runtime.row.lastExportedAt,
    });
  }

  private broadcastUpdate(runtime: RuntimeState, update: Uint8Array, senderConnectionId: string | null): void {
    const payload = {
      type: 'update',
      update: encodeUpdate(update),
    };

    for (const client of runtime.clients.values()) {
      if (senderConnectionId && client.connectionId === senderConnectionId) {
        continue;
      }
      sendJson(client.socket, payload);
    }
  }

  private broadcastShareState(token: string): void {
    const runtime = this.runtimes.get(token);
    const row = this.dbStore.getShare(token);
    if (!row) {
      return;
    }

    const participantNames = runtime
      ? sanitizeParticipantNames(runtime.clients.values())
      : this.dbStore.listParticipants(token).map((participant) => participant.displayName);

    const payload = {
      type: 'state',
      status: computeShareStatus(row),
      lastExportedAt: row.lastExportedAt,
      participantNames,
      dirty: Boolean(row.dirty),
      conflict: Boolean(row.conflict),
    };

    if (runtime) {
      for (const client of runtime.clients.values()) {
        sendJson(client.socket, payload);
      }
    }
  }

  private async handleSocketMessage(runtime: RuntimeState, session: RuntimeClient, raw: Buffer | ArrayBuffer | Buffer[]): Promise<void> {
    let text = '';
    if (Buffer.isBuffer(raw)) {
      text = raw.toString('utf8');
    } else if (raw instanceof ArrayBuffer) {
      text = Buffer.from(raw).toString('utf8');
    } else {
      text = Buffer.concat(raw).toString('utf8');
    }

    let message: ShareSocketMessage | null = null;
    try {
      message = JSON.parse(text) as ShareSocketMessage;
    } catch {
      return;
    }

    if (message.type === 'hello') {
      const displayName = clampDisplayName(String(message.displayName ?? 'Anonymous'));
      session.displayName = displayName;
      session.lastSeenAt = nowMs();
      if (!runtime.clients.has(session.connectionId)) {
        runtime.clients.set(session.connectionId, session);
        this.persistParticipantJoin(runtime, session);
      } else {
        this.dbStore.upsertParticipant({
          shareToken: runtime.row.token,
          connectionId: session.connectionId,
          displayName,
          joinedAt: session.joinedAt,
          lastSeenAt: session.lastSeenAt,
        });
      }
      this.broadcastShareState(runtime.row.token);
      sendJson(session.socket, {
        type: 'ready',
        participantNames: sanitizeParticipantNames(runtime.clients.values()),
        status: computeShareStatus(runtime.row),
      });
      return;
    }

    if (message.type === 'update') {
      const updateBase64 = String(message.update ?? '');
      if (!updateBase64) {
        return;
      }

      const update = decodeUpdate(updateBase64);
      Y.applyUpdate(runtime.doc, update, { source: 'ws', connectionId: session.connectionId });
      session.lastSeenAt = nowMs();
      this.dbStore.upsertParticipant({
        shareToken: runtime.row.token,
        connectionId: session.connectionId,
        displayName: session.displayName,
        joinedAt: session.joinedAt,
        lastSeenAt: session.lastSeenAt,
      });
      return;
    }

    if (message.type === 'ping') {
      sendJson(session.socket, { type: 'pong', timestamp: nowMs() });
    }
  }

  private handleSocketClose(runtime: RuntimeState, session: RuntimeClient): void {
    if (this.isClosing) {
      return;
    }

    if (!runtime.clients.has(session.connectionId)) {
      return;
    }

    runtime.clients.delete(session.connectionId);
    this.persistParticipantLeave(runtime, session);

    if (runtime.clients.size === 0 && runtime.row.revokedAt == null) {
      void this.exportShare(runtime.row.token, 'disconnect').catch(() => {
        // The admin surface can recover from a failed export on the next manual request.
      });
    }
  }
}
