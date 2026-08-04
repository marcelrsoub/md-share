import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { parseKanbanMarkdown, serializeKanbanMarkdown } from 'obsidian-react-kanban';
import type { KanbanBoard as KanbanBoardModel } from 'obsidian-react-kanban';

export interface KanbanDocumentSnapshot {
  content: string;
  board: KanbanBoardModel | null;
}

export function deriveKanbanDocument(yText: Y.Text): KanbanDocumentSnapshot {
  const content = yText.toString();
  return {
    content,
    board: parseKanbanMarkdown(content),
  };
}

export function writeKanbanBoard(doc: Y.Doc, board: KanbanBoardModel): boolean {
  const yText = doc.getText('content');
  const nextContent = serializeKanbanMarkdown(board);
  if (yText.toString() === nextContent) {
    return false;
  }

  doc.transact(
    () => {
      yText.delete(0, yText.length);
      yText.insert(0, nextContent);
    },
    { source: 'kanban-board' },
  );
  return true;
}

export function writeKanbanBoardIfEditable(doc: Y.Doc, board: KanbanBoardModel, editable: boolean): boolean {
  return editable ? writeKanbanBoard(doc, board) : false;
}

export function useKanbanDocument(doc: Y.Doc): KanbanDocumentSnapshot {
  const [snapshot, setSnapshot] = useState(() => deriveKanbanDocument(doc.getText('content')));

  useEffect(() => {
    const yText = doc.getText('content');
    const handleTextChange = () => setSnapshot(deriveKanbanDocument(yText));

    handleTextChange();
    yText.observe(handleTextChange);
    return () => yText.unobserve(handleTextChange);
  }, [doc]);

  return snapshot;
}
