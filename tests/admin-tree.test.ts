import { describe, expect, it } from 'vitest';
import type { NoteSummary } from '../src/shared/types.js';
import { buildNoteTree } from '../src/client/admin/App.js';

describe('admin note tree', () => {
  it('groups notes by folder and keeps folders before notes at each level', () => {
    const tree = buildNoteTree([
      makeNote('root.md', 'root.md'),
      makeNote('docs/guide.md', 'guide.md'),
      makeNote('docs/api/reference.md', 'reference.md'),
      makeNote('docs/intro.md', 'intro.md'),
      makeNote('notes/alpha.md', 'alpha.md'),
    ]);

    expect(tree.map((node) => node.type === 'folder' ? node.name : node.note.name)).toEqual([
      'docs',
      'notes',
      'root.md',
    ]);

    const docs = tree[0];
    expect(docs?.type).toBe('folder');
    if (docs?.type === 'folder') {
      expect(docs.children.map((node) => node.type === 'folder' ? node.name : node.note.name)).toEqual([
        'api',
        'guide.md',
        'intro.md',
      ]);

      const api = docs.children[0];
      expect(api?.type).toBe('folder');
      if (api?.type === 'folder') {
        expect(api.children.map((node) => node.type === 'folder' ? node.name : node.note.name)).toEqual([
          'reference.md',
        ]);
      }
    }
  });
});

function makeNote(relativePath: string, name: string): NoteSummary {
  return {
    id: relativePath,
    name,
    relativePath,
    size: 0,
    modifiedAt: 0,
  };
}
