import { describe, expect, it } from 'vitest';
import type { NoteSummary, ShareSummary } from '../src/shared/types.js';
import {
  collectFolderOptions,
  formatRelativeDay,
  getActiveShareCounts,
  getNoteDirectory,
  getNoteListEmptyState,
} from '../src/client/admin/App.js';

function makeNote(relativePath: string, name: string): NoteSummary {
  return {
    id: relativePath,
    name,
    relativePath,
    size: 0,
    modifiedAt: 0,
  };
}

function makeShare(noteId: string, status: ShareSummary['status']): ShareSummary {
  return {
    token: `${noteId}-${status}-${Math.random()}`,
    noteId,
    noteName: noteId,
    noteRelativePath: `${noteId}.md`,
    status,
    expiresAt: null,
    revokedAt: null,
    createdAt: 0,
    lastExportedAt: null,
    participantCount: 0,
    shareUrl: `https://example.com/s/${noteId}`,
  };
}

describe('admin file navigator empty states', () => {
  it('explains that the note library is empty when there is no search', () => {
    expect(getNoteListEmptyState('')).toEqual({
      title: 'No Markdown files found',
      description: 'Mount a notes folder containing .md files to start sharing.',
    });
  });

  it('distinguishes an empty search result and includes the trimmed query', () => {
    expect(getNoteListEmptyState('  roadmap  ')).toEqual({
      title: 'No matching Markdown files',
      description: 'No Markdown files match “roadmap”. Try another search.',
    });
  });
});

describe('collectFolderOptions', () => {
  it('returns sorted unique folders with Root first', () => {
    const folders = collectFolderOptions([
      makeNote('root.md', 'root.md'),
      makeNote('work/alpha/b.md', 'b.md'),
      makeNote('work/a.md', 'a.md'),
      makeNote('docs/guide.md', 'guide.md'),
      makeNote('work/alpha/c.md', 'c.md'),
    ]);

    expect(folders).toEqual(['Root', 'docs', 'work', 'work/alpha']);
  });
});

describe('getActiveShareCounts', () => {
  it('counts links per note and ignores revoked links', () => {
    const counts = getActiveShareCounts([
      makeShare('a', 'active'),
      makeShare('a', 'expired'),
      makeShare('a', 'revoked'),
      makeShare('b', 'conflict'),
    ]);

    expect(counts).toEqual({ a: 2, b: 1 });
  });
});

describe('formatRelativeDay', () => {
  const now = new Date('2026-07-17T14:00:00').getTime();

  it('labels today and yesterday', () => {
    expect(formatRelativeDay(new Date('2026-07-17T09:00:00').getTime(), now)).toBe('Today');
    expect(formatRelativeDay(new Date('2026-07-16T23:30:00').getTime(), now)).toBe('Yesterday');
  });

  it('falls back to a short date for older files', () => {
    expect(formatRelativeDay(new Date('2026-07-12T12:00:00').getTime(), now)).toBe('Jul 12');
  });

  it('includes the year for files from another year', () => {
    expect(formatRelativeDay(new Date('2025-12-30T12:00:00').getTime(), now)).toBe('Dec 30, 2025');
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
