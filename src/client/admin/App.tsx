import { useEffect, useState } from 'react';
import type { NotePreview, NoteSummary, ShareSummary } from '../../shared/types.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, formatBytes, formatTimestamp, shareStatusLabel, shortToken, statusTone } from '../shared/api.js';

interface CreateShareResponse extends ShareSummary {}

interface ToastState {
  tone: 'success' | 'error';
  text: string;
  href?: string;
}

interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

interface NoteNode {
  type: 'note';
  note: NoteSummary;
}

type TreeNode = FolderNode | NoteNode;

interface FolderBranch {
  folders: Map<string, FolderBranch>;
  notes: NoteSummary[];
  path: string;
  name: string;
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4h9l4 4v12H7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16 4v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.75 7.75h5l1.8 1.8h9.7v8.7H3.75z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3.75 9.55V6.75h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="m16 16 4.25 4.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19.25 12a7.25 7.25 0 0 1-12.38 5.13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.75 12A7.25 7.25 0 0 1 17.13 6.87" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.75 4.75h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.25 19.25h-3v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.25 15.25h-.5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.25v10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m8.5 11.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RevokeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6 6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="m6 6 12 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15.5 8.5a2.75 2.75 0 1 0-2.75-2.75A2.75 2.75 0 0 0 15.5 8.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 14.75A2.75 2.75 0 1 0 4.25 12 2.75 2.75 0 0 0 7 14.75Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.5 20.25a2.75 2.75 0 1 0-2.75-2.75 2.75 2.75 0 0 0 2.75 2.75Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m9.45 10.8 3.6-2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m9.45 13.2 3.6 2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function buildNoteTree(notes: NoteSummary[]): TreeNode[] {
  const root: FolderBranch = {
    folders: new Map<string, FolderBranch>(),
    notes: [],
    path: '',
    name: '',
  };

  for (const note of notes) {
    const parts = note.relativePath.split('/');
    let branch = root;

    for (const segment of parts.slice(0, -1)) {
      const nextPath = branch.path ? `${branch.path}/${segment}` : segment;
      let next = branch.folders.get(segment);
      if (!next) {
        next = {
          folders: new Map<string, FolderBranch>(),
          notes: [],
          path: nextPath,
          name: segment,
        };
        branch.folders.set(segment, next);
      }
      branch = next;
    }

    branch.notes.push(note);
  }

  function toNodes(branch: FolderBranch): TreeNode[] {
    const folders = Array.from(branch.folders.values())
      .sort((left, right) => left.path.localeCompare(right.path))
      .map<TreeNode>((folder) => ({
        type: 'folder',
        name: folder.name,
        path: folder.path,
        children: toNodes(folder),
      }));

    const notes = [...branch.notes]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map<TreeNode>((note) => ({
        type: 'note',
        note,
      }));

    return [...folders, ...notes];
  }

  return toNodes(root);
}

function renderTreeNodes(
  nodes: TreeNode[],
  selectedNoteId: string | null,
  onSelect: (noteId: string) => void,
) {
  return (
    <div className="nav-tree">
      {nodes.map((node) =>
        node.type === 'folder' ? (
          <div key={node.path} className="nav-group">
            <div className="nav-row nav-folder">
              <span className="nav-icon">
                <FolderIcon />
              </span>
              <span>{node.name}</span>
            </div>
            {renderTreeNodes(node.children, selectedNoteId, onSelect)}
          </div>
        ) : (
          <button
            key={node.note.id}
            type="button"
            className={`nav-row nav-note${node.note.id === selectedNoteId ? ' is-selected' : ''}`}
            onClick={() => onSelect(node.note.id)}
          >
            <span className="nav-icon">
              <FileIcon />
            </span>
            <span className="nav-note-label">
              <span className="nav-note-name">{node.note.name}</span>
              <span className="nav-note-meta">{formatBytes(node.note.size)}</span>
            </span>
          </button>
        ),
      )}
    </div>
  );
}

export function AdminApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<NotePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [expiresInMinutes, setExpiresInMinutes] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const tree = buildNoteTree(notes);
  const selectedShares = shares.filter((share) => share.noteId === selectedNoteId);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const handle = window.setTimeout(() => {
      setToast(null);
    }, 4000);

    return () => window.clearTimeout(handle);
  }, [toast]);

  async function loadNotes(query = search): Promise<void> {
    setLoadingNotes(true);
    try {
      const params = query ? `?query=${encodeURIComponent(query)}` : '';
      const result = await fetchJson<NoteSummary[]>(`/api/admin/notes${params}`);
      setNotes(result);
      setSelectedNoteId((current) => {
        if (current && result.some((note) => note.id === current)) {
          return current;
        }

        return result[0]?.id ?? null;
      });
    } catch (loadError) {
      setToast({
        tone: 'error',
        text: loadError instanceof Error ? loadError.message : 'Failed to load notes',
      });
    } finally {
      setLoadingNotes(false);
    }
  }

  async function loadShares(): Promise<void> {
    setLoadingShares(true);
    try {
      const result = await fetchJson<ShareSummary[]>('/api/admin/shares');
      setShares(result);
    } catch (loadError) {
      setToast({
        tone: 'error',
        text: loadError instanceof Error ? loadError.message : 'Failed to load shares',
      });
    } finally {
      setLoadingShares(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadNotes(search);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    void loadNotes();
    void loadShares();
  }, []);

  useEffect(() => {
    setDocumentMetadata({
      title: 'MD Share Admin',
      description: 'Admin view for managing shared Markdown notes in MD Share.',
      robots: 'noindex,nofollow',
    });
  }, []);

  useEffect(() => {
    if (!selectedNoteId) {
      setSelectedPreview(null);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);
    fetchJson<NotePreview>(`/api/admin/notes/${encodeURIComponent(selectedNoteId)}/preview`)
      .then((preview) => {
        if (!cancelled) {
          setSelectedPreview(preview);
        }
      })
      .catch((previewError) => {
        if (!cancelled) {
          setToast({
            tone: 'error',
            text: previewError instanceof Error ? previewError.message : 'Failed to load preview',
          });
          setSelectedPreview(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNoteId]);

  async function createShare(): Promise<void> {
    if (!selectedNote) {
      setToast({
        tone: 'error',
        text: 'Select a Markdown file first.',
      });
      return;
    }

    setToast(null);

    try {
      const expires =
        expiresInMinutes.trim().length > 0 ? Number.parseInt(expiresInMinutes.trim(), 10) : null;
      const payload = {
        noteId: selectedNote.id,
        expiresInMinutes: Number.isFinite(expires as number) ? expires : null,
      };
      const created = await fetchJson<CreateShareResponse>('/api/admin/shares', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      await copyLink(created.shareUrl, {
        text: 'Share link copied.',
        href: created.shareUrl,
      });
      await loadShares();
    } catch (createError) {
      setToast({
        tone: 'error',
        text: createError instanceof Error ? createError.message : 'Failed to create share',
      });
    }
  }

  async function revokeShare(token: string): Promise<void> {
    setToast(null);
    try {
      await fetchJson<ShareSummary>(`/api/admin/shares/${token}/revoke`, {
        method: 'POST',
      });
      setToast({
        tone: 'success',
        text: `Revoked ${shortToken(token)}`,
      });
      await loadShares();
    } catch (revokeError) {
      setToast({
        tone: 'error',
        text: revokeError instanceof Error ? revokeError.message : 'Failed to revoke share',
      });
    }
  }

  async function exportShare(token: string): Promise<void> {
    setToast(null);
    try {
      const result = await fetchJson<{ status: string; backupPath: string; conflictCopyPath: string | null; exportedAt: number }>(
        `/api/admin/shares/${token}/export`,
        {
          method: 'POST',
        },
      );
      setToast({
        tone: 'success',
        text:
          result.status === 'conflict'
            ? `Conflict copy written to ${result.conflictCopyPath ?? 'unknown path'}`
            : `Exported at ${formatTimestamp(result.exportedAt)}`,
      });
      await loadShares();
    } catch (exportError) {
      setToast({
        tone: 'error',
        text: exportError instanceof Error ? exportError.message : 'Failed to export share',
      });
    }
  }

  async function copyLink(url: string, nextToast?: { text: string; href?: string }): Promise<void> {
    await navigator.clipboard.writeText(url);
    setToast({
      tone: 'success',
      text: nextToast?.text ?? 'Share link copied to clipboard.',
      href: nextToast?.href ?? url,
    });
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([loadNotes(), loadShares()]);
  }

  return (
    <div className="app-shell app-shell-admin">
      <div className="admin-topbar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <FileIcon />
          </span>
          <div>
            <div className="eyebrow">MD Share</div>
            <h1>Admin</h1>
          </div>
        </div>

        <label className="command-search" htmlFor="search-notes">
          <span className="command-icon">
            <SearchIcon />
          </span>
          <input
            id="search-notes"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files or folders"
          />
        </label>

        <div className="command-summary">
          <span>{notes.length} notes</span>
          <span>{shares.length} shares</span>
        </div>

        <button type="button" className="icon-button" onClick={() => void refreshAll()} aria-label="Refresh notes and shares">
          <RefreshIcon />
        </button>
      </div>

      {toast ? (
        <div className={`admin-toast notice-banner ${toast.tone === 'error' ? 'notice-error' : 'notice-success'}`}>
          <span>{toast.text}</span>
          {toast.href ? (
            <a className="toast-link mono" href={toast.href} target="_blank" rel="noreferrer">
              {toast.href}
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="page-grid admin-layout">
        <aside className="admin-sidebar panel panel-tight">
          <div className="sidebar-header">
            <div>
              <div className="eyebrow">Notes</div>
              <h2>Navigator</h2>
            </div>
            <span className="muted">{loadingNotes ? 'Refreshing...' : `${notes.length} results`}</span>
          </div>

          <div className="admin-nav-scroll">
            {notes.length > 0 ? (
              renderTreeNodes(tree, selectedNoteId, setSelectedNoteId)
            ) : (
              <div className="empty-state muted">No Markdown files found.</div>
            )}
          </div>
        </aside>

        <main className="admin-main">
          <section className="panel panel-tight command-strip">
            <div className="command-strip-main">
              <div className="command-selection">
                <div className="eyebrow">Selected note</div>
                <strong>{selectedNote?.name ?? 'Choose a note'}</strong>
                <span className="muted mono">{selectedNote?.relativePath ?? 'No file selected'}</span>
              </div>

              <label className="mini-field" htmlFor="expires-minutes">
                <span>Expires</span>
                <input
                  id="expires-minutes"
                  inputMode="numeric"
                  type="number"
                  min="1"
                  placeholder="Never"
                  value={expiresInMinutes}
                  onChange={(event) => setExpiresInMinutes(event.target.value)}
                />
              </label>

              <div className="command-actions">
                <button type="button" className="button-primary" onClick={() => void createShare()} disabled={!selectedNote}>
                  <ShareIcon />
                  <span>Create share</span>
                </button>
                <button type="button" className="button-ghost" onClick={() => void refreshAll()}>
                  <RefreshIcon />
                  <span>Refresh</span>
                </button>
              </div>
            </div>
          </section>

          <section className="admin-preview-grid">
            <section className="panel panel-tight preview-panel">
              <div className="preview-head">
                <div>
                  <div className="eyebrow">Peek</div>
                  <h2>{selectedPreview?.name ?? 'Preview'}</h2>
                </div>
                {selectedPreview ? (
                  <div className="preview-meta muted">
                    <span>{formatBytes(selectedPreview.size)}</span>
                    <span>{formatTimestamp(selectedPreview.modifiedAt)}</span>
                  </div>
                ) : null}
              </div>

              <div className="preview-sheet">
                {loadingPreview ? <p className="muted">Loading preview...</p> : null}
                {!loadingPreview && selectedPreview ? (
                  <pre className="note-peek">{selectedPreview.excerpt || '# Empty note'}</pre>
                ) : null}
                {!loadingPreview && !selectedPreview ? <p className="muted">Select a note to preview its content.</p> : null}
              </div>
            </section>

            <section className="panel panel-tight shares-panel">
              <div className="preview-head">
                <div>
                  <div className="eyebrow">Shares</div>
                  <h2>{selectedNote ? 'For this note' : 'Recent activity'}</h2>
                </div>
                <span className="muted">{loadingShares ? 'Refreshing...' : `${selectedShares.length} linked`}</span>
              </div>

              <div className="share-list-compact">
                {(selectedNote ? selectedShares : shares).map((share) => (
                  <article key={share.token} className="share-row-compact">
                    <div className="share-row-copy">
                      <div className="share-row-title">
                        <strong>{share.noteName}</strong>
                        <span className={`status-pill tone-${statusTone(share.status)}`}>
                          {shareStatusLabel(share.status)}
                        </span>
                      </div>
                      <div className="muted mono">{shortToken(share.token)}</div>
                      <div className="share-row-meta muted">
                        <span>{share.participantCount} active</span>
                        <span>Last export {formatTimestamp(share.lastExportedAt)}</span>
                      </div>
                    </div>

                    <div className="share-row-actions">
                      <button type="button" className="icon-button" onClick={() => void copyLink(share.shareUrl)} aria-label="Copy share link">
                        <CopyIcon />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void exportShare(share.token)} aria-label="Export note">
                        <ExportIcon />
                      </button>
                      <button type="button" className="icon-button danger-button" onClick={() => void revokeShare(share.token)} aria-label="Revoke share">
                        <RevokeIcon />
                      </button>
                    </div>
                  </article>
                ))}

                {(selectedNote ? selectedShares : shares).length === 0 ? (
                  <div className="empty-state muted">{selectedNote ? 'No shares for this note yet.' : 'No shares yet.'}</div>
                ) : null}
              </div>
            </section>
          </section>
        </main>
      </div>
    </div>
  );
}
