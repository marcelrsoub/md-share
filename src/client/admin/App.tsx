import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  Link2,
  MoreHorizontal,
  RotateCcw,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import type { AdminConfig, NotePreview, NoteSummary, ShareSummary } from '../../shared/types.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { Separator } from '../components/ui/separator.js';
import { Toaster, toast } from '../components/ui/toast.js';
import { MarkdownEditor } from '../components/markdown-editor.js';
import { resolveMarkdownImageSource } from '../shared/markdown-assets.js';
import { copyTextToClipboard } from '../shared/clipboard.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, formatBytes, formatTimestamp, shareStatusLabel, shortToken, statusTone } from '../shared/api.js';
import { APP_VERSION, GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_URL, GITHUB_UPDATE_GUIDE_URL } from '../shared/app-meta.js';

interface CreateShareResponse extends ShareSummary {}

interface LatestReleaseResponse {
  tag_name?: unknown;
}

interface AvailableUpdate {
  version: string;
  guideUrl: string;
}

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

export function isNewerVersion(currentVersion: string, latestVersion: string): boolean {
  const parseVersion = (value: string): number[] | null => {
    const normalized = value.trim().replace(/^v/i, '').split('-')[0];
    const parts = normalized.split('.');
    if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) {
      return null;
    }

    return parts.map(Number);
  };

  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) {
    return false;
  }

  const length = Math.max(current.length, latest.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = current[index] ?? 0;
    const latestPart = latest[index] ?? 0;
    if (latestPart !== currentPart) {
      return latestPart > currentPart;
    }
  }

  return false;
}

export function parseExpirySelection(selection: string): number | null {
  const trimmed = selection.trim();
  if (!trimmed) {
    return null;
  }

  const minutes = Number.parseInt(trimmed, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function getNoteDirectory(relativePath: string): string {
  const separator = relativePath.lastIndexOf('/');
  return separator > 0 ? relativePath.slice(0, separator) : 'Root';
}

export function getNoteListEmptyState(query: string): { title: string; description: string } {
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    return {
      title: 'No matching Markdown files',
      description: `No Markdown files match “${trimmedQuery}”. Try another search.`,
    };
  }

  return {
    title: 'No Markdown files found',
    description: 'Mount a notes folder containing .md files to start sharing.',
  };
}

export function collectFolderOptions(notes: NoteSummary[]): string[] {
  const folders = new Set<string>();
  for (const note of notes) {
    folders.add(getNoteDirectory(note.relativePath));
  }

  return [...folders].sort((left, right) => {
    if (left === 'Root') {
      return -1;
    }
    if (right === 'Root') {
      return 1;
    }
    return left.localeCompare(right);
  });
}

export function getActiveShareCounts(shares: ShareSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const share of shares) {
    if (share.status === 'revoked') {
      continue;
    }
    counts[share.noteId] = (counts[share.noteId] ?? 0) + 1;
  }
  return counts;
}

export function formatRelativeDay(value: number, now = Date.now()): string {
  const startOfDay = (timestamp: number): number => {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const dayDifference = Math.round((startOfDay(now) - startOfDay(value)) / 86_400_000);
  if (dayDifference <= 0) {
    return 'Today';
  }
  if (dayDifference === 1) {
    return 'Yesterday';
  }

  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

function splitNoteName(name: string): { base: string; extension: string } {
  return name.toLowerCase().endsWith('.md')
    ? { base: name.slice(0, -3), extension: '.md' }
    : { base: name, extension: '' };
}

export function AdminApp() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
  const [scope, setScope] = useState<'all' | 'shared'>('all');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('note'));
  const [selectedPreview, setSelectedPreview] = useState<NotePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [expiresSelection, setExpiresSelection] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareBaseUrlDraft, setShareBaseUrlDraft] = useState('');
  const [conflictShare, setConflictShare] = useState<ShareSummary | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateCheckComplete, setUpdateCheckComplete] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const detailTitleRef = useRef<HTMLHeadingElement | null>(null);
  const focusSearchOnReturnRef = useRef(false);

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const screen: 'files' | 'share' = selectedNoteId ? 'share' : 'files';
  const activeSharesByNote = useMemo(() => getActiveShareCounts(shares), [shares]);
  const folderOptions = useMemo(() => collectFolderOptions(notes), [notes]);
  const visibleNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          (folderFilter === 'all' || getNoteDirectory(note.relativePath) === folderFilter)
          && (scope === 'all' || (activeSharesByNote[note.id] ?? 0) > 0),
      ),
    [activeSharesByNote, folderFilter, notes, scope],
  );
  const selectedShares = useMemo(
    () => shares.filter((share) => share.noteId === selectedNoteId),
    [selectedNoteId, shares],
  );
  const activeSelectedShares = selectedShares.filter((share) => share.status !== 'revoked');
  const revokedSelectedShares = selectedShares.filter((share) => share.status === 'revoked');
  const filtersActive = search.trim() !== '' || folderFilter !== 'all' || scope !== 'all';

  async function loadNotes(query = search): Promise<void> {
    setLoadingNotes(true);
    try {
      const params = query ? `?query=${encodeURIComponent(query)}` : '';
      const result = await fetchJson<NoteSummary[]>(`/api/admin/notes${params}`);
      setNotes(result);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : 'Failed to load notes');
    } finally {
      setLoadingNotes(false);
    }
  }

  async function loadShares(): Promise<void> {
    try {
      const result = await fetchJson<ShareSummary[]>('/api/admin/shares');
      setShares(result);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : 'Failed to load share links');
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
    function restoreFromHistory(): void {
      setSelectedNoteId(new URLSearchParams(window.location.search).get('note'));
    }

    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, []);

  useEffect(() => {
    if (screen === 'share') {
      detailTitleRef.current?.focus();
      return;
    }

    if (focusSearchOnReturnRef.current) {
      focusSearchOnReturnRef.current = false;
      searchInputRef.current?.focus();
    }
  }, [screen]);

  useEffect(() => {
    if (updateCheckComplete) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchJson<LatestReleaseResponse>(GITHUB_LATEST_RELEASE_URL)
        .then((release) => {
          if (cancelled || typeof release.tag_name !== 'string' || !isNewerVersion(APP_VERSION, release.tag_name)) {
            return;
          }

          setAvailableUpdate({
            version: release.tag_name.replace(/^v/i, ''),
            guideUrl: GITHUB_UPDATE_GUIDE_URL,
          });
        })
        .catch(() => {
          // Update checks are best-effort and should not interrupt the admin workflow.
        })
        .finally(() => {
          if (!cancelled) {
            setUpdateCheckComplete(true);
          }
        });
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [updateCheckComplete]);

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
      setLoadingPreview(false);
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

  function openNote(noteId: string): void {
    setSelectedNoteId(noteId);
    const url = new URL(window.location.href);
    url.searchParams.set('note', noteId);
    window.history.pushState(null, '', url);
    window.scrollTo(0, 0);
  }

  function backToFiles(): void {
    focusSearchOnReturnRef.current = true;
    setSelectedNoteId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('note');
    window.history.pushState(null, '', url);
    window.scrollTo(0, 0);
  }

  async function createShare(): Promise<void> {
    if (!selectedNote) {
      toast.error('Select a Markdown file first.');
      return;
    }

    setCreatingShare(true);
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
      toast.error(createError instanceof Error ? createError.message : 'Failed to create share link');
    } finally {
      setCreatingShare(false);
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
      toast.error(revokeError instanceof Error ? revokeError.message : 'Failed to revoke share link');
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
    await Promise.all([loadNotes(), loadShares()]);
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

  function resetFilters(): void {
    setFolderFilter('all');
    setScope('all');
    if (search.trim()) {
      setSearch('');
    }
  }

  return (
    <div className="app-shell app-shell-admin">
      <Toaster />

      <header className="admin-topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src="/logo-gpt-topbar.png" width="28" height="28" alt="" aria-hidden="true" />
          <span className="admin-brand-name">MD Share</span>
        </div>

        <div className="admin-topbar-actions">
          {availableUpdate ? (
            <a
              className="update-pill"
              href={availableUpdate.guideUrl}
              target="_blank"
              rel="noreferrer"
              title={`Version ${availableUpdate.version} is available. Open the update guide.`}
            >
              <ArrowUpCircle />
              <span>Update {availableUpdate.version}</span>
            </a>
          ) : null}
          <Button variant="icon" onClick={openSettings} aria-label="Open settings" title="Settings" disabled={loadingConfig || !adminConfig}>
            <Settings2 />
          </Button>
        </div>
      </header>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle id="admin-settings-title">Settings</DialogTitle>
              <DialogDescription>Base URL for copied share links.</DialogDescription>
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
              <div className="settings-dialog-version-group">
                <span className="settings-dialog-version">Version {APP_VERSION}</span>
                {availableUpdate ? (
                  <span className="update-badge">
                    Update available
                  </span>
                ) : null}
              </div>
              <a className="settings-dialog-github" href={availableUpdate?.guideUrl ?? GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                {availableUpdate ? `Update to ${availableUpdate.version}` : 'See MD Share on GitHub'}
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
              The source file changed while this link had edits. No file was overwritten. Choose which version should become the note.
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

      {screen === 'files' ? (
        <main className="admin-files">
          <div className="admin-files-head">
            <h1>
              Files <span className="admin-count">{visibleNotes.length}</span>
            </h1>
            <div className="admin-tools">
              <label className="admin-search">
                <Search aria-hidden="true" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search files"
                  aria-label="Search files and folders"
                />
                {search ? (
                  <button
                    type="button"
                    className="admin-search-clear"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearch('');
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X />
                  </button>
                ) : null}
              </label>
              <label className="admin-folder-select">
                <Folder aria-hidden="true" />
                <select aria-label="Filter by folder" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
                  <option value="all">All folders</option>
                  {folderOptions.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </select>
              </label>
              <div className="admin-scope" role="group" aria-label="Filter by sharing status">
                <button type="button" className={scope === 'all' ? 'is-active' : ''} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                  All
                </button>
                <button type="button" className={scope === 'shared' ? 'is-active' : ''} aria-pressed={scope === 'shared'} onClick={() => setScope('shared')}>
                  Shared
                </button>
              </div>
              <Button variant="icon" onClick={() => void refreshAll()} aria-label="Refresh files and links" title="Refresh">
                <RotateCcw />
              </Button>
            </div>
          </div>

          {visibleNotes.length > 0 ? (
            <div className="admin-file-list">
              <div className="admin-file-head" aria-hidden="true">
                <span />
                <span>Name</span>
                <span>Folder</span>
                <span>Updated</span>
                <span />
              </div>
              {visibleNotes.map((note) => {
                const { base, extension } = splitNoteName(note.name);
                const shareCount = activeSharesByNote[note.id] ?? 0;
                return (
                  <button
                    key={note.id}
                    type="button"
                    className="admin-file-row"
                    onClick={() => openNote(note.id)}
                    aria-label={`Preview ${note.name}${shareCount > 0 ? ` (${shareCount} active ${shareCount === 1 ? 'link' : 'links'})` : ''}`}
                  >
                    <span className="admin-file-icon" aria-hidden="true">
                      <FileText />
                    </span>
                    <span className="admin-file-name">
                      {base}
                      {extension ? <span className="admin-file-ext">{extension}</span> : null}
                      <span className="admin-file-mobile-folder">{getNoteDirectory(note.relativePath)}</span>
                    </span>
                    <span className="admin-file-folder">{getNoteDirectory(note.relativePath)}</span>
                    <span className="admin-file-updated">{formatRelativeDay(note.modifiedAt, now)}</span>
                    <span className="admin-file-end">
                      {shareCount > 0 ? (
                        <span className="admin-file-shared" aria-hidden="true" title={`${shareCount} active ${shareCount === 1 ? 'link' : 'links'}`}>
                          <Link2 />
                        </span>
                      ) : null}
                      <ChevronRight aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="admin-empty" role="status">
              <Search aria-hidden="true" />
              <h2>{notes.length === 0 ? getNoteListEmptyState(search).title : 'No files match these filters'}</h2>
              <p>
                {notes.length === 0
                  ? getNoteListEmptyState(search).description
                  : 'Try a different folder or reset the filters.'}
              </p>
              {filtersActive && notes.length > 0 ? (
                <Button variant="ghost" onClick={resetFilters}>
                  Reset filters
                </Button>
              ) : null}
            </div>
          )}

          {loadingNotes && notes.length === 0 ? <p className="admin-muted admin-loading">Loading files…</p> : null}
        </main>
      ) : (
        <main className="admin-detail">
          <div className="admin-detail-bar">
            <button type="button" className="admin-back" onClick={backToFiles}>
              <ArrowLeft />
              <span>Files</span>
            </button>
            <span className="admin-detail-chip">Preview</span>
          </div>

          {selectedNote ? (
            <>
              <div className="admin-detail-head">
                <h1 ref={detailTitleRef} tabIndex={-1}>
                  {selectedNote.name}
                </h1>
                <p>
                  <span>{getNoteDirectory(selectedNote.relativePath)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Updated {formatRelativeDay(selectedPreview?.modifiedAt ?? selectedNote.modifiedAt, now)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytes(selectedPreview?.size ?? selectedNote.size)}</span>
                </p>
              </div>

              <div className="admin-detail-grid">
                <section className="admin-preview" aria-label={`Preview of ${selectedNote.name}`}>
                  {loadingPreview ? <p className="admin-muted">Loading preview…</p> : null}
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
                  {!loadingPreview && !selectedPreview ? (
                    <div className="admin-empty" role="status">
                      <h2>Preview unavailable</h2>
                      <p>The selected Markdown file could not be previewed.</p>
                    </div>
                  ) : null}
                </section>

                <aside className="admin-share" aria-label={`Share links for ${selectedNote.name}`}>
                  <h2 className="admin-share-title">Share</h2>

                  <label className="admin-field">
                    <span>Expires</span>
                    <select aria-label="Link expiry" value={expiresSelection} onChange={(event) => setExpiresSelection(event.target.value)}>
                      {EXPIRY_PRESETS.map((preset) => (
                        <option key={preset.value || 'never'} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Button className="admin-create" onClick={() => void createShare()} disabled={creatingShare}>
                    <Link2 />
                    <span>{creatingShare ? 'Creating…' : 'Create link'}</span>
                  </Button>

                  <div className="admin-links-head">
                    <h3>Links</h3>
                    <span className="admin-count">{activeSelectedShares.length}</span>
                  </div>

                  {activeSelectedShares.map((share) => (
                    <article key={share.token} className={`admin-link is-${share.status}`}>
                      <div className="admin-link-top">
                        <span className={`admin-dot tone-${statusTone(share.status)}`} aria-hidden="true" />
                        <span className="admin-link-status">{shareStatusLabel(share.status)}</span>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Copy link"
                          aria-label={`Copy share link ${shortToken(share.token)}`}
                          disabled={share.status === 'revoked'}
                          onClick={() => void copyLink(share.shareUrl)}
                        >
                          <Copy />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="admin-icon-btn admin-kebab"
                            aria-label={`Options for share link ${shortToken(share.token)}`}
                            title="Link options"
                            showChevron={false}
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={6}>
                            <DropdownMenuItem
                              disabled={share.status === 'conflict'}
                              onClick={() => void exportShare(share.token)}
                            >
                              Export edits
                            </DropdownMenuItem>
                            <DropdownMenuItem className="admin-menu-danger" onClick={() => void revokeShare(share.token)}>
                              Revoke link
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {share.status === 'conflict' ? (
                        <div className="admin-link-conflict">
                          <span>
                            <AlertTriangle aria-hidden="true" />
                            The file changed on disk.
                          </span>
                          <Button variant="secondary" className="admin-resolve" onClick={() => setConflictShare(share)}>
                            Resolve
                          </Button>
                        </div>
                      ) : (
                        <p className="admin-link-meta">{formatShareExpiry(share.expiresAt, now)}</p>
                      )}
                    </article>
                  ))}

                  {activeSelectedShares.length === 0 ? <p className="admin-muted admin-links-empty">No links yet.</p> : null}

                  {revokedSelectedShares.length > 0 ? (
                    <details className="admin-revoked">
                      <summary>
                        {revokedSelectedShares.length} revoked {revokedSelectedShares.length === 1 ? 'link' : 'links'}
                      </summary>
                      {revokedSelectedShares.map((share) => (
                        <div key={share.token} className="admin-revoked-row">
                          <span className="mono">{shortToken(share.token)}</span>
                          <span>Revoked {formatTimestamp(share.revokedAt)}</span>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </aside>
              </div>
            </>
          ) : loadingNotes ? (
            <p className="admin-muted admin-loading">Loading file…</p>
          ) : (
            <div className="admin-empty" role="status">
              <h2>File unavailable</h2>
              <p>This file is no longer in the notes folder.</p>
              <Button variant="ghost" onClick={backToFiles}>
                Back to files
              </Button>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
