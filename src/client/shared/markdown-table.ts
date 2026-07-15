export type MarkdownTableAlignment = 'left' | 'center' | 'right' | undefined;

export interface MarkdownTableData {
  headers: string[];
  alignments: MarkdownTableAlignment[];
  rows: string[][];
}

export interface ParsedMarkdownTable {
  table: MarkdownTableData;
  nextIndex: number;
}

function splitTableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) {
    value = value.slice(1);
  }
  if (value.endsWith('|') && !value.endsWith('\\|')) {
    value = value.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) {
    cell += '\\';
  }
  cells.push(cell.trim());
  return cells;
}

function parseAlignment(cell: string): MarkdownTableAlignment | null {
  if (!/^:?-{3,}:?$/.test(cell.trim())) {
    return null;
  }
  const startsWithColon = cell.trim().startsWith(':');
  const endsWithColon = cell.trim().endsWith(':');
  if (startsWithColon && endsWithColon) {
    return 'center';
  }
  if (startsWithColon) {
    return 'left';
  }
  if (endsWithColon) {
    return 'right';
  }
  return undefined;
}

export function parseMarkdownTable(lines: string[], startIndex: number): ParsedMarkdownTable | null {
  const headerLine = lines[startIndex];
  const separatorLine = lines[startIndex + 1];
  if (!headerLine || !separatorLine || !headerLine.includes('|') || !separatorLine.includes('|')) {
    return null;
  }

  const headers = splitTableCells(headerLine);
  const separatorCells = splitTableCells(separatorLine);
  if (headers.length === 0 || separatorCells.length !== headers.length) {
    return null;
  }

  const parsedAlignments = separatorCells.map(parseAlignment);
  if (parsedAlignments.some((alignment) => alignment === null)) {
    return null;
  }
  const alignments = parsedAlignments as MarkdownTableAlignment[];

  const rows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const rowLine = lines[nextIndex] ?? '';
    if (!rowLine.trim() || !rowLine.includes('|')) {
      break;
    }
    const cells = splitTableCells(rowLine);
    if (cells.length !== headers.length) {
      break;
    }
    rows.push(cells);
    nextIndex += 1;
  }

  return {
    table: { headers, alignments, rows },
    nextIndex,
  };
}
