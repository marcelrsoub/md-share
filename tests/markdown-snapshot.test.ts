import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { resolveMarkdownSnapshot } from '../src/server/markdown-snapshot.js';

describe('resolveMarkdownSnapshot', () => {
  it('prefers the stored markdown snapshot when it exists', () => {
    expect(
      resolveMarkdownSnapshot({
        markdownSnapshot: '# Stored snapshot\n',
        yState: Buffer.alloc(0),
      }),
    ).toBe('# Stored snapshot\n');
  });

  it('derives markdown from legacy yjs state when the snapshot is missing', () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, '# Legacy content\n\nHello world\n');

    expect(
      resolveMarkdownSnapshot({
        markdownSnapshot: '',
        yState: Buffer.from(Y.encodeStateAsUpdate(doc)),
      }),
    ).toBe('# Legacy content\n\nHello world\n');
  });
});
