export type ShareStatus = 'active' | 'expired' | 'revoked' | 'dirty' | 'conflict';

export interface NoteSummary {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: number;
}

export interface NotePreview {
  id: string;
  name: string;
  relativePath: string;
  modifiedAt: number;
  size: number;
  excerpt: string;
}

export interface ShareSummary {
  token: string;
  noteId: string;
  noteName: string;
  noteRelativePath: string;
  status: ShareStatus;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  lastExportedAt: number | null;
  participantCount: number;
  shareUrl: string;
}

export interface PublicShareInfo {
  token: string;
  noteName: string;
  status: ShareStatus;
  expiresAt: number | null;
  lastExportedAt: number | null;
  participantNames: string[];
}

export interface MarkdownFileEntry {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  realPath: string;
  size: number;
  modifiedAt: number;
}

export interface ShareRow {
  id: number;
  token: string;
  noteId: string;
  noteName: string;
  noteRelativePath: string;
  sourcePath: string;
  sourceRealPath: string;
  sourceHash: string;
  sourceMtimeMs: number;
  yState: Buffer;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastExportedAt: number | null;
  lastExportedHash: string | null;
  dirty: number;
  conflict: number;
  conflictCopyPath: string | null;
  lastError: string | null;
  updatedAt: number;
}

export interface ParticipantRow {
  id: number;
  shareToken: string;
  connectionId: string;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
}
