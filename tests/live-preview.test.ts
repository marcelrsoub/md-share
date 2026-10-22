import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { collectInlinePreviewDecorations, collectLivePreviewDecorations, isInlinePreviewMarkClass, shouldOpenLinkOnModifierClick, toggleTaskSource } from '../src/client/public/live-preview.js';

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

  it('preserves ordered and unordered markers in rendered list lines', () => {
    const decorations = collect(['- unordered', '12. ordered', '- [x] done', '- [ ] todo'].join('\n'));

    expect(decorations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'syntax', className: 'cm-live-list-marker', source: '•' }),
      expect.objectContaining({ kind: 'syntax', className: 'cm-live-list-marker', source: '12.' }),
      expect.objectContaining({ kind: 'task', checked: true, interactive: true, source: '', from: 24, to: 30 }),
      expect.objectContaining({ kind: 'task', checked: false, interactive: true, source: '', from: 35, to: 41 }),
    ]));
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

  it('keeps structure classes on the active line so line heights stay stable', () => {
    const content = ['# Heading', '**emphasis**', '- item'].join('\n');
    const state = EditorState.create({ doc: content });
    const decorations = collectLivePreviewDecorations(state.doc, { activeLineNumber: 1 });
    const activeHeading = state.doc.line(1);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'heading', from: activeHeading.from, to: activeHeading.from }),
        expect.objectContaining({ kind: 'list', from: state.doc.line(3).from, to: state.doc.line(3).from }),
      ]),
    );

    expect(
      decorations.some(
        (decoration) => decoration.kind === 'syntax' && decoration.from >= activeHeading.from && decoration.to <= activeHeading.to,
      ),
    ).toBe(false);
  });

  it('renders read-only previews fully without revealing active-line sources', () => {
    const content = ['# Heading', '**emphasis**', '- item'].join('\n');
    const state = EditorState.create({ doc: content });
    const decorations = collectLivePreviewDecorations(state.doc, { activeLineNumber: 1, revealActiveSource: false });
    const headingLine = state.doc.line(1);

    expect(decorations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'syntax',
          from: headingLine.from,
          to: headingLine.from + 2,
          className: 'cm-live-syntax',
        }),
      ]),
    );
  });

  it('keeps horizontal-rule line structure and replaces only its source when rendered', () => {
    const state = EditorState.create({ doc: '---' });
    expect(collectLivePreviewDecorations(state.doc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hr', from: 0, to: 0, className: 'cm-live-hr' }),
      expect.objectContaining({ kind: 'syntax', from: 0, to: 3, className: 'cm-live-hr-widget' }),
    ]));
    expect(collectLivePreviewDecorations(state.doc, { activeLineNumber: 1 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hr', className: 'cm-live-hr' }),
    ]));
    expect(collectLivePreviewDecorations(state.doc, { activeLineNumber: 1 }).some((item) => item.className === 'cm-live-hr-widget')).toBe(false);
  });

  it('hides formatting delimiters only when the parser recognizes formatting', () => {
    const source = 'The (parenthetical) note [stays] and **bold** *soft* ~~gone~~ `code`';
    const state = EditorState.create({ doc: source, extensions: [markdown({ extensions: [GFM] })] });
    const inline = collectInlinePreviewDecorations(state);
    expect(inline).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'cm-live-strong' }),
      expect.objectContaining({ className: 'cm-live-em' }),
      expect.objectContaining({ className: 'cm-live-strike' }),
      expect.objectContaining({ className: 'cm-live-inline-code' }),
    ]));
    const hiddenDelimiters = inline
      .filter((item) => item.kind === 'syntax' && item.className === 'cm-live-syntax')
      .map((item) => source.slice(item.from, item.to));
    expect(hiddenDelimiters).toEqual(expect.arrayContaining(['**', '*', '~~', '`']));
    expect(hiddenDelimiters).not.toContain('(');
    expect(hiddenDelimiters).not.toContain(')');
    expect(hiddenDelimiters).not.toContain('[');
    expect(hiddenDelimiters).not.toContain(']');
  });

  it('previews Obsidian highlight spans outside code, links, and active lines', () => {
    const source = '==marked== `==code==` [==link==](https://example.com/==destination==) \\==literal==';
    const state = EditorState.create({ doc: source, extensions: [markdown({ extensions: [GFM] })] });
    const inline = collectInlinePreviewDecorations(state);
    const highlighted = inline.filter((item) => item.className === 'cm-live-highlight').map((item) => source.slice(item.from, item.to));
    expect(highlighted).toEqual(['marked']);
    expect(isInlinePreviewMarkClass('cm-live-highlight')).toBe(true);
    expect(collectInlinePreviewDecorations(state, { activeLineNumber: 1 }).some((item) => item.className === 'cm-live-highlight')).toBe(false);
  });

  it('uses a line-break-anchored block range only for standalone images', () => {
    const standalone = EditorState.create({ doc: '![standalone](cover.png)\nNext line' });
    const standaloneImage = collectLivePreviewDecorations(standalone.doc).find((item) => item.kind === 'image');
    expect(standaloneImage).toMatchObject({ kind: 'image', from: 0, to: standalone.doc.line(1).to + 1, block: true });

    const inline = EditorState.create({ doc: 'before ![inline](cover.png) after' });
    const inlineImage = collectLivePreviewDecorations(inline.doc).find((item) => item.kind === 'image');
    expect(inlineImage).toMatchObject({ kind: 'image', from: 7, to: 7 + '![inline](cover.png)'.length, block: false });

    const finalLine = EditorState.create({ doc: '![final](cover.png)' });
    const finalImage = collectLivePreviewDecorations(finalLine.doc).find((item) => item.kind === 'image');
    expect(finalImage).toMatchObject({ kind: 'image', from: 0, to: finalLine.doc.length, block: false });
  });

  it('collects safe link label metadata and leaves unsafe links untouched', () => {
    const state = EditorState.create({ doc: '[site](https://example.com "Example") [bad](javascript:alert(1))', extensions: [markdown({ extensions: [GFM] })] });
    const inline = collectInlinePreviewDecorations(state);
    expect(inline).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'cm-live-link', href: 'https://example.com', external: true, title: 'Example' }),
    ]));
    expect(inline.some((item) => item.className === 'cm-live-link' && item.href?.startsWith('javascript:'))).toBe(false);
  });

  it('opens only supported links on modifier-click', () => {
    expect(shouldOpenLinkOnModifierClick({ metaKey: true, ctrlKey: false }, 'https://example.com')).toBe(true);
    expect(shouldOpenLinkOnModifierClick({ metaKey: false, ctrlKey: true }, 'mailto:hello@example.com')).toBe(true);
    expect(shouldOpenLinkOnModifierClick({ metaKey: true, ctrlKey: false }, 'javascript:alert(1)')).toBe(false);
    expect(shouldOpenLinkOnModifierClick({ metaKey: false, ctrlKey: false }, 'https://example.com')).toBe(false);
  });

  it('creates checkbox metadata and toggles task source without changing other text', () => {
    const unordered = collectLivePreviewDecorations(EditorState.create({ doc: '- [ ] todo' }).doc);
    const unchecked = unordered.find((item) => item.kind === 'task');
    expect(unchecked).toMatchObject({ kind: 'task', checked: false, interactive: true, from: 0, to: 6 });
    expect(collectLivePreviewDecorations(EditorState.create({ doc: '3. [ ] numbered' }).doc)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'task', source: '3.', from: 0, to: 7 }),
    ]));
    expect(toggleTaskSource('- [ ] keep text')).toBe('- [x] keep text');
    expect(toggleTaskSource('2. [X] done')).toBe('2. [ ] done');
    const readonly = collectLivePreviewDecorations(EditorState.create({ doc: '- [x] done' }).doc, { interactive: false });
    expect(readonly).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'task', checked: true, interactive: false })]));
  });

  it('replaces a table block while keeping its source available on active lines', () => {
    const content = ['| Name | Status |', '| :--- | ---: |', '| MD Share | Ready |', '', '# After'].join('\n');
    const state = EditorState.create({ doc: content });
    const table = collectLivePreviewDecorations(state.doc);

    expect(table).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'table',
          from: state.doc.line(1).from,
          to: state.doc.line(3).to,
          table: expect.objectContaining({ headers: ['Name', 'Status'], rows: [['MD Share', 'Ready']] }),
        }),
      ]),
    );

    expect(
      collectLivePreviewDecorations(state.doc, { activeLineNumber: 2 }).some((decoration) => decoration.kind === 'table'),
    ).toBe(false);
  });
});
