import * as Y from 'yjs';
import type { ShareRow } from '../shared/types.js';

const DOC_NAME = 'content';

export function resolveMarkdownSnapshot(row: Pick<ShareRow, 'markdownSnapshot' | 'yState'>): string {
  if (row.markdownSnapshot.length > 0) {
    return row.markdownSnapshot;
  }

  const doc = new Y.Doc();
  if (row.yState.length > 0) {
    Y.applyUpdate(doc, row.yState, { source: 'db' });
  }

  return doc.getText(DOC_NAME).toString();
}
