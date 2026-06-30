import { describe, expect, it } from 'vitest';
import { buildNoteTree, getFolderAncestors } from './App.js';
import type { NoteSummary } from '../../shared/types.js';

function makeNote(overrides: Partial<NoteSummary>): NoteSummary {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'note.md',
    relativePath: overrides.relativePath ?? 'note.md',
    size: overrides.size ?? 1,
    modifiedAt: overrides.modifiedAt ?? 1,
  };
}

describe('getFolderAncestors', () => {
  it('returns every folder above the note', () => {
    expect(getFolderAncestors('projects/alpha/brief.md')).toEqual(['projects', 'projects/alpha']);
  });

  it('returns an empty list for root notes', () => {
    expect(getFolderAncestors('note.md')).toEqual([]);
  });
});

describe('buildNoteTree', () => {
  it('groups notes into sorted folder branches', () => {
    const tree = buildNoteTree([
      makeNote({ id: '3', name: 'z.md', relativePath: 'work/z.md' }),
      makeNote({ id: '1', name: 'b.md', relativePath: 'work/alpha/b.md' }),
      makeNote({ id: '2', name: 'a.md', relativePath: 'work/a.md' }),
      makeNote({ id: '4', name: 'root.md', relativePath: 'root.md' }),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      type: 'folder',
      name: 'work',
      path: 'work',
      children: [
        {
          type: 'folder',
          name: 'alpha',
          path: 'work/alpha',
          children: [
            {
              type: 'note',
              note: expect.objectContaining({ id: '1', relativePath: 'work/alpha/b.md' }),
            },
          ],
        },
        {
          type: 'note',
          note: expect.objectContaining({ id: '2', relativePath: 'work/a.md' }),
        },
        {
          type: 'note',
          note: expect.objectContaining({ id: '3', relativePath: 'work/z.md' }),
        },
      ],
    });
    expect(tree[1]).toMatchObject({
      type: 'note',
      note: expect.objectContaining({ id: '4', relativePath: 'root.md' }),
    });
  });
});
