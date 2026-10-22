import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { resolveMarkdownImageSource } from '../shared/markdown-assets.js';
import { parseMarkdownTable, type MarkdownTableData } from '../shared/markdown-table.js';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  emptyLabel?: string;
  resolveImageUrl?: (source: string) => string | null;
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'hr' }
  | { type: 'code'; language: string; text: string }
  | { type: 'table'; table: MarkdownTableData }
  | { type: 'list'; list: MarkdownListBlock };

interface MarkdownListBlock {
  ordered: boolean;
  items: MarkdownListItem[];
}

interface MarkdownListItem {
  text: string;
  taskChecked?: boolean;
  children: MarkdownListBlock[];
}

const HEADING_TAGS = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
} as const;

interface MarkdownImageProps {
  alt: string;
  source: string;
  title?: string;
  resolveImageUrl?: (source: string) => string | null;
}

function MarkdownImage({ alt, source, title, resolveImageUrl }: MarkdownImageProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSource = resolveMarkdownImageSource(source, resolveImageUrl);

  if (!resolvedSource || failed) {
    return (
      <span className="markdown-image-fallback">
        <span>{alt || source}</span>
      </span>
    );
  }

  return (
    <figure className="markdown-figure">
      <img
        className="markdown-image"
        src={resolvedSource}
        alt={alt}
        title={title}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
      {alt || title ? <figcaption className="markdown-figure-caption">{alt || title}</figcaption> : null}
    </figure>
  );
}

function normalizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }

  const schemeCandidate = trimmed.replace(/[\s\u0000-\u001f\u007f]/g, '');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(schemeCandidate)) {
    return /^(https?|mailto|tel):/i.test(schemeCandidate) ? trimmed : null;
  }

  return trimmed;
}

function findClosing(text: string, startIndex: number, delimiter: string): number {
  let index = text.indexOf(delimiter, startIndex);
  while (index >= 0) {
    let precedingSlashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
      precedingSlashes += 1;
    }
    if (precedingSlashes % 2 === 0) {
      return index;
    }
    index = text.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
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

function renderInline(text: string, resolveImageUrl?: (source: string) => string | null, prefix = 'inline'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remainder = text.slice(cursor);

    if (remainder.startsWith('![')) {
      const closeAlt = remainder.indexOf(']');
      const openParen = closeAlt >= 0 ? remainder.indexOf('(', closeAlt) : -1;
      const closeParen = openParen >= 0 ? remainder.indexOf(')', openParen) : -1;
      if (closeAlt > 1 && openParen === closeAlt + 1 && closeParen > openParen) {
        const alt = remainder.slice(2, closeAlt);
        const { source, title } = splitLinkParts(remainder.slice(openParen + 1, closeParen));
        nodes.push(
          <MarkdownImage
            key={`${prefix}-img-${cursor}`}
            alt={alt}
            source={source}
            title={title}
            resolveImageUrl={resolveImageUrl}
          />,
        );
        cursor += closeParen + 1;
        continue;
      }
    }

    if (remainder.startsWith('[')) {
      const closeText = remainder.indexOf(']');
      const openParen = closeText >= 0 ? remainder.indexOf('(', closeText) : -1;
      const closeParen = openParen >= 0 ? remainder.indexOf(')', openParen) : -1;
      if (closeText > 0 && openParen === closeText + 1 && closeParen > openParen) {
        const label = remainder.slice(1, closeText);
        const { source, title } = splitLinkParts(remainder.slice(openParen + 1, closeParen));
        const href = normalizeHref(source);
        if (href) {
          const isInternal = href.startsWith('#');
          nodes.push(
            <a
              key={`${prefix}-link-${cursor}`}
              href={href}
              title={title}
              target={isInternal ? undefined : '_blank'}
              rel={isInternal ? undefined : 'noreferrer'}
            >
              {renderInline(label, resolveImageUrl, `${prefix}-link-label-${cursor}`)}
            </a>,
          );
          cursor += closeParen + 1;
          continue;
        }
      }
    }

    const formatting = [
      { delimiter: '~~', tag: 'del' as const },
      { delimiter: '**', tag: 'strong' as const },
      { delimiter: '__', tag: 'strong' as const },
      { delimiter: '==', tag: 'mark' as const },
      { delimiter: '*', tag: 'em' as const },
      { delimiter: '_', tag: 'em' as const },
    ];
    let formatted = false;
    for (const { delimiter, tag } of formatting) {
      if (!remainder.startsWith(delimiter)) continue;
      if ((delimiter === '_' || delimiter === '__') && isWordCharacter(text[cursor - 1])) continue;
      const contentStart = cursor + delimiter.length;
      const close = findClosing(text, contentStart, delimiter);
      if (close <= contentStart) continue;
      const beforeClose = text[close - 1];
      const afterClose = text[close + delimiter.length];
      if (delimiter.length === 1 && delimiter === '*' && remainder.startsWith('**')) continue;
      if ((delimiter === '_' || delimiter === '__') && isWordCharacter(afterClose)) continue;
      if (delimiter === '_' && (isWordCharacter(text[cursor - 1]) || isWordCharacter(afterClose))) continue;
      if (/\s/.test(text[contentStart] ?? '') || /\s/.test(beforeClose ?? '')) continue;
      const Tag = tag;
      nodes.push(
        <Tag
          key={`${prefix}-${tag}-${cursor}`}
          {...(tag === 'mark' ? { className: 'markdown-highlight' } : {})}
        >
          {renderInline(text.slice(contentStart, close), resolveImageUrl, `${prefix}-${tag}-${cursor}`)}
        </Tag>,
      );
      cursor = close + delimiter.length;
      formatted = true;
      break;
    }
    if (formatted) continue;

    /*
     * Keep code spans opaque: Markdown syntax inside them is literal text.
     */
    if (remainder.startsWith('`')) {
      const close = findClosing(text, cursor + 1, '`');
      if (close > cursor + 1) {
        nodes.push(
          <code key={`${prefix}-code-${cursor}`} className="markdown-inline-code">
            {text.slice(cursor + 1, close)}
          </code>,
        );
        cursor = close + 1;
        continue;
      }
    }

    const nextSpecial = remainder.search(/(!\[|\[|\*\*|__|~~|==|\*|_|`)/);
    const end = nextSpecial === -1 ? text.length : cursor + nextSpecial;
    const chunk = text.slice(cursor, end);
    if (chunk) {
      nodes.push(<Fragment key={`${prefix}-text-${cursor}`}>{chunk}</Fragment>);
      cursor = end;
    } else {
      nodes.push(<Fragment key={`${prefix}-text-${cursor}`}>{text[cursor]}</Fragment>);
      cursor += 1;
    }
  }

  return nodes;
}

function renderInlineWithBreaks(text: string, resolveImageUrl?: (source: string) => string | null, prefix = 'inline-breaks'): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    nodes.push(...renderInline(line, resolveImageUrl, `${prefix}-${index}`));
    if (index < lines.length - 1) {
      nodes.push(<br key={`${prefix}-br-${index}`} />);
    }
  }

  return nodes;
}

interface ParsedListLine {
  indent: number;
  ordered: boolean;
  text: string;
  taskChecked?: boolean;
}

function parseListLine(line: string): ParsedListLine | null {
  const match = line.match(/^(\s*)([-*+]|(\d+)\.)\s+(.*)$/);
  if (!match) {
    return null;
  }

  const rawText = match[4] ?? '';
  const task = rawText.match(/^\[([ xX])\]\s+(.*)$/);
  return {
    indent: (match[1] ?? '').replace(/\t/g, '    ').length,
    ordered: Boolean(match[3]),
    text: task?.[2] ?? rawText,
    taskChecked: task ? task[1]?.toLowerCase() === 'x' : undefined,
  };
}

function parseListBlock(lines: string[], startIndex: number): { block: MarkdownListBlock; nextIndex: number } {
  const firstLine = parseListLine(lines[startIndex] ?? '');
  if (!firstLine) {
    return { block: { ordered: false, items: [] }, nextIndex: startIndex };
  }

  const listLines: ParsedListLine[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const current = parseListLine(lines[index] ?? '');
    if (!current || current.indent < firstLine.indent) {
      break;
    }
    if (current.indent === firstLine.indent && current.ordered !== firstLine.ordered) {
      break;
    }
    listLines.push(current);
    index += 1;
  }

  const block: MarkdownListBlock = { ordered: firstLine.ordered, items: [] };
  const stack: Array<{ indent: number; item: MarkdownListItem }> = [];

  for (const line of listLines) {
    while (stack.length > 0 && line.indent <= (stack.at(-1)?.indent ?? -1)) {
      stack.pop();
    }

    const item: MarkdownListItem = {
      text: line.text,
      children: [],
      ...(line.taskChecked === undefined ? {} : { taskChecked: line.taskChecked }),
    };

    const parent = stack.at(-1)?.item;
    if (!parent) {
      block.items.push(item);
    } else {
      let childBlock = parent.children.at(-1);
      if (!childBlock || childBlock.ordered !== line.ordered) {
        childBlock = { ordered: line.ordered, items: [] };
        parent.children.push(childBlock);
      }
      childBlock.items.push(item);
    }

    stack.push({ indent: line.indent, item });
  }

  return { block, nextIndex: index };
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const isBlockStart = (line: string, lineIndex: number): boolean =>
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    /^([-*_])\1\1+\s*$/.test(line.trim()) ||
    /^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(line) ||
    Boolean(parseMarkdownTable(lines, lineIndex));

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const parsedTable = parseMarkdownTable(lines, index);
    if (parsedTable) {
      blocks.push({ type: 'table', table: parsedTable.table });
      index = parsedTable.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] ?? '' });
      index += 1;
      continue;
    }

    if (/^([-*_])\1\1+\s*$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    const fence = line.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      const language = fence[1] ?? '';
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: 'code', language, text: codeLines.join('\n') });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    if (parseListLine(line)) {
      const parsedList = parseListBlock(lines, index);
      blocks.push({ type: 'list', list: parsedList.block });
      index = parsedList.nextIndex;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index] ?? '';
      if (!nextLine.trim()) {
        break;
      }
      if (isBlockStart(nextLine, index)) {
        break;
      }
      paragraphLines.push(nextLine.trim());
      index += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function renderListBlock(
  block: MarkdownListBlock,
  resolveImageUrl: ((source: string) => string | null) | undefined,
  prefix: string,
): ReactNode {
  const ListTag: 'ol' | 'ul' = block.ordered ? 'ol' : 'ul';
  return (
    <ListTag key={prefix} className={`markdown-list ${block.ordered ? 'is-ordered' : 'is-unordered'}`}>
      {block.items.map((item, itemIndex) => (
        <li
          key={`${prefix}-${itemIndex}`}
          className={
            item.taskChecked !== undefined
              ? ['is-task', item.taskChecked ? 'is-checked' : ''].filter(Boolean).join(' ')
              : undefined
          }
        >
          {item.taskChecked !== undefined ? (
            <span
              className={item.taskChecked ? 'markdown-task-toggle is-checked' : 'markdown-task-toggle'}
            >
              <input
                className="markdown-task-checkbox"
                type="checkbox"
                checked={item.taskChecked}
                disabled
                aria-label={item.taskChecked ? 'Completed task' : 'Incomplete task'}
                readOnly
              />
            </span>
          ) : null}
          {renderInline(item.text, resolveImageUrl, `${prefix}-${itemIndex}`)}
          {item.children.map((child, childIndex) =>
            renderListBlock(child, resolveImageUrl, `${prefix}-${itemIndex}-nested-${childIndex}`),
          )}
        </li>
      ))}
    </ListTag>
  );
}

function renderTableBlock(
  table: MarkdownTableData,
  resolveImageUrl: ((source: string) => string | null) | undefined,
  prefix: string,
): ReactNode {
  return (
    <div key={prefix} className="markdown-table-wrap">
      <table className="markdown-table">
        <thead>
          <tr>
            {table.headers.map((header, columnIndex) => (
              <th key={`${prefix}-header-${columnIndex}`} style={{ textAlign: table.alignments[columnIndex] }} scope="col">
                {renderInline(header, resolveImageUrl, `${prefix}-header-${columnIndex}`)}
              </th>
            ))}
          </tr>
        </thead>
        {table.rows.length > 0 ? (
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`${prefix}-row-${rowIndex}`}>
                {row.map((cell, columnIndex) => (
                  <td key={`${prefix}-row-${rowIndex}-cell-${columnIndex}`} style={{ textAlign: table.alignments[columnIndex] }}>
                    {renderInline(cell, resolveImageUrl, `${prefix}-row-${rowIndex}-cell-${columnIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

export function MarkdownPreview({ content, className, emptyLabel = 'Nothing to preview yet.', resolveImageUrl }: MarkdownPreviewProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  if (blocks.length === 0) {
    return <p className={['markdown-empty', className].filter(Boolean).join(' ')}>{emptyLabel}</p>;
  }

  return (
    <article className={['markdown-preview', className].filter(Boolean).join(' ')}>
      {blocks.map((block, blockIndex) => {
        if (block.type === 'heading') {
          const Tag = HEADING_TAGS[Math.min(Math.max(block.level, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6];
          return (
            <Tag key={`heading-${blockIndex}`} className={`markdown-heading is-level-${block.level}`}>
              {renderInline(block.text, resolveImageUrl, `heading-${blockIndex}`)}
            </Tag>
          );
        }

        if (block.type === 'blockquote') {
          const paragraphs = block.text
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean);

          return (
            <blockquote key={`blockquote-${blockIndex}`} className="markdown-blockquote">
              <div className="markdown-blockquote-body">
                {paragraphs.length > 0 ? (
                  paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={`blockquote-${blockIndex}-${paragraphIndex}`}>
                      {renderInlineWithBreaks(paragraph, resolveImageUrl, `blockquote-${blockIndex}-${paragraphIndex}`)}
                    </p>
                  ))
                ) : (
                  <p>{renderInlineWithBreaks(block.text, resolveImageUrl, `blockquote-${blockIndex}`)}</p>
                )}
              </div>
            </blockquote>
          );
        }

        if (block.type === 'hr') {
          return <hr key={`hr-${blockIndex}`} className="markdown-hr" />;
        }

        if (block.type === 'code') {
          return (
            <figure key={`code-${blockIndex}`} className="markdown-codeblock" data-language={block.language || undefined}>
              <figcaption className="markdown-codebar">
                <span className="markdown-codebadge">
                  <span>{block.language || 'code'}</span>
                </span>
              </figcaption>
              <pre className="markdown-codebody">
                <code>{block.text}</code>
              </pre>
            </figure>
          );
        }

        if (block.type === 'list') {
          return renderListBlock(block.list, resolveImageUrl, `list-${blockIndex}`);
        }

        if (block.type === 'table') {
          return renderTableBlock(block.table, resolveImageUrl, `table-${blockIndex}`);
        }

        return (
          <p key={`paragraph-${blockIndex}`} className="markdown-paragraph">
            {renderInline(block.text, resolveImageUrl, `paragraph-${blockIndex}`)}
          </p>
        );
      })}
    </article>
  );
}
