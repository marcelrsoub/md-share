import { KanbanBoard } from 'obsidian-react-kanban';
import type { KanbanBoard as KanbanBoardModel } from 'obsidian-react-kanban';
import * as Y from 'yjs';
import { MarkdownPreview } from '../components/markdown-preview.js';
import { writeKanbanBoardIfEditable } from './use-kanban-document.js';

interface KanbanWorkspaceProps {
  board: KanbanBoardModel;
  doc: Y.Doc;
  editable: boolean;
  title: string;
  resolveImageUrl: (source: string) => string | null;
}

export function kanbanReadOnly(editable: boolean): boolean {
  return !editable;
}

export function KanbanWorkspace({ board, doc, editable, title, resolveImageUrl }: KanbanWorkspaceProps) {
  return (
    <div className="public-kanban-host">
      <KanbanBoard
        board={board}
        onChange={(nextBoard) => {
          writeKanbanBoardIfEditable(doc, nextBoard, editable);
        }}
        renderCard={(_card, content) => (
          <MarkdownPreview
            content={content}
            className="public-kanban-card-preview"
            resolveImageUrl={resolveImageUrl}
          />
        )}
        readOnly={!editable}
        title={title}
      />
    </div>
  );
}
