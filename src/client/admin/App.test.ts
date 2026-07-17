import { describe, expect, it } from 'vitest';
import { buildNoteTree, formatShareExpiry, getFolderAncestors, getNoteDirectory, parseExpirySelection } from './App.js';
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

describe('getNoteDirectory', () => {
  it('shows the containing folder without repeating the filename', () => {
    expect(getNoteDirectory('demo/planning/launch-checklist.md')).toBe('demo/planning');
  });

  it('labels root notes as Root', () => {
    expect(getNoteDirectory('overview.md')).toBe('Root');
  });
});

describe('formatShareExpiry', () => {
  const now = Date.parse('2026-07-17T14:00:00.000Z');

  it('describes permanent shares', () => {
    expect(formatShareExpiry(null, now)).toBe('Never expires');
  });

  it('shows the remaining time at useful precision', () => {
    expect(formatShareExpiry(now + 30 * 60_000, now)).toBe('Expires in 30 minutes');
    expect(formatShareExpiry(now + 90 * 60_000, now)).toBe('Expires in 1h 30m');
    expect(formatShareExpiry(now + 26 * 60 * 60_000, now)).toBe('Expires in 1d 2h');
  });

  it('marks elapsed shares as expired', () => {
    expect(formatShareExpiry(now - 1, now)).toBe('Expired');
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

describe('parseExpirySelection', () => {
  it('returns null for never or empty selections', () => {
    expect(parseExpirySelection('')).toBeNull();
    expect(parseExpirySelection('   ')).toBeNull();
  });

  it('parses preset minute values', () => {
    expect(parseExpirySelection('30')).toBe(30);
    expect(parseExpirySelection('1440')).toBe(1440);
  });

  it('rejects invalid values', () => {
    expect(parseExpirySelection('0')).toBeNull();
    expect(parseExpirySelection('abc')).toBeNull();
  });
});
