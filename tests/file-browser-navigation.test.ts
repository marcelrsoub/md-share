import { describe, expect, it } from 'vitest';
import {
  canReturnToBrowserOrigin,
  deriveHistoryBoundaries,
  normalizeBrowserSnapshot,
  parseBrowserUrl,
  readManagedHistoryEntry,
  transitionManagedHistory,
  writeBrowserUrl,
  type BrowserSnapshot,
} from '../src/client/admin/use-file-browser.js';

const snapshot = (focusedKey: string | null, scrollTop = 0): BrowserSnapshot => ({
  expandedFolders: ['Projects'],
  scrollTop,
  focusedKey,
});

describe('file browser URL state', () => {
  it('writes encoded browsing state while preserving unrelated parameters and hash', () => {
    const current = new URL('https://example.test/admin?keep=hello&folder=old&note=stale#panel');
    const result = writeBrowserUrl(current, {
      folder: 'Root/Planning & notes',
      query: 'alpha beta',
      searchScope: 'vault',
      filter: 'shared',
      noteId: 'note /?&',
    });

    expect(result.searchParams.get('keep')).toBe('hello');
    expect(result.searchParams.get('folder')).toBe('Root/Planning & notes');
    expect(result.searchParams.get('q')).toBe('alpha beta');
    expect(result.searchParams.get('searchScope')).toBe('vault');
    expect(result.searchParams.get('shared')).toBe('1');
    expect(result.searchParams.get('note')).toBe('note /?&');
    expect(result.hash).toBe('#panel');
  });

  it('omits default and root values without losing unrelated query state', () => {
    const result = writeBrowserUrl(new URL('https://example.test/admin?keep=1&folder=old&q=old'), {
      folder: '',
      query: '',
      searchScope: 'folder',
      filter: 'all',
      noteId: null,
    });

    expect(result.search).toBe('?keep=1');
  });

  it('parses malformed scope enums as safe defaults', () => {
    expect(parseBrowserUrl('?folder=bad%2Fpath&q=hello&searchScope=other&shared=true&note=n')).toEqual({
      folder: 'bad/path',
      query: 'hello',
      searchScope: 'folder',
      filter: 'all',
      noteId: 'n',
    });
  });
});

describe('managed browser history', () => {
  const sessionId = 'tab-session';

  it('validates namespaced entries and derives reload boundaries', () => {
    const started = transitionManagedHistory({ unrelated: 'keep' }, sessionId, 'push', snapshot(null), snapshot('folder:A'), false);
    const reloaded = readManagedHistoryEntry(started.nextState, sessionId);

    expect(reloaded).toEqual({
      sessionId,
      position: 1,
      maxPosition: 1,
      snapshot: snapshot('folder:A'),
      origin: false,
    });
    expect(firstSnapshot(started.currentState)).toEqual(snapshot(null));
    expect(firstSnapshot(started.nextState)).toEqual(snapshot('folder:A'));
    expect(deriveHistoryBoundaries(reloaded)).toEqual({ back: true, forward: false });
    expect(readManagedHistoryEntry(started.nextState, 'another-tab')).toBeNull();
    expect(readManagedHistoryEntry('not-object', sessionId)).toBeNull();
    expect(started.nextState.unrelated).toBe('keep');
  });

  it('keeps Forward enabled after replacing a location following Back', () => {
    const first = transitionManagedHistory({}, sessionId, 'push', snapshot(null), snapshot('root'), false);
    const second = transitionManagedHistory(first.nextState, sessionId, 'push', snapshot('root'), snapshot('folder:A'), false);
    const note = transitionManagedHistory(second.nextState, sessionId, 'push', snapshot('folder:A'), snapshot('note:n'), true);
    const backedToFolder = second.currentState;
    const edited = transitionManagedHistory(backedToFolder, sessionId, 'replace', snapshot('folder:A', 81), snapshot('folder:A', 81), false);
    const entry = readManagedHistoryEntry(edited.nextState, sessionId);

    expect(entry?.position).toBe(1);
    expect(entry?.maxPosition).toBe(2);
    expect(deriveHistoryBoundaries(entry)).toEqual({ back: true, forward: true });
    expect(note.nextState.mdShareBrowserPosition).toBe(3);
  });

  it('truncates a forward branch and clears inherited preview origin on folder pushes', () => {
    const folder = transitionManagedHistory({}, sessionId, 'push', snapshot(null), snapshot('folder:A'), false);
    const child = transitionManagedHistory(folder.nextState, sessionId, 'push', snapshot('folder:A'), snapshot('folder:A/B'), false);
    const preview = transitionManagedHistory(child.nextState, sessionId, 'push', snapshot('folder:A/B'), snapshot('note:n'), true);
    const previewState = { ...preview.nextState, mdShareBrowserOrigin: true };
    const backedPreviewOrigin = { ...child.currentState, mdShareBrowserOrigin: true };
    const replacementFolder = transitionManagedHistory(backedPreviewOrigin, sessionId, 'push', snapshot('folder:A'), snapshot('folder:C'), false);

    expect(previewState.mdShareBrowserOrigin).toBe(true);
    expect(replacementFolder.nextState.mdShareBrowserPosition).toBe(2);
    expect(replacementFolder.nextState.mdShareBrowserMaxPosition).toBe(2);
    expect('mdShareBrowserOrigin' in replacementFolder.nextState).toBe(false);
    expect(deriveHistoryBoundaries(readManagedHistoryEntry(replacementFolder.nextState, sessionId))).toEqual({ back: true, forward: false });
  });

  it('uses the containing-folder fallback for direct note links without a saved origin', () => {
    const directEntry = readManagedHistoryEntry({
      mdShareBrowserSessionId: sessionId,
      mdShareBrowserPosition: 0,
      mdShareBrowserMaxPosition: 0,
      mdShareBrowserSnapshot: snapshot(null),
      mdShareBrowserOrigin: true,
    }, sessionId);
    const previewEntry = readManagedHistoryEntry({
      mdShareBrowserSessionId: sessionId,
      mdShareBrowserPosition: 1,
      mdShareBrowserMaxPosition: 1,
      mdShareBrowserSnapshot: snapshot('note:n'),
      mdShareBrowserOrigin: true,
    }, sessionId);

    expect(canReturnToBrowserOrigin(directEntry)).toBe(false);
    expect(canReturnToBrowserOrigin(previewEntry)).toBe(true);
  });

  it('rejects malformed snapshots instead of trusting history payloads', () => {
    expect(normalizeBrowserSnapshot({ expandedFolders: ['A', 4], scrollTop: 1, focusedKey: null })).toBeNull();
    expect(normalizeBrowserSnapshot({ expandedFolders: [], scrollTop: Number.NaN, focusedKey: null })).toBeNull();
    expect(normalizeBrowserSnapshot({ expandedFolders: ['A', 'A'], scrollTop: 8, focusedKey: 'folder:A' })).toEqual({
      expandedFolders: ['A'],
      scrollTop: 8,
      focusedKey: 'folder:A',
    });
  });

  it('restores the originating folder snapshot after preview Back and keeps Forward through search edits', () => {
    const initial = transitionManagedHistory({ unrelated: { keep: true } }, sessionId, 'push', snapshot(null), snapshot('folder:Projects', 42), false);
    const searched = transitionManagedHistory(initial.nextState, sessionId, 'replace', snapshot('folder:Projects', 42), snapshot('folder:Projects', 42), false);
    const preview = transitionManagedHistory(searched.nextState, sessionId, 'push', snapshot('folder:Projects', 42), snapshot('folder:Projects', 42), true);
    const previewState = { ...preview.nextState, mdShareBrowserOrigin: true };
    const returnedByBrowserBack = preview.currentState;
    const editedAfterBack = transitionManagedHistory(returnedByBrowserBack, sessionId, 'replace', snapshot('folder:Projects', 92), snapshot('folder:Projects', 92), false);
    const restored = readManagedHistoryEntry(editedAfterBack.nextState, sessionId);

    expect(readManagedHistoryEntry(previewState, sessionId)?.origin).toBe(true);
    expect(restored?.snapshot).toEqual(snapshot('folder:Projects', 92));
    expect(deriveHistoryBoundaries(restored)).toEqual({ back: true, forward: true });
    expect(editedAfterBack.nextState.unrelated).toEqual({ keep: true });
  });

  it('rejects malformed origin markers rather than treating them as a managed entry', () => {
    const entry = transitionManagedHistory({}, sessionId, 'push', snapshot(null), snapshot('folder:A'), false);
    expect(readManagedHistoryEntry({ ...entry.nextState, mdShareBrowserOrigin: 'yes' }, sessionId)).toBeNull();
  });
});

function firstSnapshot(state: Record<string, unknown>): unknown {
  return state.mdShareBrowserSnapshot;
}
