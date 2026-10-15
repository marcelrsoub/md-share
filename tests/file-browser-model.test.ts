import { describe, expect, it } from 'vitest';
import type { NoteSummary, ShareSummary } from '../src/shared/types.js';
import {
  buildFolderIndex,
  folderContainsNotes,
  getBreadcrumbs,
  getFolderAncestors,
  getFolderEntries,
  getNoteFolder,
  getParentFolder,
  getSharedNoteIds,
  resolveFolder,
  searchNotes,
} from '../src/client/admin/file-browser-model.js';

function note(relativePath: string, id = relativePath): NoteSummary {
  return {
    id,
    name: relativePath.split('/').at(-1)!,
    relativePath,
    size: 0,
    modifiedAt: 0,
  };
}

function share(noteId: string, status: ShareSummary['status']): ShareSummary {
  return {
    token: `${noteId}-${status}`,
    noteId,
    noteName: noteId,
    noteRelativePath: `${noteId}.md`,
    status,
    expiresAt: null,
    revokedAt: null,
    createdAt: 0,
    lastExportedAt: null,
    participantCount: 0,
    shareUrl: `https://example.test/${noteId}`,
  };
}

describe('folder model hierarchy', () => {
  it('indexes root notes, nested notes, and ancestor-only folders', () => {
    const index = buildFolderIndex([note('top.md'), note('a/b/c/deep.md')]);

    expect(index.folders.get('')).toMatchObject({ path: '', name: 'Vault', parentPath: null });
    expect(index.folders.get('')?.notes.map(({ name }) => name)).toEqual(['top.md']);
    expect(index.folders.get('a')).toMatchObject({ path: 'a', name: 'a', parentPath: '' });
    expect(index.folders.get('a')?.notes).toEqual([]);
    expect(index.folders.get('a/b')?.childPaths).toEqual(['a/b/c']);
    expect(index.folders.get('a/b/c')?.notes.map(({ name }) => name)).toEqual(['deep.md']);
    expect(index.folders.get('')?.childPaths).toEqual(['a']);
  });

  it('keeps duplicate basenames, a real Root folder, and Unicode/spaced names distinct', () => {
    const index = buildFolderIndex([
      note('Root/Shared Name.md', 'root-note'),
      note('résumé space/Shared Name.md', 'unicode-note'),
      note('other/Shared Name.md', 'other-note'),
    ]);

    expect(index.folders.has('Root')).toBe(true);
    expect(index.folders.get('')?.name).toBe('Vault');
    expect(index.folders.get('Root')?.notes[0]?.id).toBe('root-note');
    expect(getBreadcrumbs('résumé space/Shared Name')).toEqual([
      { path: '', name: 'Vault' },
      { path: 'résumé space', name: 'résumé space' },
      { path: 'résumé space/Shared Name', name: 'Shared Name' },
    ]);
    expect(index.notes.map(({ id }) => id)).toEqual(['other-note', 'unicode-note', 'root-note']);
    expect(getNoteFolder(note('résumé space/Shared Name.md'))).toBe('résumé space');
    expect(getNoteFolder(note('at-root.md'))).toBe('');
  });

  it('uses directory boundaries for scoped membership and search', () => {
    const index = buildFolderIndex([
      note('Work/plan.md', 'work'),
      note('Workshop/plan.md', 'workshop'),
      note('Work/archive/launch plan.md', 'nested'),
    ]);

    expect(folderContainsNotes(index, 'Work')).toBe(true);
    expect(searchNotes(index, 'plan', 'Work', 'folder').map(({ note: found }) => found.id)).toEqual(['nested', 'work']);
    expect(searchNotes(index, 'plan', 'Work', 'vault').map(({ note: found }) => found.id))
      .toEqual(['nested', 'work', 'workshop']);
    expect(folderContainsNotes(index, 'Work', new Set(['workshop']))).toBe(false);
  });

  it('orders folders before files with natural, case-insensitive names', () => {
    const index = buildFolderIndex([
      note('item 10.md'),
      note('folder 10/z.md'),
      note('folder 2/z.md'),
      note('item 2.md'),
      note('Folder 1/z.md'),
    ]);

    const entries = getFolderEntries(index, '');
    expect(entries.map((entry) => `${entry.type}:${entry.type === 'folder' ? entry.name : entry.note.name}`))
      .toEqual([
        'folder:Folder 1',
        'folder:folder 2',
        'folder:folder 10',
        'note:item 2.md',
        'note:item 10.md',
      ]);
    expect(entries[0]?.key).toBe('folder:Folder 1');
    expect(entries.at(-1)?.key).toBe('note:item 10.md');
  });

  it('treats IDs as opaque and gives note and folder rows distinct keys', () => {
    const index = buildFolderIndex([
      note('__proto__.md', '__proto__'),
      note('constructor.md', 'constructor'),
      note('toString.md', 'toString'),
      note('note:some-id.md', 'some-id'),
      note('some-id/file.md', 'child'),
    ]);
    const ids = getSharedNoteIds([
      share('__proto__', 'active'),
      share('constructor', 'expired'),
      share('toString', 'dirty'),
      share('some-id', 'conflict'),
      share('revoked', 'revoked'),
    ]);

    expect([...ids]).toEqual(['__proto__', 'constructor', 'toString', 'some-id']);
    const entries = getFolderEntries(index, '', ids);
    expect(entries.filter(({ type }) => type === 'note').map(({ key }) => key))
      .toEqual(['note:__proto__', 'note:constructor', 'note:some-id', 'note:toString']);
    expect(getFolderEntries(index, 'some-id')[0]?.key).toBe('note:child');
    expect(new Set(entries.map(({ key }) => key)).size).toBe(entries.length);
  });
});

describe('folder navigation helpers', () => {
  it('returns parent, ancestor, and breadcrumb paths without using labels as identity', () => {
    expect(getParentFolder('')).toBeNull();
    expect(getParentFolder('Root')).toBe('');
    expect(getParentFolder('one/two/three')).toBe('one/two');
    expect(getFolderAncestors('')).toEqual([]);
    expect(getFolderAncestors('one/two/three')).toEqual(['', 'one', 'one/two']);
    expect(getBreadcrumbs('')).toEqual([{ path: '', name: 'Vault' }]);
    expect(getBreadcrumbs('Root')).toEqual([{ path: '', name: 'Vault' }, { path: 'Root', name: 'Root' }]);
  });

  it('falls back to the nearest indexed ancestor and safely rejects malformed paths', () => {
    const index = buildFolderIndex([note('one/two/note.md')]);

    expect(resolveFolder(index, 'one/two/removed/deeper')).toBe('one/two');
    expect(resolveFolder(index, 'one/removed')).toBe('one');
    expect(resolveFolder(index, 'missing')).toBe('');
    for (const invalid of ['/one', 'one/', 'one//two', 'one/./two', 'one/../two', 'one\\two']) {
      expect(resolveFolder(index, invalid)).toBe('');
      expect(getParentFolder(invalid)).toBeNull();
      expect(getBreadcrumbs(invalid)).toEqual([{ path: '', name: 'Vault' }]);
    }
    expect(index.notes.map(({ relativePath }) => relativePath)).toEqual(['one/two/note.md']);
  });
});

describe('shared filtering and search', () => {
  it('includes all non-revoked share statuses and prunes empty branches', () => {
    const index = buildFolderIndex([
      note('active/a.md', 'active'),
      note('expired/b.md', 'expired'),
      note('dirty/c.md', 'dirty'),
      note('conflict/d.md', 'conflict'),
      note('revoked/e.md', 'revoked'),
      note('unshared/f.md', 'unshared'),
    ]);
    const allowed = getSharedNoteIds([
      share('active', 'active'),
      share('expired', 'expired'),
      share('dirty', 'dirty'),
      share('conflict', 'conflict'),
      share('revoked', 'revoked'),
    ]);

    expect([...allowed]).toEqual(['active', 'expired', 'dirty', 'conflict']);
    expect(getFolderEntries(index, '', allowed).map((entry) => entry.type === 'folder' ? entry.path : entry.type))
      .toEqual(['active', 'conflict', 'dirty', 'expired']);
    expect(folderContainsNotes(index, 'revoked', allowed)).toBe(false);
    expect(folderContainsNotes(index, 'unshared', allowed)).toBe(false);
  });

  it('matches every trimmed case-insensitive search term locally or across the vault', () => {
    const index = buildFolderIndex([
      note('Projects/2026/Roadmap Draft.md', 'roadmap'),
      note('Projects/2025/roadmap-final.md', 'final'),
      note('Elsewhere/Roadmap Draft.md', 'elsewhere'),
      note('Projects/2026/Status.md', 'status'),
    ]);

    expect(searchNotes(index, '  ROADMAP   draft ', 'Projects', 'folder').map(({ note: found }) => found.id))
      .toEqual(['roadmap']);
    expect(searchNotes(index, 'roadmap', 'Projects', 'folder').map(({ note: found }) => found.id))
      .toEqual(['roadmap', 'final']);
    expect(searchNotes(index, 'roadmap', 'Projects', 'vault').map(({ note: found }) => found.id))
      .toEqual(['elsewhere', 'roadmap', 'final']);
    expect(searchNotes(index, 'ROADMAP draft', 'Projects', 'vault', new Set(['elsewhere'])))
      .toMatchObject([{ note: { id: 'elsewhere' } }]);
    expect(searchNotes(index, '   ', 'Projects', 'folder').map(({ note: found }) => found.id))
      .toEqual(['roadmap', 'final', 'status']);
  });
});
