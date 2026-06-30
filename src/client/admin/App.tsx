import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Copy,
  Download,
  ChevronRight,
  FileText,
  Folder,
  RotateCcw,
  Search,
  Share2,
} from 'lucide-react';
import type { NotePreview, NoteSummary, ShareSummary } from '../../shared/types.js';
import { copyTextToClipboard } from '../shared/clipboard.js';
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

export function buildNoteTree(notes: NoteSummary[]): TreeNode[] {
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

export function getFolderAncestors(relativePath: string): string[] {
  const segments = relativePath.split('/').filter(Boolean);

  if (segments.length <= 1) {
    return [];
  }

  const ancestors: string[] = [];

  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join('/'));
  }

  return ancestors;
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelect: (noteId: string) => void;
  selectedNoteId: string | null;
}

function TreeNodeView({
  node,
  depth,
  expandedFolders,
  onToggleFolder,
  onSelect,
  selectedNoteId,
}: TreeNodeViewProps) {
  if (node.type === 'folder') {
    const isExpanded = expandedFolders.has(node.path);

    return (
      <div className="nav-group">
        <button
          type="button"
          className={`nav-row nav-folder${isExpanded ? ' is-expanded' : ''}`}
          onClick={() => onToggleFolder(node.path)}
          aria-expanded={isExpanded}
          title={node.path}
          style={{ paddingLeft: `${0.56 + depth * 0.72}rem` }}
        >
          <span className="nav-toggle">
            <ChevronRight />
          </span>
          <span className="nav-icon">
            <Folder />
          </span>
          <span className="nav-folder-name">{node.name}</span>
          <span className="nav-row-meta muted">{node.children.length} {node.children.length === 1 ? 'item' : 'items'}</span>
        </button>

        {isExpanded ? (
          <div className="nav-children">
            {node.children.map((child) => (
              <TreeNodeView
                key={child.type === 'folder' ? child.path : child.note.id}
                node={child}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelect={onSelect}
                selectedNoteId={selectedNoteId}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const isSelected = node.note.id === selectedNoteId;

  return (
    <button
      type="button"
      className={`nav-row nav-note${isSelected ? ' is-selected' : ''}`}
      onClick={() => onSelect(node.note.id)}
      title={node.note.relativePath}
      style={{ paddingLeft: `${0.56 + depth * 0.72}rem` }}
    >
      <span className="nav-toggle nav-toggle-spacer" aria-hidden="true" />
      <span className="nav-icon">
        <FileText />
      </span>
      <span className="nav-note-label">{node.note.name}</span>
      <span className="nav-row-meta nav-note-meta">{formatBytes(node.note.size)}</span>
    </button>
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const tree = useMemo(() => buildNoteTree(notes), [notes]);
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

  useEffect(() => {
    if (!selectedNote) {
      return;
    }

    const ancestors = getFolderAncestors(selectedNote.relativePath);
    if (ancestors.length === 0) {
      return;
    }

    setExpandedFolders((current) => {
      const next = new Set(current);
      let changed = false;

      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [selectedNote?.relativePath]);

  function toggleFolder(path: string): void {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

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
    const result = await copyTextToClipboard(url);
    setToast({
      tone: 'success',
      text: result.copied
        ? nextToast?.text ?? 'Share link copied to clipboard.'
        : nextToast?.text ?? 'Share created. Clipboard access is not available here.',
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
            <FileText />
          </span>
          <div>
            <div className="eyebrow">MD Share</div>
            <h1>Admin</h1>
          </div>
        </div>

        <label className="command-search" htmlFor="search-notes">
          <span className="command-icon">
            <Search />
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
          <RotateCcw />
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
              <div className="nav-tree">
                {tree.map((node) => (
                  <TreeNodeView
                    key={node.type === 'folder' ? node.path : node.note.id}
                    node={node}
                    depth={0}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                    onSelect={setSelectedNoteId}
                    selectedNoteId={selectedNoteId}
                  />
                ))}
              </div>
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
                  <Share2 />
                  <span>Create share</span>
                </button>
                <button type="button" className="button-ghost" onClick={() => void refreshAll()}>
                  <RotateCcw />
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
                        <Copy />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void exportShare(share.token)} aria-label="Export note">
                        <Download />
                      </button>
                      <button type="button" className="icon-button danger-button" onClick={() => void revokeShare(share.token)} aria-label="Revoke share">
                        <Ban />
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
