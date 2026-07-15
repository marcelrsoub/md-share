import { StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export type LivePreviewDecorationKind =
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'hr'
  | 'codeFence'
  | 'syntax'
  | 'image';

export interface LivePreviewDecorationRange {
  kind: LivePreviewDecorationKind;
  from: number;
  to: number;
  className?: string;
  source?: string;
  alt?: string;
  title?: string;
  resolvedSource?: string | null;
}

interface LivePreviewOptions {
  resolveImageUrl?: (source: string) => string | null;
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly source: string,
    private readonly resolvedSource: string | null,
    private readonly title?: string,
  ) {
    super();
  }

  override eq(other: ImagePreviewWidget): boolean {
    return (
      other.alt === this.alt &&
      other.source === this.source &&
      other.resolvedSource === this.resolvedSource &&
      other.title === this.title
    );
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement('figure');
    wrapper.className = 'cm-live-image markdown-figure';

    if (!this.resolvedSource) {
      const fallback = document.createElement('span');
      fallback.className = 'markdown-image-fallback';
      fallback.textContent = this.alt || this.source;
      wrapper.append(fallback);
      return wrapper;
    }

    const image = document.createElement('img');
    image.className = 'markdown-image';
    image.src = this.resolvedSource;
    image.alt = this.alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    if (this.title) {
      image.title = this.title;
    }
    image.addEventListener('error', () => {
      wrapper.replaceChildren();
      const fallback = document.createElement('span');
      fallback.className = 'markdown-image-fallback';
      fallback.textContent = this.alt || this.source;
      wrapper.append(fallback);
    });
    wrapper.append(image);
    return wrapper;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function splitLinkParts(value: string): { source: string; title?: string } {
  const trimmed = value.trim();
  const titleMatch = trimmed.match(/^(.*?)(?:\s+"([^"]+)")?$/);
  if (!titleMatch) {
    return { source: trimmed };
  }

  return {
    source: titleMatch[1]?.trim() ?? trimmed,
    title: titleMatch[2],
  };
}

function addInlineSyntaxMarks(line: string, lineStart: number, ranges: LivePreviewDecorationRange[]): void {
  const patterns = [/(\*\*)(?=\S)/g, /(?<=\S)(\*\*)/g, /(\*)(?=\S)/g, /(?<=\S)(\*)/g, /(`)/g, /(\[|\]|\(|\))/g];

  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const text = match[0];
      const index = match.index ?? -1;
      if (index < 0 || !text) {
        continue;
      }
      ranges.push({
        kind: 'syntax',
        from: lineStart + index,
        to: lineStart + index + text.length,
        className: 'cm-live-syntax',
      });
    }
  }
}

function addImageWidgets(line: string, lineStart: number, ranges: LivePreviewDecorationRange[], options: LivePreviewOptions): void {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

  for (const match of line.matchAll(imagePattern)) {
    const index = match.index ?? -1;
    const alt = match[1] ?? '';
    const rawTarget = match[2] ?? '';
    if (index < 0 || !rawTarget.trim()) {
      continue;
    }

    const { source, title } = splitLinkParts(rawTarget);
    ranges.push({
      kind: 'image',
      from: lineStart + index,
      to: lineStart + index + match[0].length,
      className: 'cm-live-image-source',
      source,
      alt,
      title,
      resolvedSource: options.resolveImageUrl ? options.resolveImageUrl(source) : source,
    });
  }
}

export function collectLivePreviewDecorations(
  doc: { lines: number; line: (number: number) => { text: string; from: number; to: number } },
  options: LivePreviewOptions = {},
): LivePreviewDecorationRange[] {
  const ranges: LivePreviewDecorationRange[] = [];
  let inCodeBlock = false;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const text = line.text;
    const trimmed = text.trim();

    const fence = text.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      const isOpeningFence = !inCodeBlock;
      ranges.push({
        kind: 'codeFence',
        from: line.from,
        to: line.from,
        className: `cm-live-code-fence ${isOpeningFence ? 'cm-live-code-fence-open' : 'cm-live-code-fence-close'}`,
      });
      ranges.push({
        kind: 'syntax',
        from: line.from,
        to: line.to,
        className: 'cm-live-syntax',
      });
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      ranges.push({
        kind: 'codeFence',
        from: line.from,
        to: line.from,
        className: 'cm-live-code-line',
      });
      continue;
    }

    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      ranges.push({
        kind: 'heading',
        from: line.from,
        to: line.from,
        className: `cm-live-heading cm-live-heading-${level}`,
      });
      ranges.push({
        kind: 'syntax',
        from: line.from,
        to: line.from + level + 1,
        className: 'cm-live-syntax',
      });
      addInlineSyntaxMarks(heading[2] ?? '', line.from + level + 1, ranges);
      continue;
    }

    if (/^>\s?/.test(text)) {
      ranges.push({
        kind: 'blockquote',
        from: line.from,
        to: line.from,
        className: 'cm-live-blockquote',
      });
      const markerLength = text.startsWith('> ') ? 2 : 1;
      ranges.push({
        kind: 'syntax',
        from: line.from,
        to: line.from + markerLength,
        className: 'cm-live-syntax',
      });
      addInlineSyntaxMarks(text.slice(markerLength), line.from + markerLength, ranges);
      continue;
    }

    const list = text.match(/^(\s*)([-*+]|(\d+)\.)\s+(.*)$/);
    if (list) {
      const markerStart = line.from + (list[1]?.length ?? 0);
      const markerEnd = markerStart + (list[2]?.length ?? 0) + 1;
      ranges.push({
        kind: 'list',
        from: line.from,
        to: line.from,
        className: list[3] ? 'cm-live-list cm-live-list-ordered' : 'cm-live-list cm-live-list-unordered',
      });
      ranges.push({
        kind: 'syntax',
        from: markerStart,
        to: markerEnd,
        className: 'cm-live-syntax',
      });
      addInlineSyntaxMarks(list[4] ?? '', markerEnd, ranges);
      addImageWidgets(text, line.from, ranges, options);
      continue;
    }

    if (/^([-*_])\1\1+\s*$/.test(trimmed)) {
      ranges.push({
        kind: 'hr',
        from: line.from,
        to: line.from,
        className: 'cm-live-hr',
      });
      ranges.push({
        kind: 'syntax',
        from: line.from,
        to: line.to,
        className: 'cm-live-syntax',
      });
      continue;
    }

    addInlineSyntaxMarks(text, line.from, ranges);
    addImageWidgets(text, line.from, ranges, options);
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function buildLivePreviewDecorations(
  doc: { lines: number; line: (number: number) => { text: string; from: number; to: number } },
  options: LivePreviewOptions,
): DecorationSet {
  const decorations: Range<Decoration>[] = [];

  for (const range of collectLivePreviewDecorations(doc, options)) {
    if (range.kind === 'image') {
      decorations.push(Decoration.widget({
        widget: new ImagePreviewWidget(range.alt ?? '', range.source ?? '', range.resolvedSource ?? null, range.title),
        side: 1,
        block: true,
      }).range(range.to));
      decorations.push(Decoration.mark({ class: range.className }).range(range.from, range.to));
      continue;
    }

    if (range.from === range.to) {
      decorations.push(Decoration.line({ class: range.className }).range(range.from));
      continue;
    }

    decorations.push(Decoration.mark({ class: range.className }).range(range.from, range.to));
  }

  return Decoration.set(decorations, true);
}

export function livePreview(options: LivePreviewOptions = {}): Extension {
  const decorations = StateField.define<DecorationSet>({
    create(state) {
      return buildLivePreviewDecorations(state.doc, options);
    },
    update(value, transaction) {
      if (!transaction.docChanged) {
        return value.map(transaction.changes);
      }

      return buildLivePreviewDecorations(transaction.state.doc, options);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return [decorations];
}
