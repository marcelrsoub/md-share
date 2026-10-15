import { useCallback, useEffect, useRef, useState } from 'react';
import { getFolderAncestors, getNoteFolder, resolveFolder, type FolderIndex } from './file-browser-model.js';

export type SearchScope = 'folder' | 'vault';
export type BrowserFilter = 'all' | 'shared';

export interface BrowserSnapshot {
  expandedFolders: string[];
  scrollTop: number;
  focusedKey: string | null;
}

export interface BrowserUrlState {
  folder: string;
  query: string;
  searchScope: SearchScope;
  filter: BrowserFilter;
  noteId: string | null;
}

export interface ManagedHistoryEntry {
  sessionId: string;
  position: number;
  maxPosition: number;
  snapshot: BrowserSnapshot;
  origin: boolean;
}

export interface HistoryTransition {
  currentState: Record<string, unknown>;
  nextState: Record<string, unknown>;
  entry: ManagedHistoryEntry;
}

const SESSION_STORAGE_KEY = 'md-share-browser-session';
const emptySnapshot: BrowserSnapshot = { expandedFolders: [], scrollTop: 0, focusedKey: null };
const HISTORY_KEYS = [
  'mdShareBrowserSessionId',
  'mdShareBrowserPosition',
  'mdShareBrowserMaxPosition',
  'mdShareBrowserSnapshot',
  'mdShareBrowserOrigin',
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeBrowserSnapshot(value: unknown): BrowserSnapshot | null {
  const candidate = asRecord(value);
  if (
    !Array.isArray(candidate.expandedFolders)
    || candidate.expandedFolders.some((path) => typeof path !== 'string')
    || typeof candidate.scrollTop !== 'number'
    || !Number.isFinite(candidate.scrollTop)
    || candidate.scrollTop < 0
    || (candidate.focusedKey !== null && typeof candidate.focusedKey !== 'string')
  ) return null;

  return {
    expandedFolders: [...new Set(candidate.expandedFolders as string[])],
    scrollTop: candidate.scrollTop,
    focusedKey: candidate.focusedKey as string | null,
  };
}

export function parseBrowserUrl(search: string): BrowserUrlState {
  const params = new URLSearchParams(search);
  return {
    folder: params.get('folder') ?? '',
    query: params.get('q') ?? '',
    searchScope: params.get('searchScope') === 'vault' ? 'vault' : 'folder',
    filter: params.get('shared') === '1' ? 'shared' : 'all',
    noteId: params.get('note'),
  };
}

export function writeBrowserUrl(url: URL, state: BrowserUrlState): URL {
  const next = new URL(url);
  for (const key of ['folder', 'q', 'searchScope', 'shared', 'note']) next.searchParams.delete(key);
  if (state.folder) next.searchParams.set('folder', state.folder);
  if (state.query) next.searchParams.set('q', state.query);
  if (state.searchScope === 'vault') next.searchParams.set('searchScope', 'vault');
  if (state.filter === 'shared') next.searchParams.set('shared', '1');
  if (state.noteId) next.searchParams.set('note', state.noteId);
  return next;
}

export function readManagedHistoryEntry(value: unknown, sessionId: string): ManagedHistoryEntry | null {
  const state = asRecord(value);
  const position = state.mdShareBrowserPosition;
  const maxPosition = state.mdShareBrowserMaxPosition;
  const snapshot = normalizeBrowserSnapshot(state.mdShareBrowserSnapshot);
  if (
    state.mdShareBrowserSessionId !== sessionId
    || (state.mdShareBrowserOrigin !== undefined && typeof state.mdShareBrowserOrigin !== 'boolean')
    || typeof position !== 'number'
    || !Number.isSafeInteger(position)
    || position < 0
    || typeof maxPosition !== 'number'
    || !Number.isSafeInteger(maxPosition)
    || maxPosition < position
    || !snapshot
    || (state.mdShareBrowserOrigin !== undefined && typeof state.mdShareBrowserOrigin !== 'boolean')
  ) return null;

  return {
    sessionId,
    position,
    maxPosition,
    snapshot,
    origin: state.mdShareBrowserOrigin === true,
  };
}

export function deriveHistoryBoundaries(entry: ManagedHistoryEntry | null): { back: boolean; forward: boolean } {
  return { back: Boolean(entry && entry.position > 0), forward: Boolean(entry && entry.position < entry.maxPosition) };
}

export function canReturnToBrowserOrigin(entry: ManagedHistoryEntry | null): boolean {
  return Boolean(entry?.origin && entry.position > 0);
}

export function transitionManagedHistory(
  rawState: unknown,
  sessionId: string,
  mode: 'push' | 'replace',
  sourceSnapshot: BrowserSnapshot,
  nextSnapshot: BrowserSnapshot,
  nextHasNote: boolean,
): HistoryTransition {
  const base = asRecord(rawState);
  const existing = readManagedHistoryEntry(base, sessionId);
  const currentEntry: ManagedHistoryEntry = existing ?? {
    sessionId,
    position: 0,
    maxPosition: 0,
    snapshot: emptySnapshot,
    origin: false,
  };
  const validSourceSnapshot = normalizeBrowserSnapshot(sourceSnapshot) ?? emptySnapshot;
  const validNextSnapshot = normalizeBrowserSnapshot(nextSnapshot) ?? emptySnapshot;
  const position = mode === 'push' ? currentEntry.position + 1 : currentEntry.position;
  const maxPosition = mode === 'push' ? position : Math.max(currentEntry.maxPosition, position);
  const currentState: Record<string, unknown> = {
    ...base,
    mdShareBrowserSessionId: sessionId,
    mdShareBrowserPosition: currentEntry.position,
    mdShareBrowserMaxPosition: mode === 'push' ? position : currentEntry.maxPosition,
    mdShareBrowserSnapshot: validSourceSnapshot,
  };
  if (!currentEntry.origin) delete currentState.mdShareBrowserOrigin;

  const nextState: Record<string, unknown> = {
    ...base,
    mdShareBrowserSessionId: sessionId,
    mdShareBrowserPosition: position,
    mdShareBrowserMaxPosition: maxPosition,
    mdShareBrowserSnapshot: validNextSnapshot,
  };
  if (!nextHasNote) delete nextState.mdShareBrowserOrigin;
  else if (!currentEntry.origin) delete nextState.mdShareBrowserOrigin;

  return {
    currentState,
    nextState,
    entry: {
      sessionId,
      position,
      maxPosition,
      snapshot: validNextSnapshot,
      origin: nextState.mdShareBrowserOrigin === true,
    },
  };
}

export interface FileBrowserNavigation extends BrowserUrlState {
  expandedFolders: string[];
  snapshot: BrowserSnapshot;
  updateSnapshot(snapshot: Partial<BrowserSnapshot>): void;
  setFolder(path: string, expanded?: string[], sourceSnapshot?: BrowserSnapshot): void;
  setQuery(query: string): void;
  setSearchScope(scope: SearchScope): void;
  setFilter(filter: BrowserFilter): void;
  setExpandedFolders(paths: string[]): void;
  openNote(noteId: string, currentSnapshot: BrowserSnapshot): void;
  returnFromNote(index: FolderIndex | null): void;
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
  up(): void;
  restoreAfterPop: boolean;
  completeRestore(): void;
}

function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return `volatile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function initializeHistory(sessionId: string): ManagedHistoryEntry {
  const rawState = window.history.state;
  const existing = readManagedHistoryEntry(rawState, sessionId);
  if (existing) return existing;
  const state = { ...asRecord(rawState) };
  for (const key of HISTORY_KEYS) delete state[key];
  state.mdShareBrowserSessionId = sessionId;
  state.mdShareBrowserPosition = 0;
  state.mdShareBrowserMaxPosition = 0;
  state.mdShareBrowserSnapshot = emptySnapshot;
  window.history.replaceState(state, '', window.location.href);
  return { sessionId, position: 0, maxPosition: 0, snapshot: emptySnapshot, origin: false };
}

export function useFileBrowser(index: FolderIndex | null): FileBrowserNavigation {
  const [sessionId] = useState(getSessionId);
  const [initialEntry] = useState(() => initializeHistory(sessionId));
  const [urlState, setUrlState] = useState(() => parseBrowserUrl(window.location.search));
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(initialEntry.snapshot);
  const [expandedFolders, setExpandedFoldersState] = useState(initialEntry.snapshot.expandedFolders);
  const [boundaries, setBoundaries] = useState(deriveHistoryBoundaries(initialEntry));
  const [restoreAfterPop, setRestoreAfterPop] = useState(false);
  const pendingRestoreRef = useRef(false);

  const replaceSnapshotInHistory = useCallback((next: BrowserSnapshot) => {
    const raw = asRecord(window.history.state);
    const current = readManagedHistoryEntry(raw, sessionId) ?? initialEntry;
    const state: Record<string, unknown> = {
      ...raw,
      mdShareBrowserSessionId: sessionId,
      mdShareBrowserPosition: current.position,
      mdShareBrowserMaxPosition: current.maxPosition,
      mdShareBrowserSnapshot: next,
    };
    if (urlState.noteId && current.origin) state.mdShareBrowserOrigin = true;
    else delete state.mdShareBrowserOrigin;
    window.history.replaceState(state, '', window.location.href);
  }, [initialEntry, sessionId, urlState.noteId]);

  const write = useCallback((next: BrowserUrlState, mode: 'push' | 'replace', nextSnapshot: BrowserSnapshot, sourceSnapshot = snapshot) => {
    const url = writeBrowserUrl(new URL(window.location.href), next);
    const transition = transitionManagedHistory(window.history.state, sessionId, mode, sourceSnapshot, nextSnapshot, next.noteId !== null);
    if (mode === 'push') {
      window.history.replaceState(transition.currentState, '', window.location.href);
      window.history.pushState(transition.nextState, '', url);
    } else {
      const replaced = transitionManagedHistory(window.history.state, sessionId, 'replace', nextSnapshot, nextSnapshot, next.noteId !== null).nextState;
      window.history.replaceState(replaced, '', url);
    }
    setUrlState(next);
    setSnapshot(nextSnapshot);
    setExpandedFoldersState(nextSnapshot.expandedFolders);
    const entry = readManagedHistoryEntry(mode === 'push' ? transition.nextState : window.history.state, sessionId);
    setBoundaries(deriveHistoryBoundaries(entry));
  }, [sessionId, snapshot]);

  useEffect(() => {
    const onPopState = () => {
      const restored = parseBrowserUrl(window.location.search);
      const entry = readManagedHistoryEntry(window.history.state, sessionId);
      const nextSnapshot = entry?.snapshot ?? emptySnapshot;
      if (restored.noteId && !entry?.origin && index) {
        const note = index.notes.find((item) => item.id === restored.noteId);
        if (note) restored.folder = getNoteFolder(note);
      }
      if (index) {
        const requestedFolder = restored.folder;
        restored.folder = resolveFolder(index, restored.folder);
        if (restored.folder !== requestedFolder) {
          window.history.replaceState(window.history.state, '', writeBrowserUrl(new URL(window.location.href), restored));
        }
      }
      setUrlState(restored);
      setSnapshot(nextSnapshot);
      setExpandedFoldersState(nextSnapshot.expandedFolders);
      pendingRestoreRef.current = !restored.noteId && Boolean(entry);
      setRestoreAfterPop(Boolean(index && pendingRestoreRef.current));
      setBoundaries(deriveHistoryBoundaries(entry));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [index, sessionId]);

  useEffect(() => {
    if (!index) return;
    if (pendingRestoreRef.current) setRestoreAfterPop(true);

    const resolved = resolveFolder(index, urlState.folder);
    const params = new URLSearchParams(window.location.search);
    const invalidUrlState = (params.has('folder') && !urlState.folder)
      || (params.has('q') && !urlState.query)
      || (params.has('searchScope') && params.get('searchScope') !== 'vault')
      || (params.has('shared') && params.get('shared') !== '1');
    if (resolved !== urlState.folder || invalidUrlState) {
      const next = { ...urlState, folder: resolved };
      setUrlState(next);
      const transition = transitionManagedHistory(window.history.state, sessionId, 'replace', snapshot, snapshot, next.noteId !== null);
      window.history.replaceState(transition.nextState, '', writeBrowserUrl(new URL(window.location.href), next));
    }
  }, [index, sessionId, snapshot, urlState]);

  useEffect(() => {
    if (!index || !urlState.folder) return;
    const paths = getFolderAncestors(urlState.folder).filter(Boolean);
    if (paths.some((path) => !expandedFolders.includes(path))) {
      const next = [...new Set([...expandedFolders, ...paths])];
      setExpandedFolders(next);
    }
  }, [index, urlState.folder]);

  const setFolder = (folder: string, expanded = expandedFolders, sourceSnapshot = snapshot) => {
    const destination = { expandedFolders: expanded, scrollTop: 0, focusedKey: null };
    write({ ...urlState, folder, query: '', noteId: null }, 'push', destination, sourceSnapshot);
  };
  const setQuery = (query: string) => write({ ...urlState, query }, 'replace', snapshot);
  const setSearchScope = (searchScope: SearchScope) => write({ ...urlState, searchScope }, 'replace', snapshot);
  const setFilter = (filter: BrowserFilter) => write({ ...urlState, filter }, 'replace', snapshot);
  const setExpandedFolders = (paths: string[]) => {
    const next = { ...snapshot, expandedFolders: paths };
    setSnapshot(next);
    setExpandedFoldersState(paths);
    replaceSnapshotInHistory(next);
  };
  const updateSnapshot = (partial: Partial<BrowserSnapshot>) => {
    const next = { ...snapshot, ...partial };
    setSnapshot(next);
    replaceSnapshotInHistory(next);
  };

  const openNote = (noteId: string, currentSnapshot: BrowserSnapshot) => {
    write({ ...urlState, noteId }, 'push', currentSnapshot, currentSnapshot);
    const raw = asRecord(window.history.state);
    window.history.replaceState({ ...raw, mdShareBrowserOrigin: true }, '', window.location.href);
  };

  const returnFromNote = (folderIndex: FolderIndex | null) => {
    if (!urlState.noteId) return;
    const entry = readManagedHistoryEntry(window.history.state, sessionId);
    if (canReturnToBrowserOrigin(entry)) {
      window.history.back();
      return;
    }
    const note = folderIndex?.notes.find((item) => item.id === urlState.noteId);
    const next = { ...urlState, noteId: null, folder: note ? getNoteFolder(note) : urlState.folder };
    write(next, 'push', { ...snapshot, focusedKey: null, scrollTop: 0 });
  };

  const up = () => {
    if (!urlState.folder) return;
    const separator = urlState.folder.lastIndexOf('/');
    setFolder(separator < 0 ? '' : urlState.folder.slice(0, separator));
  };

  return {
    ...urlState,
    expandedFolders,
    snapshot,
    updateSnapshot,
    setFolder,
    setQuery,
    setSearchScope,
    setFilter,
    setExpandedFolders,
    openNote,
    returnFromNote,
    back: () => { if (boundaries.back) window.history.back(); },
    forward: () => { if (boundaries.forward) window.history.forward(); },
    canBack: boundaries.back,
    canForward: boundaries.forward,
    up,
    restoreAfterPop,
    completeRestore: () => {
      pendingRestoreRef.current = false;
      setRestoreAfterPop(false);
    },
  };
}
