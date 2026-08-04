import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deriveKanbanDocument, writeKanbanBoard, writeKanbanBoardIfEditable } from '../src/client/public/use-kanban-document.js';
import { kanbanReadOnly } from '../src/client/public/kanban-workspace.js';

const boardMarkdown = `---
kanban-plugin: board
---

## To Do
- [ ] Capture the task

## Done
- [x] Ship the task
`;

describe('Kanban document adapter', () => {
  it('detects valid boards and leaves ordinary or incomplete Markdown alone', () => {
    const valid = deriveKanbanDocument(createDocWithContent(boardMarkdown).getText('content'));
    const ordinary = deriveKanbanDocument(createDocWithContent('# A note').getText('content'));
    const incomplete = deriveKanbanDocument(createDocWithContent('---\nkanban-plugin: board\n---').getText('content'));

    expect(valid.board?.columns.map((column) => column.title)).toEqual(['To Do', 'Done']);
    expect(ordinary.board).toBeNull();
    expect(incomplete.board).toBeNull();
  });

  it('derives the initial empty Y.Text and serializes board changes into that same document', () => {
    const doc = new Y.Doc();
    expect(deriveKanbanDocument(doc.getText('content'))).toEqual({ content: '', board: null });

    const board = deriveKanbanDocument(createDocWithContent(boardMarkdown).getText('content')).board;
    expect(board).not.toBeNull();
    writeKanbanBoard(doc, board!);

    expect(doc.getText('content').toString()).toContain('kanban-plugin: board');
    expect(deriveKanbanDocument(doc.getText('content')).board?.columns[1]?.cards[0]?.completed).toBe(true);
  });

  it('updates the same Y.Doc content used by MarkdownEditor and skips read-only writes', () => {
    const doc = new Y.Doc();
    const board = deriveKanbanDocument(createDocWithContent(boardMarkdown).getText('content')).board!;

    expect(writeKanbanBoardIfEditable(doc, board, false)).toBe(false);
    expect(doc.getText('content').toString()).toBe('');
    expect(writeKanbanBoardIfEditable(doc, board, true)).toBe(true);
    expect(doc.getText('content').toString()).toContain('## To Do');
    expect(kanbanReadOnly(true)).toBe(false);
    expect(kanbanReadOnly(false)).toBe(true);
  });

  it('refreshes derived board state when a remote Yjs text update arrives', () => {
    const localDoc = new Y.Doc();
    let snapshot = deriveKanbanDocument(localDoc.getText('content'));
    const localText = localDoc.getText('content');
    localText.observe(() => {
      snapshot = deriveKanbanDocument(localText);
    });

    const remoteDoc = createDocWithContent(boardMarkdown);
    Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(remoteDoc), { source: 'server' });

    expect(snapshot.board?.columns[0]?.cards[0]?.content).toBe('Capture the task');
    expect(snapshot.content).toBe(localText.toString());
  });
});

function createDocWithContent(content: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText('content').insert(0, content);
  return doc;
}
