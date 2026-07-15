import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { collectLivePreviewDecorations } from '../src/client/public/live-preview.js';

function collect(content: string) {
  const state = EditorState.create({ doc: content });
  return collectLivePreviewDecorations(state.doc, {
    resolveImageUrl: (source) => `/assets?path=${encodeURIComponent(source)}`,
  });
}

describe('collectLivePreviewDecorations', () => {
  it('marks markdown structure without changing document text', () => {
    const content = ['# Heading **one**', '', '> quoted `code`', '', '- item', '', '---'].join('\n');
    const decorations = collect(content);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'heading', className: 'cm-live-heading cm-live-heading-1' }),
        expect.objectContaining({ kind: 'blockquote', className: 'cm-live-blockquote' }),
        expect.objectContaining({ kind: 'list', className: 'cm-live-list cm-live-list-unordered' }),
        expect.objectContaining({ kind: 'hr', className: 'cm-live-hr' }),
      ]),
    );
    expect(EditorState.create({ doc: content }).doc.toString()).toBe(content);
  });

  it('creates image widget metadata through the token-safe asset resolver', () => {
    const decorations = collect('![Cover image](cover.png "Cover")');
    const image = decorations.find((decoration) => decoration.kind === 'image');

    expect(image).toMatchObject({
      kind: 'image',
      source: 'cover.png',
      alt: 'Cover image',
      title: 'Cover',
      resolvedSource: '/assets?path=cover.png',
      className: 'cm-live-image-source',
    });
  });

  it('treats fenced code as editor content instead of inline markdown', () => {
    const content = ['```ts', 'const value = `not inline`;', '```'].join('\n');
    const state = EditorState.create({ doc: content });
    const decorations = collectLivePreviewDecorations(state.doc);
    const openingFence = state.doc.line(1);
    const codeLine = state.doc.line(2);
    const closingFence = state.doc.line(3);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'codeFence',
          className: 'cm-live-code-fence cm-live-code-fence-open',
          from: openingFence.from,
          to: openingFence.from,
        }),
        expect.objectContaining({ kind: 'codeFence', className: 'cm-live-code-line', from: codeLine.from, to: codeLine.from }),
        expect.objectContaining({
          kind: 'codeFence',
          className: 'cm-live-code-fence cm-live-code-fence-close',
          from: closingFence.from,
          to: closingFence.from,
        }),
      ]),
    );
    expect(decorations.filter((decoration) => decoration.className?.includes('cm-live-code-fence'))).toHaveLength(2);
    expect(decorations.filter((decoration) => decoration.className === 'cm-live-code-line')).toHaveLength(1);
    expect(
      decorations.filter(
        (decoration) =>
          decoration.kind === 'syntax' &&
          decoration.from >= codeLine.from &&
          decoration.to <= codeLine.to,
      ),
    ).toHaveLength(0);
  });
});
