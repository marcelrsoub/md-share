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
  Settings2,
  Share2,
} from 'lucide-react';
import type { AdminConfig, NotePreview, NoteSummary, ShareSummary } from '../../shared/types.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card.js';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { Separator } from '../components/ui/separator.js';
import { Toaster, toast } from '../components/ui/sonner.js';
import { MarkdownPreview } from '../components/markdown-preview.js';
import { copyTextToClipboard } from '../shared/clipboard.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, formatBytes, formatTimestamp, shareStatusLabel, shortToken, statusTone } from '../shared/api.js';

interface CreateShareResponse extends ShareSummary {}

function buildAdminAssetUrl(noteId: string, sourcePath: string): string {
  const url = new URL(`/api/admin/notes/${encodeURIComponent(noteId)}/assets`, window.location.origin);
  url.searchParams.set('path', sourcePath);
  return url.toString();
}

export const EXPIRY_PRESETS = [
  { label: 'Never', value: '' },
  { label: '30 minutes', value: '30' },
  { label: '1 hour', value: '60' },
  { label: '4 hours', value: '240' },
  { label: '12 hours', value: '720' },
  { label: '1 day', value: '1440' },
  { label: '7 days', value: '10080' },
] as const;

export function parseExpirySelection(selection: string): number | null {
  const trimmed = selection.trim();
  if (!trimmed) {
    return null;
  }

  const minutes = Number.parseInt(trimmed, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
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
    </button>
  );
}

export function AdminApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<NotePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [expiresSelection, setExpiresSelection] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingShares, setLoadingShares] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareBaseUrlDraft, setShareBaseUrlDraft] = useState('');

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const tree = useMemo(() => buildNoteTree(notes), [notes]);
  const selectedShares = shares.filter((share) => share.noteId === selectedNoteId);

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
      toast.error(loadError instanceof Error ? loadError.message : 'Failed to load notes');
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
      toast.error(loadError instanceof Error ? loadError.message : 'Failed to load shares');
    } finally {
      setLoadingShares(false);
    }
  }

  async function loadConfig(): Promise<void> {
    setLoadingConfig(true);
    try {
      const result = await fetchJson<AdminConfig>('/api/admin/config');
      setAdminConfig(result);
      setShareBaseUrlDraft(result.shareBaseUrl);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : 'Failed to load settings');
    } finally {
      setLoadingConfig(false);
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
    void loadConfig();
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
          toast.error(previewError instanceof Error ? previewError.message : 'Failed to load preview');
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
      toast.error('Select a Markdown file first.');
      return;
    }

    try {
      const expires = parseExpirySelection(expiresSelection);
      const payload = {
        noteId: selectedNote.id,
        expiresInMinutes: expires,
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
      });
      await loadShares();
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : 'Failed to create share');
    }
  }

  async function revokeShare(token: string): Promise<void> {
    try {
      await fetchJson<ShareSummary>(`/api/admin/shares/${token}/revoke`, {
        method: 'POST',
      });
      toast.success(`Revoked ${shortToken(token)}`);
      await loadShares();
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Failed to revoke share');
    }
  }

  async function exportShare(token: string): Promise<void> {
    try {
      const result = await fetchJson<{ status: string; backupPath: string; conflictCopyPath: string | null; exportedAt: number }>(
        `/api/admin/shares/${token}/export`,
        {
          method: 'POST',
        },
      );
      toast.success(
        result.status === 'conflict'
          ? `Conflict copy written to ${result.conflictCopyPath ?? 'unknown path'}`
          : `Exported at ${formatTimestamp(result.exportedAt)}`,
      );
      await loadShares();
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : 'Failed to export share');
    }
  }

  async function copyLink(url: string, nextToast?: { text: string }): Promise<void> {
    const result = await copyTextToClipboard(url);
    if (result.copied) {
      toast.success(nextToast?.text ?? 'Share link copied.');
      return;
    }

    toast.message(nextToast?.text ?? 'Share created. Clipboard access is not available here.');
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([loadNotes(), loadShares(), settingsOpen ? Promise.resolve() : loadConfig()]);
  }

  function openSettings(): void {
    if (adminConfig) {
      setShareBaseUrlDraft(adminConfig.shareBaseUrl);
    }

    setSettingsOpen(true);
  }

  async function saveSettings(): Promise<void> {
    if (!adminConfig) {
      return;
    }

    setSavingConfig(true);
    try {
      const trimmed = shareBaseUrlDraft.trim();
      let nextShareBaseUrl: string | null = null;
      if (trimmed.length > 0) {
        try {
          const normalized = new URL(trimmed).toString();
          nextShareBaseUrl = normalized === adminConfig.defaultShareBaseUrl ? null : normalized;
        } catch {
          nextShareBaseUrl = trimmed;
        }
      }
      const updated = await fetchJson<AdminConfig>('/api/admin/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shareBaseUrl: nextShareBaseUrl }),
      });
      setAdminConfig(updated);
      setShareBaseUrlDraft(updated.shareBaseUrl);
      setSettingsOpen(false);
      toast.success('Shared link settings updated.');
      await loadShares();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to save settings');
    } finally {
      setSavingConfig(false);
    }
  }

  return (
    <div className="app-shell app-shell-admin">
      <Toaster position="top-right" richColors closeButton />

      <Card className="admin-topbar">
        <CardContent className="panel-tight topbar-block">
          <div className="topbar-copy">
            <CardTitle>Admin</CardTitle>
          </div>

          <div className="topbar-controls">
            <Button variant="icon" onClick={openSettings} aria-label="Open settings" disabled={loadingConfig || !adminConfig}>
              <Settings2 />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <div>
              <div className="eyebrow">Admin settings</div>
              <DialogTitle id="admin-settings-title">Shared link base URL</DialogTitle>
              <DialogDescription>
                This URL is used to build the copied share link. Use a site root like https://share.example.com.
              </DialogDescription>
            </div>
            <DialogClose />
          </DialogHeader>

          <DialogBody>
            <label className="settings-field">
              <span>Shared link base URL</span>
              <div className="mini-field settings-input">
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="https://share.example.com"
                  value={shareBaseUrlDraft}
                  onChange={(event) => setShareBaseUrlDraft(event.target.value)}
                />
              </div>
              <span className="muted">
                Default: <span className="mono">{adminConfig?.defaultShareBaseUrl ?? 'Loading...'}</span>
              </span>
            </label>
          </DialogBody>

          <Separator />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShareBaseUrlDraft(adminConfig?.defaultShareBaseUrl ?? '')} disabled={!adminConfig}>
              Reset to default
            </Button>
            <Button onClick={() => void saveSettings()} disabled={!adminConfig || savingConfig}>
              <span>{savingConfig ? 'Saving...' : 'Save settings'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="page-grid admin-layout">
        <Card className="admin-sidebar panel-tight">
          <CardHeader className="sidebar-header">
            <div className="sidebar-header-copy">
              <CardTitle>Files</CardTitle>
              <span className="muted">{loadingNotes ? 'Refreshing...' : `${notes.length} results`}</span>
            </div>
            <div className="navigator-controls">
              <label className="command-search" htmlFor="search-notes">
                <span className="command-icon">
                  <Search />
                </span>
                <Input
                  id="search-notes"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search notes"
                />
              </label>

              <Button variant="icon" onClick={() => void refreshAll()} aria-label="Refresh notes, shares, and settings">
                <RotateCcw />
              </Button>
            </div>
          </CardHeader>

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
        </Card>

        <main className="admin-main">
          <Card className="command-strip panel-tight">
            <div className="command-strip-main">
              <div className="command-selection">
                <CardTitle>{selectedNote?.name ?? 'Choose a note'}</CardTitle>
                <CardDescription className="mono">{selectedNote?.relativePath ?? 'No file selected'}</CardDescription>
              </div>

              <label className="mini-field expires-field" htmlFor="expires-minutes">
                <span>Expires</span>
                <select
                  id="expires-minutes"
                  className="ui-input expires-select"
                  value={expiresSelection}
                  onChange={(event) => setExpiresSelection(event.target.value)}
                >
                  {EXPIRY_PRESETS.map((preset) => (
                    <option key={preset.value || 'never'} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="command-actions">
                <Button onClick={() => void createShare()} disabled={!selectedNote}>
                  <Share2 />
                  <span>Create share</span>
                </Button>
                <Button variant="ghost" onClick={() => void refreshAll()}>
                  <RotateCcw />
                  <span>Refresh</span>
                </Button>
              </div>
            </div>
          </Card>

          <section className="admin-preview-grid">
          <Card className="panel-tight preview-panel">
            <CardHeader className="preview-head">
              <CardTitle>Preview</CardTitle>
              {selectedPreview ? (
                <div className="preview-meta muted">
                  <span>{formatTimestamp(selectedPreview.modifiedAt)}</span>
                  <Separator orientation="vertical" />
                  <span>{formatBytes(selectedPreview.size)}</span>
                  </div>
                ) : null}
              </CardHeader>

              <CardContent className="preview-sheet">
                {loadingPreview ? <p className="muted">Loading preview...</p> : null}
                {!loadingPreview && selectedPreview ? (
                  <MarkdownPreview
                    content={selectedPreview.content || selectedPreview.excerpt || ''}
                    emptyLabel="This note is empty."
                    resolveImageUrl={(source) => buildAdminAssetUrl(selectedPreview.id, source)}
                  />
                ) : null}
                {!loadingPreview && !selectedPreview ? <p className="muted">Select a note to preview its content.</p> : null}
              </CardContent>
            </Card>

            <Card className="panel-tight shares-panel">
              <CardHeader className="preview-head">
                <CardTitle>{selectedNote ? `Shared Links (${selectedShares.length})` : `Shared Links (${shares.length})`}</CardTitle>
              </CardHeader>

              <CardContent className="share-list-compact">
                {(selectedNote ? selectedShares : shares).map((share) => (
                  <article key={share.token} className="share-row-compact">
                    <div className="share-row-copy">
                      <div className="share-row-title">
                        <strong>{share.noteName}</strong>
                        <Badge variant="outline" className={`tone-${statusTone(share.status)}`}>
                          {shareStatusLabel(share.status)}
                        </Badge>
                      </div>
                      <div className="muted mono">{shortToken(share.token)}</div>
                    </div>

                    <div className="share-row-actions">
                      <Button variant="icon" onClick={() => void copyLink(share.shareUrl)} aria-label="Copy share link">
                        <Copy />
                      </Button>
                      <Button variant="icon" onClick={() => void exportShare(share.token)} aria-label="Export note">
                        <Download />
                      </Button>
                      <Button variant="icon" className="danger-button" onClick={() => void revokeShare(share.token)} aria-label="Revoke share">
                        <Ban />
                      </Button>
                    </div>
                  </article>
                ))}

                {(selectedNote ? selectedShares : shares).length === 0 ? (
                  <div className="empty-state muted">{selectedNote ? 'No shares for this note yet.' : 'No shares yet.'}</div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </div>
  );
}
