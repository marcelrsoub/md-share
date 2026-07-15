import { StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { resolveMarkdownImageSource } from '../shared/markdown-assets.js';
import { parseMarkdownTable, type MarkdownTableData } from '../shared/markdown-table.js';

export type LivePreviewDecorationKind =
  | 'heading'
  | 'blockquote'
  | 'list'
  | 'hr'
  | 'codeFence'
  | 'syntax'
  | 'image'
  | 'table';

export interface LivePreviewDecorationRange {
  kind: LivePreviewDecorationKind;
  from: number;
  to: number;
  className?: string;
  source?: string;
  alt?: string;
  title?: string;
  resolvedSource?: string | null;
  table?: MarkdownTableData;
}

export interface LivePreviewOptions {
  resolveImageUrl?: (source: string) => string | null;
  activeLineNumber?: number;
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

  override get estimatedHeight(): number {
    return 180;
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
    image.loading = 'eager';
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

function stripTableInlineSyntax(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__|[*_`~]/g, '');
}

class TablePreviewWidget extends WidgetType {
  constructor(private readonly table: MarkdownTableData) {
    super();
  }

  override get estimatedHeight(): number {
    return Math.max(120, (this.table.rows.length + 1) * 48);
  }

  override eq(other: TablePreviewWidget): boolean {
    return JSON.stringify(other.table) === JSON.stringify(this.table);
  }

  override toDOM(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-table markdown-table-wrap';

    const tableElement = document.createElement('table');
    tableElement.className = 'markdown-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const [columnIndex, header] of this.table.headers.entries()) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = stripTableInlineSyntax(header);
      cell.style.textAlign = this.table.alignments[columnIndex] ?? '';
      headRow.append(cell);
    }
    head.append(headRow);
    tableElement.append(head);

    if (this.table.rows.length > 0) {
      const body = document.createElement('tbody');
      for (const row of this.table.rows) {
        const rowElement = document.createElement('tr');
        for (const [columnIndex, value] of row.entries()) {
          const cell = document.createElement('td');
          cell.textContent = stripTableInlineSyntax(value);
          cell.style.textAlign = this.table.alignments[columnIndex] ?? '';
          rowElement.append(cell);
        }
        body.append(rowElement);
      }
      tableElement.append(body);
    }

    wrapper.append(tableElement);
    return wrapper;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class TextMarkerWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly className: string,
  ) {
    super();
  }

  override eq(other: TextMarkerWidget): boolean {
    return other.text === this.text && other.className === this.className;
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = this.className;
    marker.textContent = this.text;
    return marker;
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
  const syntaxPattern = /(\*\*|(?<!\*)\*(?!\*)|`|\[|\]|\(|\))/g;

  for (const match of line.matchAll(syntaxPattern)) {
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
      resolvedSource: resolveMarkdownImageSource(source, options.resolveImageUrl),
    });
  }
}

export function collectLivePreviewDecorations(
  doc: { lines: number; line: (number: number) => { text: string; from: number; to: number } },
  options: LivePreviewOptions = {},
): LivePreviewDecorationRange[] {
  const ranges: LivePreviewDecorationRange[] = [];
  let inCodeBlock = false;
  const sourceLines = Array.from({ length: doc.lines }, (_, index) => doc.line(index + 1).text);

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const text = line.text;
    const trimmed = text.trim();
    const isActiveLine = options.activeLineNumber === lineNumber;

    const parsedTable = inCodeBlock ? null : parseMarkdownTable(sourceLines, lineNumber - 1);
    if (parsedTable) {
      const lastTableLineNumber = parsedTable.nextIndex;
      const activeLineInTable =
        options.activeLineNumber != null &&
        options.activeLineNumber >= lineNumber &&
        options.activeLineNumber <= lastTableLineNumber;
      if (!activeLineInTable) {
        ranges.push({
          kind: 'table',
          from: line.from,
          to: doc.line(lastTableLineNumber).to,
          table: parsedTable.table,
        });
      }
      lineNumber = lastTableLineNumber;
      continue;
    }

    const fence = text.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      const isOpeningFence = !inCodeBlock;
      if (!isActiveLine) {
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
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      if (!isActiveLine) {
        ranges.push({
          kind: 'codeFence',
          from: line.from,
          to: line.from,
          className: 'cm-live-code-line',
        });
      }
      continue;
    }

    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading && !isActiveLine) {
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

    if (/^>\s?/.test(text) && !isActiveLine) {
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
    if (list && !isActiveLine) {
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
        className: 'cm-live-list-marker',
        source: list[3] ? `${list[3]}.` : '•',
      });
      const taskMarker = (list[4] ?? '').match(/^\[([ xX])\]\s+/);
      if (taskMarker) {
        ranges.push({
          kind: 'syntax',
          from: markerEnd,
          to: markerEnd + taskMarker[0].length,
          className: 'cm-live-task-marker',
          source: taskMarker[1]?.toLowerCase() === 'x' ? '✓' : '',
        });
        addInlineSyntaxMarks(
          (list[4] ?? '').slice(taskMarker[0].length),
          markerEnd + taskMarker[0].length,
          ranges,
        );
      } else {
        addInlineSyntaxMarks(list[4] ?? '', markerEnd, ranges);
      }
      addImageWidgets(text, line.from, ranges, options);
      continue;
    }

    if (/^([-*_])\1\1+\s*$/.test(trimmed) && !isActiveLine) {
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

    if (!isActiveLine) {
      addInlineSyntaxMarks(text, line.from, ranges);
      addImageWidgets(text, line.from, ranges, options);
    }
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
      decorations.push(Decoration.replace({
        widget: new ImagePreviewWidget(range.alt ?? '', range.source ?? '', range.resolvedSource ?? null, range.title),
        block: true,
      }).range(range.from, range.to));
      continue;
    }

    if (range.kind === 'table' && range.table) {
      decorations.push(
        Decoration.replace({
          widget: new TablePreviewWidget(range.table),
          block: true,
        }).range(range.from, range.to),
      );
      continue;
    }

    if (range.kind === 'syntax' && range.className === 'cm-live-list-marker') {
      decorations.push(
        Decoration.replace({
          widget: new TextMarkerWidget(range.source ?? '•', 'cm-live-list-marker'),
        }).range(range.from, range.to),
      );
      continue;
    }

    if (range.kind === 'syntax' && range.className === 'cm-live-task-marker') {
      decorations.push(
        Decoration.replace({
          widget: new TextMarkerWidget(range.source ?? '', 'cm-live-task-marker'),
        }).range(range.from, range.to),
      );
      continue;
    }

    if (range.kind === 'syntax') {
      decorations.push(Decoration.replace({}).range(range.from, range.to));
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

interface LivePreviewState {
  decorations: DecorationSet;
  activeLineNumber: number;
}

const imageMeasurementPlugin = ViewPlugin.fromClass(
  class {
    private readonly observer: ResizeObserver | null;

    constructor(private readonly view: EditorView) {
      this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => view.requestMeasure());
      this.observeImages();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.observeImages();
      }
    }

    destroy(): void {
      this.observer?.disconnect();
    }

    private observeImages(): void {
      if (!this.observer) {
        return;
      }

      this.observer.disconnect();
      for (const widget of this.view.dom.querySelectorAll('.cm-live-image, .cm-live-table')) {
        this.observer.observe(widget);
      }
    }
  },
);

export function livePreview(options: LivePreviewOptions = {}): Extension {
  const decorations = StateField.define<LivePreviewState>({
    create(state) {
      const activeLineNumber = state.doc.lineAt(state.selection.main.head).number;
      return {
        decorations: buildLivePreviewDecorations(state.doc, { ...options, activeLineNumber }),
        activeLineNumber,
      };
    },
    update(value, transaction) {
      const activeLineNumber = transaction.state.doc.lineAt(transaction.state.selection.main.head).number;
      if (!transaction.docChanged && (!transaction.selection || activeLineNumber === value.activeLineNumber)) {
        return value;
      }

      return {
        decorations: buildLivePreviewDecorations(transaction.state.doc, { ...options, activeLineNumber }),
        activeLineNumber,
      };
    },
    provide(field) {
      return EditorView.decorations.from(field, (value) => value.decorations);
    },
  });

  return [decorations, imageMeasurementPlugin];
}
