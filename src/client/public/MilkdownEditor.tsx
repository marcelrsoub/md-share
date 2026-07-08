import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/frame-dark.css';
import { collab, collabServiceCtx, type CollabService } from '@milkdown/plugin-collab';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

type RemoteCursorUser = {
  name?: string;
  color?: string;
};

function createRemoteCursor(user: RemoteCursorUser) {
  const cursor = document.createElement('span');
  cursor.classList.add('ProseMirror-yjs-cursor');
  cursor.setAttribute('style', `border-color: ${user.color ?? '#ffa500'}`);

  const userBadge = document.createElement('span');
  userBadge.setAttribute('style', `background-color: ${user.color ?? '#ffa500'}`);
  userBadge.textContent = user.name ?? 'Anonymous';
  cursor.append(userBadge);

  return cursor;
}

interface MilkdownEditorProps {
  doc: Y.Doc;
  awareness: Awareness;
  editable: boolean;
  initialMarkdown: string;
  hydrateFromMarkdown: boolean;
  resolveImageUrl: (url: string) => Promise<string> | string;
  onMarkdownSnapshot: (markdown: string) => void;
}

export function MilkdownEditor({
  doc,
  awareness,
  editable,
  initialMarkdown,
  hydrateFromMarkdown,
  resolveImageUrl,
  onMarkdownSnapshot,
}: MilkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Crepe | null>(null);
  const collabServiceRef = useRef<CollabService | null>(null);
  const latestMarkdownRef = useRef(initialMarkdown);
  const onMarkdownSnapshotRef = useRef(onMarkdownSnapshot);
  const resolveImageUrlRef = useRef(resolveImageUrl);
  const editableRef = useRef(editable);

  useEffect(() => {
    onMarkdownSnapshotRef.current = onMarkdownSnapshot;
  }, [onMarkdownSnapshot]);

  useEffect(() => {
    resolveImageUrlRef.current = resolveImageUrl;
  }, [resolveImageUrl]);

  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    let cancelled = false;
    const crepe = new Crepe({
      root: hostRef.current,
      features: {
        [Crepe.Feature.Cursor]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.LinkTooltip]: false,
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.TopBar]: false,
      },
      featureConfigs: {
        [Crepe.Feature.ImageBlock]: {
          proxyDomURL: (url: string) => resolveImageUrlRef.current(url),
        },
      },
    });

    editorRef.current = crepe;
    crepe.editor.use(collab);
    crepe.setReadonly(!editable);

    crepe.on((listener) => {
      listener.mounted((ctx) => {
        if (cancelled) {
          return;
        }

        const service = ctx.get(collabServiceCtx);
        collabServiceRef.current = service;
        service.setOptions({
          yCursorOpts: {
            cursorBuilder: createRemoteCursor,
          },
        });
        service.bindDoc(doc).setAwareness(awareness);
        if (hydrateFromMarkdown && initialMarkdown.length > 0) {
          service.applyTemplate(initialMarkdown);
        }
        if (editableRef.current) {
          service.connect();
        }
      });

      listener.markdownUpdated((_ctx, markdown) => {
        latestMarkdownRef.current = markdown;
        onMarkdownSnapshotRef.current(markdown);
      });

      listener.destroy(() => {
        onMarkdownSnapshotRef.current(latestMarkdownRef.current);
      });
    });

    void crepe.create().catch((error) => {
      console.error('Failed to create Milkdown editor', error);
    });

    return () => {
      cancelled = true;
      collabServiceRef.current?.disconnect();
      collabServiceRef.current = null;
      editorRef.current = null;
      void crepe.destroy();
    };
  }, [doc, awareness]);

  useEffect(() => {
    const crepe = editorRef.current;
    if (!crepe) {
      return;
    }

    crepe.setReadonly(!editable);
    const service = collabServiceRef.current;
    if (!service) {
      return;
    }

    if (editableRef.current) {
      service.bindDoc(doc).setAwareness(awareness).connect();
    } else {
      service.disconnect();
    }
  }, [awareness, doc, editable]);

  return <div ref={hostRef} className="public-milkdown-editor" />;
}
