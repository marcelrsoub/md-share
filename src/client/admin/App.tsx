import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Copy,
  Download,
  ChevronRight,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import type { AdminConfig, NotePreview, NoteSummary, ShareSummary } from '../../shared/types.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card.js';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { Separator } from '../components/ui/separator.js';
import { Toaster, toast } from '../components/ui/toast.js';
import { MarkdownEditor } from '../components/markdown-editor.js';
import { resolveMarkdownImageSource } from '../shared/markdown-assets.js';
import { copyTextToClipboard } from '../shared/clipboard.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, formatBytes, formatTimestamp, shareStatusLabel, shortToken, statusTone } from '../shared/api.js';
import { APP_VERSION, GITHUB_REPO_URL } from '../shared/app-meta.js';

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

export function formatShareExpiry(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt == null) {
    return 'Never expires';
  }

  const remainingMinutes = Math.ceil((expiresAt - now) / 60_000);
  if (remainingMinutes <= 0) {
    return 'Expired';
  }

  if (remainingMinutes < 60) {
    return `Expires in ${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'}`;
  }

  const remainingHours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (remainingHours < 24) {
    return `Expires in ${remainingHours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  }

  const days = Math.floor(remainingHours / 24);
  const hours = remainingHours % 24;
  return `Expires in ${days}d${hours > 0 ? ` ${hours}h` : ''}`;
}

export function parseExpirySelection(selection: string): number | null {
  const trimmed = selection.trim();
  if (!trimmed) {
    return null;
  }

  const minutes = Number.parseInt(trimmed, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function getExpirySelectionLabel(selection: string): string {
  return EXPIRY_PRESETS.find((preset) => preset.value === selection)?.label ?? 'Never';
}

export function getNoteDirectory(relativePath: string): string {
  const separator = relativePath.lastIndexOf('/');
  return separator > 0 ? relativePath.slice(0, separator) : 'Root';
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
          style={{ paddingLeft: `${0.42 + depth * 0.48}rem` }}
        >
          <span className="nav-toggle">
            <ChevronRight />
          </span>
          <span className="nav-icon">
            {isExpanded ? <FolderOpen /> : <Folder />}
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
      style={{ paddingLeft: `${0.42 + depth * 0.48}rem` }}
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
  const [conflictShare, setConflictShare] = useState<ShareSummary | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedNoteDirectory = selectedNote ? getNoteDirectory(selectedNote.relativePath) : null;
  const tree = useMemo(() => buildNoteTree(notes), [notes]);
  const selectedShares = shares.filter((share) => share.noteId === selectedNoteId);
  const selectedExpiryLabel = useMemo(() => getExpirySelectionLabel(expiresSelection), [expiresSelection]);

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
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
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

  async function resolveConflict(resolution: 'keep-editor' | 'keep-file'): Promise<void> {
    if (!conflictShare) {
      return;
    }

    setResolvingConflict(true);
    try {
      await fetchJson<ShareSummary>(`/api/admin/shares/${conflictShare.token}/resolve-conflict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolution }),
      });
      toast.success(resolution === 'keep-editor' ? 'Editor draft is now the note.' : 'NAS version is now shared.');
      setConflictShare(null);
      await loadShares();
    } catch (resolveError) {
      toast.error(resolveError instanceof Error ? resolveError.message : 'Failed to resolve conflict');
    } finally {
      setResolvingConflict(false);
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
      <Toaster />

      <Card className="admin-topbar">
        <CardContent className="panel-tight topbar-block">
          <div className="brand-lockup">
            <img className="brand-logo" src="/logo-gpt-topbar.png" width="72" height="72" alt="" aria-hidden="true" />
            <div className="brand-copy">
              <CardTitle>MD Share</CardTitle>
              <span className="topbar-context">Admin</span>
            </div>
          </div>

          <div className="topbar-controls">
            <span className="workspace-status">
              <ShieldCheck />
              Admin only
            </span>
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
              <DialogTitle id="admin-settings-title">Shared link settings</DialogTitle>
              <DialogDescription>Base URL for copied links.</DialogDescription>
            </div>
            <DialogClose />
          </DialogHeader>

          <DialogBody>
            <label className="settings-field">
              <span>Base URL</span>
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

            <div className="settings-dialog-meta">
              <span className="settings-dialog-version">Version {APP_VERSION}</span>
              <a className="settings-dialog-github" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                See MD Share on GitHub
              </a>
            </div>
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

      <Dialog open={conflictShare != null} onOpenChange={(open) => !open && setConflictShare(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve file conflict</DialogTitle>
            <DialogDescription>
              The NAS file changed while this shared link had edits. No file was overwritten. Choose which version should become the note.
            </DialogDescription>
            <DialogClose disabled={resolvingConflict} />
          </DialogHeader>
          <DialogBody>
            <p className="muted">
              <strong>{conflictShare?.noteName}</strong>
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => void resolveConflict('keep-file')} disabled={resolvingConflict}>
              Keep NAS version
            </Button>
            <Button onClick={() => void resolveConflict('keep-editor')} disabled={resolvingConflict}>
              Keep editor draft
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
            <p className="panel-helper">Choose a note to preview it and create a share link.</p>
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
              <div className="empty-state muted">
                <span className="empty-state-title">No Markdown files found</span>
                <span className="empty-state-copy">Mount a notes folder containing .md files to start sharing.</span>
              </div>
            )}
          </div>
        </Card>

        <main className="admin-main">
          <Card className="admin-workbench panel-tight">
            <div className="workbench-toolbar">
              <div className="command-selection workbench-selection">
                <CardTitle className="workbench-selection-path mono">
                  {selectedNote ? (
                    <>
                      {selectedNoteDirectory !== 'Root' ? <span>{selectedNoteDirectory}/</span> : null}
                      <strong>{selectedNote.name}</strong>
                    </>
                  ) : (
                    'Choose a note'
                  )}
                </CardTitle>
              </div>

              <div className="workbench-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger className="button-ghost expires-trigger" aria-label="Select share expiry">
                    <Clock3 />
                    <span className="expires-trigger-label">Expires</span>
                    <span className="expires-trigger-value">{selectedExpiryLabel}</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={10}>
                    {EXPIRY_PRESETS.map((preset) => (
                      <DropdownMenuItem
                        key={preset.value || 'never'}
                        checked={preset.value === expiresSelection}
                        onClick={() => setExpiresSelection(preset.value)}
                      >
                        {preset.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button onClick={() => void createShare()} disabled={!selectedNote}>
                  <Link2 />
                  <span>Create share</span>
                </Button>
              </div>
            </div>

            <Separator />

            <div className="workbench-grid">
              <section className="workbench-section preview-panel">
                <CardHeader className="preview-head workbench-section-head">
                  <div>
                    <CardTitle>Preview</CardTitle>
                    <CardDescription>Read-only view of the selected Markdown file.</CardDescription>
                  </div>
                  {selectedPreview ? (
                    <div className="preview-meta muted">
                      <span>{formatTimestamp(selectedPreview.modifiedAt)}</span>
                      <Separator orientation="vertical" />
                      <span>{formatBytes(selectedPreview.size)}</span>
                    </div>
                  ) : null}
                </CardHeader>

                <div className="preview-sheet preview-editor-sheet">
                  {loadingPreview ? <p className="muted">Loading preview...</p> : null}
                  {!loadingPreview && selectedPreview ? (
                    <MarkdownEditor
                      content={selectedPreview.content || selectedPreview.excerpt || ''}
                      editable={false}
                      className="editor-host-admin-preview is-readonly"
                      staticPreview
                      resolveImageUrl={(source) =>
                        resolveMarkdownImageSource(source, (localSource) => buildAdminAssetUrl(selectedPreview.id, localSource))
                      }
                    />
                  ) : null}
                  {!loadingPreview && !selectedPreview ? <p className="muted">Select a note to preview its content.</p> : null}
                </div>
              </section>

              <section className="workbench-section shares-panel">
                <CardHeader className="preview-head workbench-section-head">
                  <div>
                    <CardTitle>{selectedNote ? `Share links (${selectedShares.length})` : `Share links (${shares.length})`}</CardTitle>
                    <CardDescription>Links stay private until you copy one.</CardDescription>
                  </div>
                </CardHeader>

                <div className="share-list-compact">
                  {(selectedNote ? selectedShares : shares).map((share) => (
                    <article
                      key={share.token}
                      className={`share-row-compact${share.status === 'revoked' ? ' is-revoked' : ''}${share.status === 'conflict' ? ' is-conflict' : ''}`}
                    >
                      <div className="share-row-copy">
                        <div className="share-row-title">
                          <strong>{share.noteName}</strong>
                          <Badge variant="outline" className={`tone-${statusTone(share.status)}`}>
                            {shareStatusLabel(share.status)}
                          </Badge>
                        </div>
                        <div className="share-row-meta">
                          <span className="muted mono share-row-token">{shortToken(share.token)}</span>
                          <span className="share-row-expiry">{formatShareExpiry(share.expiresAt, now)}</span>
                        </div>
                        {share.status === 'conflict' ? <div className="share-row-conflict-copy">The source file changed. Choose a version to continue.</div> : null}
                      </div>

                      <div className="share-row-actions">
                        <Button variant="icon" title="Copy share link" onClick={() => void copyLink(share.shareUrl)} aria-label="Copy share link" disabled={share.status === 'revoked'}>
                          <Copy />
                        </Button>
                        <Button
                          variant={share.status === 'conflict' ? 'secondary' : 'icon'}
                          onClick={() => (share.status === 'conflict' ? setConflictShare(share) : void exportShare(share.token))}
                          title={share.status === 'conflict' ? 'Resolve file conflict' : 'Export note'}
                          aria-label={share.status === 'conflict' ? 'Resolve file conflict' : 'Export note'}
                          disabled={share.status === 'revoked'}
                        >
                          {share.status === 'conflict' ? 'Resolve' : <Download />}
                        </Button>
                        <Button
                          variant="icon"
                          className="danger-button"
                          onClick={() => void revokeShare(share.token)}
                          title="Revoke share"
                          aria-label="Revoke share"
                          disabled={share.status === 'revoked'}
                        >
                          <Ban />
                        </Button>
                      </div>
                    </article>
                  ))}

                  {(selectedNote ? selectedShares : shares).length === 0 ? (
                    <div className="empty-state muted">
                      <span className="empty-state-title">{selectedNote ? 'No share links yet' : 'No share links yet'}</span>
                      <span className="empty-state-copy">
                        {selectedNote ? 'Choose an expiry, then create a link for this note.' : 'Select a note to create your first private link.'}
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}
