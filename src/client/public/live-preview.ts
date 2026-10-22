import { syntaxTree } from '@codemirror/language';
import { EditorState, Transaction } from '@codemirror/state';
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
  | 'table'
  | 'task';

export interface LivePreviewDecorationRange {
  kind: LivePreviewDecorationKind;
  from: number;
  to: number;
  className?: string;
  source?: string;
  alt?: string;
  title?: string;
  resolvedSource?: string | null;
  block?: boolean;
  table?: MarkdownTableData;
  checked?: boolean;
  interactive?: boolean;
  position?: number;
  href?: string;
  external?: boolean;
}

export interface LivePreviewOptions {
  resolveImageUrl?: (source: string) => string | null;
  activeLineNumber?: number;
  revealActiveSource?: boolean;
  interactive?: boolean;
}

function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/\\([\\`*{}\[\]<>()#+.!_>~-])/g, '$1');
  if (/^javascript:/i.test(href.replace(/[\u0000-\u0020]+/g, ''))) return null;
  return href;
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
    } else {
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
        const fallback = document.createElement('span');
        fallback.className = 'markdown-image-fallback';
        fallback.textContent = this.alt || this.source;
        wrapper.insertBefore(fallback, image);
        image.remove();
      });
      wrapper.append(image);
    }
    const captionText = this.alt || this.title;
    if (captionText) {
      const caption = document.createElement('figcaption');
      caption.className = 'markdown-figure-caption';
      caption.textContent = captionText;
      wrapper.append(caption);
    }
    return wrapper;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class HorizontalRuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const root = document.createElement('span');
    root.className = 'cm-live-hr-widget';
    root.setAttribute('role', 'separator');
    for (const className of ['cm-live-hr-line', 'cm-live-hr-dot', 'cm-live-hr-line']) {
      const part = document.createElement('span');
      part.className = className;
      root.append(part);
    }
    return root;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class LanguageBadgeWidget extends WidgetType {
  constructor(private readonly language: string) {
    super();
  }

  override eq(other: LanguageBadgeWidget): boolean {
    return other.language === this.language;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-live-code-language';
    el.textContent = this.language || 'code';
    return el;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function inlineHtml(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|(`+)(.+?)\5|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) {
      fragment.append(document.createTextNode(value.slice(offset, index)));
    }
    if (match[1] !== undefined) {
      fragment.append(document.createTextNode(match[1]));
    } else if (match[3] !== undefined) {
      const targetParts = match[4]!.match(/^(.*?)(?:\s+"([^"]*)")?\s*$/)!;
      const href = safeHref(targetParts[1] ?? '');
      if (href === null) {
        fragment.append(document.createTextNode(match[3]));
      } else {
        const link = document.createElement('a');
        link.className = 'cm-live-link';
        link.setAttribute('data-href', href);
        link.setAttribute('data-external', /^(https?:|mailto:|tel:)/i.test(href) ? 'true' : 'false');
        if (targetParts[2]) {
          link.title = targetParts[2];
        }
        link.append(inlineHtml(match[3]));
        fragment.append(link);
      }
    } else {
      const tag =
        match[5] !== undefined
          ? 'code'
          : match[6] !== undefined || match[7] !== undefined
            ? 'strong'
            : match[8] !== undefined
              ? 'del'
              : 'em';
      const content = match[5] !== undefined ? match[6] : match[7] ?? match[8] ?? match[9] ?? match[10] ?? match[11];
      const el = document.createElement(tag);
      if (tag === 'code') {
        el.className = 'cm-live-inline-code';
      }
      el.append(tag === 'code' ? document.createTextNode(content ?? '') : inlineHtml(content ?? ''));
      fragment.append(el);
    }
    offset = index + match[0].length;
  }
  if (offset < value.length) {
    fragment.append(document.createTextNode(value.slice(offset)));
  }
  return fragment;
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
    const table = document.createElement('table');
    table.className = 'markdown-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    this.table.headers.forEach((header, index) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.append(inlineHtml(header));
      cell.style.textAlign = this.table.alignments[index] ?? '';
      headRow.append(cell);
    });
    head.append(headRow);
    table.append(head);
    if (this.table.rows.length) {
      const body = document.createElement('tbody');
      for (const row of this.table.rows) {
        const tr = document.createElement('tr');
        row.forEach((value, index) => {
          const cell = document.createElement('td');
          cell.append(inlineHtml(value));
          cell.style.textAlign = this.table.alignments[index] ?? '';
          tr.append(cell);
        });
        body.append(tr);
      }
      table.append(body);
    }
    wrapper.append(table);
    return wrapper;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class TextMarkerWidget extends WidgetType {
  constructor(private readonly text: string, private readonly className: string) {
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

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly orderedPrefix: string,
    private readonly interactive: boolean,
    private readonly position: number,
  ) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return (
      other.checked === this.checked &&
      other.orderedPrefix === this.orderedPrefix &&
      other.interactive === this.interactive &&
      other.position === this.position
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('span');
    root.className = 'cm-live-task-widget';
    if (this.orderedPrefix) {
      const number = document.createElement('span');
      number.className = 'cm-live-task-number';
      number.textContent = this.orderedPrefix;
      root.append(number);
    }
    const checkbox = document.createElement(this.interactive ? 'button' : 'span');
    checkbox.className = `cm-live-task-checkbox${this.checked ? ' is-checked' : ''}${this.interactive ? '' : ' is-readonly'}`;
    if (this.interactive) {
      (checkbox as HTMLButtonElement).type = 'button';
    }
    checkbox.setAttribute('role', 'checkbox');
    checkbox.setAttribute('aria-checked', String(this.checked));
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    if (this.interactive) {
      checkbox.setAttribute('data-task-toggle', 'true');
      checkbox.setAttribute('tabindex', '-1');
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('cm-live-task-checkbox-icon');
    if (this.checked) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', 'm3 8 3.2 3.2L13 4.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.append(path);
    }
    checkbox.append(svg);
    if (this.interactive) {
      checkbox.addEventListener('mousedown', (event) => event.preventDefault());
      checkbox.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTaskAtPosition(view, this.position);
      });
      checkbox.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === ' ' || key === 'Enter') {
          event.preventDefault();
          toggleTaskAtPosition(view, this.position);
        }
      });
    }
    root.append(checkbox);
    return root;
  }

  override ignoreEvent(): boolean {
    return this.interactive;
  }
}

export function shouldOpenLinkOnModifierClick(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>,
  href: string | null | undefined,
): boolean {
  return Boolean((event.metaKey || event.ctrlKey) && href && /^(https?:|mailto:|tel:)/i.test(href.trim()));
}

function linkFromEvent(event: Event): HTMLElement | null {
  if (!(event.target instanceof Element)) {
    return null;
  }
  return event.target.closest<HTMLElement>('.cm-live-link[data-href]');
}

function openLinkOnModifierClick(event: MouseEvent): boolean {
  const link = linkFromEvent(event);
  const href = link?.getAttribute('data-href');
  if (!link || !shouldOpenLinkOnModifierClick(event, href)) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.type === 'click') {
    window.open(href!, '_blank', 'noopener,noreferrer');
  }
  return true;
}

export function toggleTaskSource(line: string): string | null {
  const match = line.match(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)/);
  if (!match) {
    return null;
  }
  return `${match[1]}${match[2]!.toLowerCase() === 'x' ? ' ' : 'x'}${match[3]}${line.slice(match[0].length)}`;
}

function toggleTaskAtPosition(view: EditorView, position: number): void {
  const line = view.state.doc.lineAt(Math.min(position, view.state.doc.length));
  const source = view.state.doc.sliceString(line.from, line.to);
  const changed = toggleTaskSource(source);
  if (changed === null) {
    return;
  }
  const offset = source.match(/^\s*(?:[-*+]|\d+\.)\s+\[/)?.[0].length ?? 0;
  view.dispatch({
    changes: { from: line.from + offset, to: line.from + offset + 1, insert: changed[offset] },
    annotations: Transaction.userEvent.of('input.toggle-task'),
  });
}

function addImageWidgets(
  line: { text: string; from: number; to: number },
  docLength: number,
  ranges: LivePreviewDecorationRange[],
  options: LivePreviewOptions,
): void {
  for (const match of line.text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const index = match.index ?? -1;
    const alt = match[1] ?? '';
    const rawTarget = match[2] ?? '';
    if (index < 0 || !rawTarget.trim()) {
      continue;
    }
    const parts = rawTarget.trim().match(/^(.*?)(?:\s+"([^"]+)")?$/)!;
    const source = parts[1]?.trim() ?? '';
    const standalone = line.text.trim() === match[0];
    ranges.push({
      kind: 'image',
      from: standalone ? line.from : line.from + index,
      to: standalone
        ? Math.min(line.to + (line.to < docLength ? 1 : 0), docLength)
        : line.from + index + match[0].length,
      block: standalone && line.to < docLength,
      className: 'cm-live-image-source',
      source,
      alt,
      title: parts[2],
      resolvedSource: resolveMarkdownImageSource(source, options.resolveImageUrl),
    });
  }
}

export function collectLivePreviewDecorations(
  doc: { lines: number; length: number; line: (number: number) => { text: string; from: number; to: number } },
  options: LivePreviewOptions = {},
): LivePreviewDecorationRange[] {
  const ranges: LivePreviewDecorationRange[] = [];
  let inCodeBlock = false;
  let blockquoteRun: number[] = [];
  const reveal = (number: number) =>
    options.revealActiveSource !== false && options.activeLineNumber === number;
  const lines = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  const flushQuotes = () => {
    if (blockquoteRun.length) {
      const first = blockquoteRun[0]!;
      const last = blockquoteRun.at(-1)!;
      ranges.push({
        kind: 'blockquote',
        from: doc.line(first).from,
        to: doc.line(first).from,
        className: 'cm-live-blockquote-first',
      });
      ranges.push({
        kind: 'blockquote',
        from: doc.line(last).from,
        to: doc.line(last).from,
        className: 'cm-live-blockquote-last',
      });
      blockquoteRun = [];
    }
  };

  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text;
    const trimmed = text.trim();
    const active = reveal(number);
    const table = inCodeBlock ? null : parseMarkdownTable(lines, number - 1);

    if (table) {
      flushQuotes();
      const last = table.nextIndex;
      const activeTable =
        options.activeLineNumber != null &&
        options.activeLineNumber >= number &&
        options.activeLineNumber <= last &&
        options.revealActiveSource !== false;
      if (!activeTable) {
        ranges.push({ kind: 'table', from: line.from, to: doc.line(last).to, table: table.table });
      }
      number = last;
      continue;
    }

    const fence = text.match(/^```([^\s`]*)[^`]*$/);
    if (fence) {
      flushQuotes();
      const opening = !inCodeBlock;
      ranges.push({
        kind: 'codeFence',
        from: line.from,
        to: line.from,
        className: `cm-live-code-fence ${opening ? 'cm-live-code-fence-open' : 'cm-live-code-fence-close'}`,
      });
      if (!active) {
        ranges.push({
          kind: 'syntax',
          from: line.from,
          to: line.to,
          className: opening ? `cm-live-code-language:${fence[1] || 'code'}` : 'cm-live-syntax',
        });
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      flushQuotes();
      ranges.push({ kind: 'codeFence', from: line.from, to: line.from, className: 'cm-live-code-line' });
      continue;
    }

    const heading = text.match(/^(#{1,6})\s+/);
    if (heading) {
      flushQuotes();
      ranges.push({
        kind: 'heading',
        from: line.from,
        to: line.from,
        className: `cm-live-heading cm-live-heading-${heading[1]!.length}`,
      });
      if (!active) {
        ranges.push({ kind: 'syntax', from: line.from, to: line.from + heading[0].length, className: 'cm-live-syntax' });
      }
      continue;
    }

    if (/^>\s?/.test(text)) {
      blockquoteRun.push(number);
      ranges.push({ kind: 'blockquote', from: line.from, to: line.from, className: 'cm-live-blockquote' });
      if (!active) {
        ranges.push({
          kind: 'syntax',
          from: line.from,
          to: line.from + (text.startsWith('> ') ? 2 : 1),
          className: 'cm-live-syntax',
        });
      }
      continue;
    }

    flushQuotes();
    const list = text.match(/^(\s*)([-*+]|(\d+)\.)\s+(.*)$/);
    if (list) {
      const start = line.from + list[1]!.length;
      const markerEnd = start + list[2]!.length + 1;
      ranges.push({
        kind: 'list',
        from: line.from,
        to: line.from,
        className: list[3] ? 'cm-live-list cm-live-list-ordered' : 'cm-live-list cm-live-list-unordered',
      });
      const task = (list[4] ?? '').match(/^\[([ xX])\]\s+/);
      if (task) {
        const checked = task[1]!.toLowerCase() === 'x';
        if (checked) {
          ranges.push({ kind: 'list', from: line.from, to: line.from, className: 'cm-live-task-checked' });
        }
        if (!active) {
          ranges.push({
            kind: 'task',
            from: line.from + list[1]!.length,
            to: markerEnd + task[0].length,
            checked,
            interactive: options.interactive !== false,
            position: line.from,
            source: list[3] ? `${list[3]}.` : '',
          });
        }
      } else if (!active) {
        ranges.push({
          kind: 'syntax',
          from: start,
          to: markerEnd,
          className: 'cm-live-list-marker',
          source: list[3] ? `${list[3]}.` : '•',
        });
      }
      if (!active) {
        addImageWidgets(line, doc.length, ranges, options);
      }
      continue;
    }

    if (/^([-*_])\1\1+\s*$/.test(trimmed)) {
      ranges.push({ kind: 'hr', from: line.from, to: line.from, className: 'cm-live-hr' });
      if (!active) {
        ranges.push({ kind: 'syntax', from: line.from, to: line.to, className: 'cm-live-hr-widget' });
      }
      continue;
    }

    if (!active) {
      addImageWidgets(line, doc.length, ranges, options);
    }
  }

  flushQuotes();
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function collectInlinePreviewDecorations(state: EditorState, options: LivePreviewOptions = {}): LivePreviewDecorationRange[] {
  const ranges: LivePreviewDecorationRange[] = [];
  const tree = syntaxTree(state);
  const blocked: Array<[number, number]> = [];
  const protectedInlineRanges: Array<[number, number]> = [];
  for (const block of collectLivePreviewDecorations(state.doc, options)) {
    if (block.kind === 'table' || (block.kind === 'codeFence' && block.className === 'cm-live-code-line')) {
      blocked.push([block.from, block.to]);
    }
  }
  const excluded = (from: number, to: number) => blocked.some(([a, b]) => from >= a && to <= b);
  tree.iterate({
    enter(node) {
      if (['InlineCode', 'Link', 'FencedCode', 'CodeBlock'].includes(node.name)) {
        protectedInlineRanges.push([node.from, node.to]);
      }
      if (['Image', 'FencedCode', 'CodeBlock', 'Table'].includes(node.name)) {
        return false;
      }
      if (['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'].includes(node.name)) {
        const delimiters: Array<[number, number]> = [];
        let child = node.node.firstChild;
        while (child) {
          if (/Mark$|Delimiter$/.test(child.name)) {
            delimiters.push([child.from, child.to]);
          }
          child = child.nextSibling;
        }
        for (const [from, to] of delimiters) {
          if (!excluded(from, to) && !isActiveRange(state, from, to, options)) {
            ranges.push({ kind: 'syntax', from, to, className: 'cm-live-syntax' });
          }
        }
        const pieces: Array<[number, number]> = [];
        let start = node.from;
        for (const [from, to] of delimiters) {
          if (start < from) {
            pieces.push([start, from]);
          }
          start = Math.max(start, to);
        }
        if (start < node.to) {
          pieces.push([start, node.to]);
        }
        const markClass =
          node.name === 'StrongEmphasis'
            ? 'cm-live-strong'
            : node.name === 'Emphasis'
              ? 'cm-live-em'
              : node.name === 'Strikethrough'
                ? 'cm-live-strike'
                : 'cm-live-inline-code';
        for (const [from, to] of pieces) {
          if (!excluded(from, to) && !isActiveRange(state, from, to, options)) {
            ranges.push({ kind: 'syntax', from, to, className: markClass });
          }
        }
      }
      if (node.name === 'Link') {
        const line = state.doc.lineAt(node.from);
        const lineEnd = state.doc.lineAt(node.to).number;
        const linkLines = Array.from({ length: lineEnd - line.number + 1 }, (_, i) => line.number + i);
        if (!isActiveRange(state, node.from, node.to, options) && !linkLines.some((n) => isActiveLineNumber(n, options))) {
          const raw = state.doc.sliceString(node.from, node.to);
          const match = raw.match(/^\[([\s\S]*?)\]\(([^)]*)\)$/);
          if (match) {
            const labelFrom = node.from + 1;
            const labelTo = labelFrom + match[1]!.length;
            const targetParts = match[2]!.match(/^(.*?)(?:\s+"([^"]*)")?\s*$/)!;
            const href = safeHref(targetParts[1] ?? '');
            if (href !== null && !excluded(node.from, node.to)) {
              ranges.push({ kind: 'syntax', from: node.from, to: node.from + 1, className: 'cm-live-syntax' });
              ranges.push({ kind: 'syntax', from: labelTo, to: node.to, className: 'cm-live-syntax' });
              ranges.push({
                kind: 'syntax',
                from: labelFrom,
                to: labelTo,
                className: 'cm-live-link',
                href,
                external: /^(https?:|mailto:|tel:)/i.test(href),
                title: targetParts[2],
              });
            }
          }
        }
      }
    },
  });
  const highlightIsProtected = (from: number, to: number) =>
    protectedInlineRanges.some(([start, end]) => from < end && to > start) || excluded(from, to);
  const isEscaped = (line: string, index: number) => {
    let slashes = 0;
    for (let pos = index - 1; pos >= 0 && line[pos] === '\\'; pos--) {
      slashes++;
    }
    return slashes % 2 === 1;
  };
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    if (isActiveLineNumber(lineNumber, options)) {
      continue;
    }
    const line = state.doc.line(lineNumber);
    for (const match of line.text.matchAll(/==(.+?)==/g)) {
      const index = match.index ?? -1;
      if (index < 0 || isEscaped(line.text, index)) {
        continue;
      }
      const from = line.from + index;
      const contentFrom = from + 2;
      const contentTo = contentFrom + match[1]!.length;
      const to = contentTo + 2;
      if (highlightIsProtected(from, to)) {
        continue;
      }
      ranges.push({ kind: 'syntax', from, to: contentFrom, className: 'cm-live-syntax' });
      ranges.push({ kind: 'syntax', from: contentFrom, to: contentTo, className: 'cm-live-highlight' });
      ranges.push({ kind: 'syntax', from: contentTo, to, className: 'cm-live-syntax' });
    }
  }
  return ranges;
}

function isActiveLineNumber(number: number, options: LivePreviewOptions): boolean {
  return options.revealActiveSource !== false && options.activeLineNumber === number;
}

function isActiveRange(state: EditorState, from: number, to: number, options: LivePreviewOptions): boolean {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let line = first; line <= last; line++) {
    if (isActiveLineNumber(line, options)) {
      return true;
    }
  }
  return false;
}

export function isInlinePreviewMarkClass(className: string | undefined): boolean {
  return (
    className === 'cm-live-strong' ||
    className === 'cm-live-em' ||
    className === 'cm-live-strike' ||
    className === 'cm-live-inline-code' ||
    className === 'cm-live-highlight'
  );
}

function buildLivePreviewDecorations(state: EditorState, options: LivePreviewOptions): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const ranges = [
    ...collectLivePreviewDecorations(state.doc, options),
    ...collectInlinePreviewDecorations(state, options),
  ];
  for (const range of ranges) {
    if (range.kind === 'image') {
      decorations.push(
        Decoration.replace({
          widget: new ImagePreviewWidget(range.alt ?? '', range.source ?? '', range.resolvedSource ?? null, range.title),
          block: range.block ?? false,
        }).range(range.from, range.to),
      );
      continue;
    }
    if (range.kind === 'table' && range.table) {
      decorations.push(
        Decoration.replace({ widget: new TablePreviewWidget(range.table), block: true }).range(range.from, range.to),
      );
      continue;
    }
    if (range.kind === 'task') {
      decorations.push(
        Decoration.replace({
          widget: new TaskCheckboxWidget(
            range.checked ?? false,
            range.source ?? '',
            range.interactive !== false,
            range.position ?? range.from,
          ),
        }).range(range.from, range.to),
      );
      continue;
    }
    if (range.kind === 'syntax' && range.className === 'cm-live-hr-widget') {
      decorations.push(Decoration.replace({ widget: new HorizontalRuleWidget() }).range(range.from, range.to));
      continue;
    }
    if (range.kind === 'syntax' && range.className?.startsWith('cm-live-code-language:')) {
      decorations.push(
        Decoration.replace({ widget: new LanguageBadgeWidget(range.className.split(':')[1] ?? 'code') }).range(
          range.from,
          range.to,
        ),
      );
      continue;
    }
    if (range.kind === 'syntax' && range.className === 'cm-live-list-marker') {
      decorations.push(
        Decoration.replace({ widget: new TextMarkerWidget(range.source ?? '•', 'cm-live-list-marker') }).range(
          range.from,
          range.to,
        ),
      );
      continue;
    }
    if (range.kind === 'syntax' && range.className === 'cm-live-link') {
      decorations.push(
        Decoration.mark({
          class: 'cm-live-link',
          attributes: {
            'data-href': range.href ?? '',
            'data-external': String(range.external),
            ...(range.title ? { title: range.title } : {}),
          },
        }).range(range.from, range.to),
      );
      continue;
    }
    if (range.kind === 'syntax' && isInlinePreviewMarkClass(range.className)) {
      decorations.push(Decoration.mark({ class: range.className }).range(range.from, range.to));
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
const imageMeasurementPlugin = ViewPlugin.fromClass(class {
  private readonly observer: ResizeObserver | null;
  constructor(private readonly view: EditorView) {
    this.observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => view.requestMeasure());
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
});

export function livePreview(options: LivePreviewOptions = {}): Extension {
  const decorations = StateField.define<LivePreviewState>({
    create(state) {
      const activeLineNumber = state.doc.lineAt(state.selection.main.head).number;
      return {
        decorations: buildLivePreviewDecorations(state, { ...options, activeLineNumber }),
        activeLineNumber,
      };
    },
    update(value, transaction) {
      const activeLineNumber = transaction.state.doc.lineAt(transaction.state.selection.main.head).number;
      if (!transaction.docChanged && (!transaction.selection || activeLineNumber === value.activeLineNumber)) {
        return value;
      }
      return {
        decorations: buildLivePreviewDecorations(transaction.state, { ...options, activeLineNumber }),
        activeLineNumber,
      };
    },
    provide(field) {
      return EditorView.decorations.from(field, (value) => value.decorations);
    },
  });
  return [
    decorations,
    imageMeasurementPlugin,
    EditorView.domEventHandlers({
      mousedown: (event) => openLinkOnModifierClick(event),
      click: (event) => openLinkOnModifierClick(event),
    }),
  ];
}
