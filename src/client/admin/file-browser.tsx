import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, RotateCcw, Search, X } from 'lucide-react';
import type { NoteSummary } from '../../shared/types.js';
import {
  folderContainsNotes,
  getBreadcrumbs,
  getFolderEntries,
  getNoteFolder,
  searchNotes,
  type BrowserEntry,
  type FolderIndex,
} from './file-browser-model.js';
import type { BrowserFilter, BrowserSnapshot, SearchScope } from './use-file-browser.js';

interface FileBrowserProps {
  index: FolderIndex;
  folder: string;
  query: string;
  searchScope: SearchScope;
  filter: BrowserFilter;
  sharedNoteIds: ReadonlySet<string>;
  expandedFolders: string[];
  onFolder(path: string, expanded?: string[], sourceSnapshot?: BrowserSnapshot): void;
  onQuery(query: string): void;
  onSearchScope(scope: SearchScope): void;
  onFilter(filter: BrowserFilter): void;
  onExpandedFolders(paths: string[]): void;
  onOpenNote(note: NoteSummary, snapshot: BrowserSnapshot): void;
  onRefresh(): void;
  onBack(): void;
  onForward(): void;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  loadError: string | null;
  hasLoaded: boolean;
  onRetry(): void;
  scrollTop: number;
  onScrollTop(value: number): void;
  focusKey: string | null;
  restoreFocus: boolean;
  onRestoreComplete(): void;
  formatDateRelative(value: number): string;
}

function folderLabel(path: string): string {
  return path ? path.split('/').at(-1) ?? 'Vault' : 'Vault';
}

export function FileBrowser(props: FileBrowserProps) {
  const {
    index, folder, query, searchScope, filter, sharedNoteIds, expandedFolders,
    onFolder, onQuery, onSearchScope, onFilter, onExpandedFolders, onOpenNote,
    onRefresh, onBack, onForward, canBack, canForward, loading, loadError, hasLoaded, onRetry, scrollTop, onScrollTop,
    focusKey, restoreFocus, onRestoreComplete, formatDateRelative,
  } = props;
  const layoutRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const treeRef = useRef<HTMLElement | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const expanded = new Set(expandedFolders);
  const breadcrumbs = getBreadcrumbs(folder);
  const entries: BrowserEntry[] = query.trim()
    ? searchNotes(index, query, folder, searchScope, filter === 'shared' ? sharedNoteIds : undefined)
    : getFolderEntries(index, folder, filter === 'shared' ? sharedNoteIds : undefined);
  const noteCount = query.trim() ? entries.length : entries.filter((entry) => entry.type === 'note').length;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const onChange = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileTreeOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!restoreFocus || !hasLoaded) return;
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = scrollTop;
      if (focusKey) {
        const target = layoutRef.current?.querySelector<HTMLElement>(`[data-browser-key="${CSS.escape(focusKey)}"]`);
        if (target && !target.closest('[inert]')) target.focus();
        else layoutRef.current?.querySelector<HTMLElement>('.browser-breadcrumbs [aria-current="page"]')?.focus();
      }
    });
    onRestoreComplete();
  }, [restoreFocus, hasLoaded, focusKey, scrollTop, onRestoreComplete]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  const toggleExpanded = (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onExpandedFolders([...next]);
  };

  const focusedBrowserKey = (): string | null =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-browser-key]')?.dataset.browserKey ?? null
      : null;

  const snapshot = (focusedKey?: string | null): BrowserSnapshot => ({
    expandedFolders: [...expanded],
    scrollTop: listRef.current?.scrollTop ?? scrollTop,
    focusedKey: focusedKey === undefined ? focusedBrowserKey() : focusedKey,
  });

  const openNote = (note: NoteSummary, key: string) => onOpenNote(note, snapshot(key));
  const openFolder = (path: string, clickedKey?: string) => {
    const next = new Set(expanded);
    for (const crumb of getBreadcrumbs(path)) if (crumb.path) next.add(crumb.path);
    const paths = [...next];
    const sourceSnapshot = snapshot(clickedKey);
    onFolder(path, paths, sourceSnapshot);
    if (mobileTreeOpen) closeMobileTree();
  };

  const closeMobileTree = (restoreFocus = true) => {
    setMobileTreeOpen(false);
    if (restoreFocus) requestAnimationFrame(() => toggleRef.current?.focus());
  };

  useEffect(() => {
    if (!mobileTreeOpen || !isMobile) return;
    requestAnimationFrame(() => {
      const current = treeRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      (current ?? treeRef.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    });
  }, [mobileTreeOpen, isMobile]);

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-browser-key]') ?? [])]
      .filter((element) => !element.hasAttribute('disabled'));
    const activeIndex = rows.indexOf(document.activeElement as HTMLElement);
    let nextIndex = activeIndex;
    if (event.key === 'ArrowDown') nextIndex = Math.min(rows.length - 1, Math.max(0, activeIndex + 1));
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, activeIndex < 0 ? 0 : activeIndex - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = rows.length - 1;
    if (rows[nextIndex]) {
      event.preventDefault();
      rows[nextIndex].focus();
    }
  }

  const handleMobileEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && isMobile && mobileTreeOpen) {
      event.stopPropagation();
      closeMobileTree();
    }
  };

  const renderTree = (path: string, depth = 0): React.ReactNode => {
    const current = index.folders.get(path);
    if (!current) return null;
    const visibleChildren = current.childPaths.filter((child) => filter !== 'shared' || folderContainsNotes(index, child, sharedNoteIds));
    return visibleChildren.map((childPath) => {
      const child = index.folders.get(childPath);
      if (!child) return null;
      const isOpen = expanded.has(childPath);
      const isCurrent = folder === childPath;
      return (
        <div className="browser-tree-node" key={childPath}>
          <div className={`browser-tree-row${isCurrent ? ' is-current' : ''}`} style={{ '--tree-depth': depth } as React.CSSProperties}>
            {visibleChildrenFor(childPath).length > 0 ? <button type="button" className="browser-tree-expand" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${child.name}`} aria-expanded={isOpen} onClick={() => toggleExpanded(childPath)}>
              {isOpen ? <ChevronDown /> : <ChevronRight />}
            </button> : <span className="browser-tree-expand browser-tree-spacer" aria-hidden="true" />}
            <button type="button" className="browser-tree-open" data-browser-key={`tree:${childPath}`} aria-current={isCurrent ? 'page' : undefined} onClick={(event) => openFolder(childPath, event.currentTarget.dataset.browserKey)}>
              {isOpen ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
              <span>{child.name}</span>
              {isCurrent ? <span className="sr-only">Current folder</span> : null}
            </button>
          </div>
          {isOpen ? <div className="browser-tree-children">{renderTree(childPath, depth + 1)}</div> : null}
        </div>
      );
    });
  };

  const visibleChildrenFor = (path: string): string[] => {
    const current = index.folders.get(path);
    if (!current) return [];
    return current.childPaths.filter((child) => filter !== 'shared' || folderContainsNotes(index, child, sharedNoteIds));
  };

  const renderEntry = (entry: BrowserEntry) => {
    if (entry.type === 'folder') {
      const key = `folder:${entry.path}`;
      return <button type="button" key={entry.key} data-browser-key={key} className="browser-entry browser-folder-entry" onClick={() => openFolder(entry.path, key)}>
        <Folder aria-hidden="true" /><span className="browser-entry-name">{entry.name}</span><span className="browser-entry-hint">Open folder</span>
      </button>;
    }
    const note = entry.note;
    const key = `note:${note.id}`;
    const sharedCount = sharedNoteIds.has(note.id);
    if (query.trim()) return <div className="browser-search-result" key={entry.key}>
      <button type="button" data-browser-key={key} className="browser-entry browser-note-entry" onClick={() => openNote(note, key)}>
        <FileText aria-hidden="true" /><span className="browser-entry-name">{note.name}<small>{formatDateRelative(note.modifiedAt)}</small></span><span className="browser-entry-hint">{getNoteFolder(note) || 'Vault'}{sharedCount ? <small className="browser-search-shared">Shared</small> : null}</span>
      </button>
      <button type="button" data-browser-key={`containing:${note.id}`} className="browser-containing-folder" onClick={(event) => openFolder(getNoteFolder(note), event.currentTarget.dataset.browserKey)}>Open containing folder</button>
    </div>;
    return <button type="button" key={entry.key} data-browser-key={key} className="browser-entry browser-note-entry" onClick={() => openNote(note, key)}>
      <FileText aria-hidden="true" /><span className="browser-entry-name">{note.name}<small>{formatDateRelative(note.modifiedAt)}</small></span>
      <span className="browser-entry-hint">{sharedCount ? 'Shared' : ''}</span>
    </button>;
  };

  return <section ref={layoutRef} className="browser-layout" aria-label="Markdown library">
    <button ref={toggleRef} type="button" className="browser-mobile-toggle" aria-controls="browser-tree-panel" aria-expanded={mobileTreeOpen} onKeyDown={handleMobileEscape} onClick={() => setMobileTreeOpen(true)}>Browse folders</button>
    {mobileTreeOpen && isMobile ? <button type="button" className="browser-tree-backdrop" aria-label="Close folders" onClick={() => closeMobileTree()} /> : null}
    <nav ref={treeRef} id="browser-tree-panel" className={`browser-tree-panel${mobileTreeOpen ? ' is-open' : ''}`} aria-label="Folders" aria-hidden={isMobile && !mobileTreeOpen} inert={isMobile && !mobileTreeOpen} onKeyDown={handleMobileEscape}>
      <div className="browser-tree-mobile-head"><strong>Folders</strong><button type="button" aria-label="Close folders" onClick={() => closeMobileTree()}><X /></button></div>
      <button type="button" data-browser-key="tree:" className={`browser-tree-root${folder === '' ? ' is-current' : ''}`} aria-current={folder === '' ? 'page' : undefined} onClick={(event) => openFolder('', event.currentTarget.dataset.browserKey)}><FolderOpen aria-hidden="true" />Vault</button>
      {renderTree('')}
    </nav>
    <div className="browser-main" onKeyDown={handleMobileEscape}>
      <header className="browser-header">
        <div className="browser-title-row"><h1>Files <span className="admin-count">{noteCount}</span></h1>
          <div className="browser-history-actions"><button type="button" onClick={onBack} disabled={!canBack} aria-label="Back" title="Back"><ArrowLeft /></button><button type="button" onClick={onForward} disabled={!canForward} aria-label="Forward" title="Forward"><ArrowRight /></button></div>
        </div>
        <nav className="browser-breadcrumbs" aria-label="Breadcrumb">{breadcrumbs.map((crumb, i) => <span key={crumb.path || 'root'}>{i > 0 ? <span aria-hidden="true">/</span> : null}<button type="button" data-browser-key={`breadcrumb:${crumb.path}`} aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined} onClick={(event) => openFolder(crumb.path, event.currentTarget.dataset.browserKey)}>{crumb.name}</button></span>)}</nav>
        <div className="browser-tools">
          <label className="admin-search"><Search aria-hidden="true" /><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search files and folders" aria-label="Search files and paths" />{query ? <button type="button" className="admin-search-clear" aria-label="Clear search" onClick={() => onQuery('')}><X /></button> : null}</label>
          {query.trim() ? <label className="browser-vault-scope"><input type="checkbox" checked={searchScope === 'vault'} onChange={(event) => onSearchScope(event.target.checked ? 'vault' : 'folder')} />Entire vault</label> : null}
          <div className="admin-scope" role="group" aria-label="Filter by sharing status"><button type="button" className={filter === 'all' ? 'is-active' : ''} aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>All</button><button type="button" className={filter === 'shared' ? 'is-active' : ''} aria-pressed={filter === 'shared'} onClick={() => onFilter('shared')}>Shared</button></div>
          <button type="button" className="browser-refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh library"><RotateCcw /></button>
        </div>
      </header>
      <div className="browser-location"><button type="button" data-browser-key="up" onClick={(event) => { const bits = folder.split('/'); bits.pop(); openFolder(bits.join('/'), event.currentTarget.dataset.browserKey); }} disabled={!folder} aria-label="Up one folder"><ArrowUp /> Up</button><span>{folder ? folderLabel(folder) : 'Vault'}</span></div>
      <div ref={listRef} className="browser-entry-list" onKeyDown={handleListKeyDown} onScroll={(event) => onScrollTop(event.currentTarget.scrollTop)}>
        {!hasLoaded && loading ? <div className="admin-empty" role="status"><p>Loading Markdown library…</p></div> : null}
        {loadError && !hasLoaded ? <div className="admin-empty" role="alert"><h2>Library unavailable</h2><p>{loadError}</p><button type="button" onClick={onRetry}>Retry</button></div> : null}
        {hasLoaded && !query.trim() && index.notes.length === 0 ? <div className="admin-empty" role="status"><h2>No Markdown files found</h2><p>Mount a notes folder containing .md files to start sharing.</p></div> : null}
        {hasLoaded && entries.length === 0 && (index.notes.length > 0 || query.trim()) ? <div className="admin-empty" role="status"><h2>{query.trim() ? 'No matching Markdown files' : 'No files in this view'}</h2><p>{query.trim() ? 'Try different search terms or search the entire vault.' : 'Choose another folder or change the Shared filter.'}</p></div> : null}
        {entries.map(renderEntry)}
      </div>
    </div>
  </section>;
}
