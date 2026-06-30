import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { yCollab } from 'y-codemirror.next';
import { CircleDot, ExternalLink, Settings2, UserRound } from 'lucide-react';
import type { PublicShareInfo } from '../../shared/types.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardTitle } from '../components/ui/card.js';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { MarkdownPreview } from '../components/markdown-preview.js';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../shared/binary.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, formatTimestamp, shareStatusLabel, statusTone } from '../shared/api.js';

const STORAGE_KEY = 'md-share.display-name';
const CLIENT_ID_KEY = 'md-share.presence-id';
const GITHUB_REPO_URL = 'https://github.com/marcelrsoub/md-share';
const PRESENCE_PALETTE = [
  { color: '#7c3aed', light: 'rgba(124, 58, 237, 0.22)' },
  { color: '#0ea5e9', light: 'rgba(14, 165, 233, 0.22)' },
  { color: '#14b8a6', light: 'rgba(20, 184, 166, 0.22)' },
  { color: '#f59e0b', light: 'rgba(245, 158, 11, 0.22)' },
  { color: '#ec4899', light: 'rgba(236, 72, 153, 0.22)' },
  { color: '#22c55e', light: 'rgba(34, 197, 94, 0.22)' },
  { color: '#f97316', light: 'rgba(249, 115, 22, 0.22)' },
  { color: '#38bdf8', light: 'rgba(56, 189, 248, 0.22)' },
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getPresenceTheme(seed: string): { color: string; colorLight: string } {
  const theme = PRESENCE_PALETTE[hashString(seed) % PRESENCE_PALETTE.length] ?? PRESENCE_PALETTE[0]!;
  return {
    color: theme.color,
    colorLight: theme.light,
  };
}

function getPresenceId(): string {
  const stored = window.localStorage.getItem(CLIENT_ID_KEY);
  if (stored) {
    return stored;
  }

  const generated = window.crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, generated);
  return generated;
}

function getTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/s\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildWebSocketUrl(token: string): string {
  const url = new URL(`/ws/share/${encodeURIComponent(token)}`, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isEditableShareStatus(status: PublicShareInfo['status'] | null | undefined): boolean {
  return status === 'active' || status === 'dirty';
}

function buildAssetUrl(token: string, sourcePath: string): string {
  const url = new URL(`/api/share/${encodeURIComponent(token)}/assets`, window.location.origin);
  url.searchParams.set('path', sourcePath);
  return url.toString();
}

function EditorHost({
  doc,
  awareness,
  editable,
  onContentChange,
}: {
  doc: Y.Doc;
  awareness: Awareness;
  editable: boolean;
  onContentChange: (content: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const yText = doc.getText('content');
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: yText.toString(),
        extensions: [
          basicSetup,
          markdown(),
          yCollab(yText, awareness),
          EditorState.readOnly.of(!editable),
          EditorView.theme({
            '&': {
              backgroundColor: 'transparent',
              color: 'var(--text)',
              caretColor: 'var(--accent)',
              fontSize: '1rem',
              lineHeight: '1.75',
            },
            '.cm-scroller': {
              padding: '0',
              fontFamily: 'var(--font-sans)',
            },
            '.cm-content': {
              minHeight: '64vh',
              padding: '22px 24px 84px',
              maxWidth: '76ch',
              margin: '0 auto',
            },
            '.cm-focused': {
              outline: 'none',
            },
            '.cm-content[contenteditable="false"]': {
              cursor: 'default',
            },
            '.cm-gutters': {
              display: 'none',
            },
            '.cm-activeLineGutter': {
              display: 'none',
            },
            '.cm-activeLine': {
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
            },
            '.cm-cursor': {
              borderLeftColor: 'var(--accent)',
            },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
              backgroundColor: 'rgba(124, 58, 237, 0.2)',
            },
            '.cm-ySelectionCaret': {
              borderRadius: '999px 999px 999px 0',
              minHeight: '1.5em',
              paddingInline: '0.38rem',
              borderWidth: '2px',
              boxShadow: '0 0 0 1px rgba(5, 6, 8, 0.4)',
            },
            '.cm-ySelectionCaretDot': {
              display: 'none',
            },
            '.cm-ySelectionInfo': {
              opacity: '1',
              transform: 'translateY(-2px)',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.72rem',
              letterSpacing: '0.02em',
              borderRadius: '999px',
              padding: '0.08rem 0.42rem',
              boxShadow: '0 0 0 1px rgba(5, 6, 8, 0.28)',
            },
            '.cm-ySelection': {
              borderRadius: '0.35rem',
            },
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onContentChange(yText.toString());
            }
          }),
        ],
      }),
    });

    onContentChange(yText.toString());

    return () => {
      view.destroy();
    };
  }, [awareness, doc, editable, onContentChange]);

  return (
    <div className={`editor-host editor-host-public${editable ? '' : ' is-readonly'}`}>
      <div ref={hostRef} />
      {!editable ? <div className="editor-disabled-overlay">This share is not editable right now.</div> : null}
    </div>
  );
}

export function PublicApp() {
  const token = getTokenFromPath();
  const [info, setInfo] = useState<PublicShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => window.localStorage.getItem(STORAGE_KEY) ?? '');
  const [nameDraft, setNameDraft] = useState(displayName);
  const [settingsOpen, setSettingsOpen] = useState(() => window.localStorage.getItem(STORAGE_KEY) == null);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle');
  const [participantNames, setParticipantNames] = useState<string[]>([]);
  const [currentStatus, setCurrentStatus] = useState<'active' | 'dirty' | 'conflict' | 'expired' | 'revoked'>('active');
  const [editorText, setEditorText] = useState('');
  const docRef = useState(() => new Y.Doc())[0];
  const awarenessRef = useState(() => new Awareness(docRef))[0];
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const clientId = useState(() => getPresenceId())[0];
  const deferredEditorText = useDeferredValue(editorText);
  const presenceTheme = useMemo(() => getPresenceTheme(clientId), [clientId]);

  useEffect(() => {
    if (!token) {
      setError('Open a share link with /s/<token>.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchJson<PublicShareInfo>(`/api/share/${encodeURIComponent(token)}`)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setInfo(result);
        setCurrentStatus(result.status);
        setParticipantNames(result.participantNames);
        setLoading(false);
        if (!isEditableShareStatus(result.status)) {
          setConnectionState('closed');
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : 'Failed to validate share token');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const noteName = info?.noteName ?? 'Shared note';
    if (error || !token) {
      setDocumentMetadata({
        title: 'Share unavailable · MD Share',
        description: 'The shared note link is unavailable or invalid.',
        robots: 'noindex,nofollow',
      });
      return;
    }

    if (loading) {
      setDocumentMetadata({
        title: 'Loading share · MD Share',
        description: 'Opening a collaborative Markdown share in MD Share.',
        robots: 'noindex,nofollow',
      });
      return;
    }

    setDocumentMetadata({
      title: `${noteName} · MD Share`,
      description: `Collaborative note view for ${noteName}.`,
      robots: 'noindex,nofollow',
    });
  }, [error, info?.noteName, loading, token]);

  useEffect(() => {
    if (!displayName) {
      awarenessRef.setLocalStateField('user', null);
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, displayName);
    awarenessRef.setLocalStateField('user', {
      name: displayName,
      color: presenceTheme.color,
      colorLight: presenceTheme.colorLight,
    });
  }, [awarenessRef, displayName, presenceTheme.color, presenceTheme.colorLight]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    setNameDraft(displayName);
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }, [displayName, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (!token || !isEditableShareStatus(info?.status) || !displayName) {
      return;
    }

    const socket = new WebSocket(buildWebSocketUrl(token));
    setConnectionState('connecting');
    const pendingUpdates: string[] = [];
    const pendingAwarenessUpdates: string[] = [];

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin && typeof origin === 'object' && (origin as { source?: string }).source === 'server') {
        return;
      }

      const payload = JSON.stringify({ type: 'update', update: uint8ArrayToBase64(update) });
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
        return;
      }

      pendingUpdates.push(payload);
    };

    const handleAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin && typeof origin === 'object' && (origin as { source?: string }).source === 'server') {
        return;
      }

      const changed = [...added, ...updated, ...removed];
      if (changed.length === 0) {
        return;
      }

      const payload = JSON.stringify({
        type: 'awareness',
        update: uint8ArrayToBase64(encodeAwarenessUpdate(awarenessRef, changed)),
      });

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
        return;
      }

      pendingAwarenessUpdates.push(payload);
    };

    docRef.on('update', handleUpdate);
    awarenessRef.on('update', handleAwarenessUpdate);

    socket.addEventListener('open', () => {
      setConnectionState('connected');
      socket.send(JSON.stringify({ type: 'hello', displayName, clientId: awarenessRef.clientID }));
      const awarenessPayload = JSON.stringify({
        type: 'awareness',
        update: uint8ArrayToBase64(encodeAwarenessUpdate(awarenessRef, [awarenessRef.clientID])),
      });
      socket.send(awarenessPayload);
      while (pendingUpdates.length > 0 && socket.readyState === WebSocket.OPEN) {
        const payload = pendingUpdates.shift();
        if (payload) {
          socket.send(payload);
        }
      }
      while (pendingAwarenessUpdates.length > 0 && socket.readyState === WebSocket.OPEN) {
        const payload = pendingAwarenessUpdates.shift();
        if (payload) {
          socket.send(payload);
        }
      }
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      let payload: { type: string; [key: string]: unknown };
      try {
        payload = JSON.parse(event.data) as { type: string; [key: string]: unknown };
      } catch {
        return;
      }

      if (payload.type === 'snapshot' || payload.type === 'update') {
        const updateBase64 = String(payload.update ?? '');
        if (updateBase64) {
          Y.applyUpdate(docRef, base64ToUint8Array(updateBase64), { source: 'server' });
        }
      }

      if (payload.type === 'snapshot' || payload.type === 'awareness') {
        const awarenessBase64 = String(payload.awareness ?? payload.update ?? '');
        if (awarenessBase64) {
          applyAwarenessUpdate(awarenessRef, base64ToUint8Array(awarenessBase64), { source: 'server' });
        }
      }

      if (payload.type === 'snapshot' || payload.type === 'state' || payload.type === 'ready') {
        const names = Array.isArray(payload.participantNames)
          ? payload.participantNames.filter((name): name is string => typeof name === 'string')
          : [];
        setParticipantNames(names);
      }

      if (payload.type === 'snapshot' || payload.type === 'state' || payload.type === 'ready') {
        const status = payload.status;
        if (
          status === 'active' ||
          status === 'dirty' ||
          status === 'conflict' ||
          status === 'expired' ||
          status === 'revoked'
        ) {
          setCurrentStatus(status);
        }
      }

      if (payload.type === 'snapshot' || payload.type === 'state') {
        const lastExportedAt = typeof payload.lastExportedAt === 'number' ? payload.lastExportedAt : null;
        setInfo((previous) =>
          previous
            ? {
                ...previous,
                status:
                  payload.status === 'active' ||
                  payload.status === 'dirty' ||
                  payload.status === 'conflict' ||
                  payload.status === 'expired' ||
                  payload.status === 'revoked'
                    ? payload.status
                    : previous.status,
                lastExportedAt,
                participantNames: Array.isArray(payload.participantNames)
                  ? (payload.participantNames as string[])
                  : previous.participantNames,
              }
            : previous,
        );
      }
    });

    socket.addEventListener('close', (event) => {
      setConnectionState('closed');
      if (event.reason.includes('expired')) {
        setCurrentStatus('expired');
      }
      if (event.reason.includes('revoked')) {
        setCurrentStatus('revoked');
      }
    });

    socket.addEventListener('error', () => {
      setConnectionState('closed');
    });

    return () => {
      docRef.off('update', handleUpdate);
      awarenessRef.off('update', handleAwarenessUpdate);
      socket.close();
    };
  }, [awarenessRef, displayName, docRef, info?.status, token]);

  function applyDisplayName(): void {
    const nextName = nameDraft.trim();
    if (!nextName) {
      return;
    }

    setDisplayName(nextName);
    setNameDraft(nextName);
    setSettingsOpen(false);
    window.localStorage.setItem(STORAGE_KEY, nextName);
  }

  const editable = isEditableShareStatus(currentStatus) && Boolean(displayName);
  if (loading) {
    return (
      <div className="app-shell">
        <Card className="hero-shell hero-shell-compact">
          <CardContent>
            <div className="eyebrow">MD Share</div>
            <CardTitle>Loading share</CardTitle>
            <p className="muted">Validating the token and opening the collaborative note.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="app-shell">
        <Card className="hero-shell hero-shell-compact">
          <CardContent>
            <div className="eyebrow">MD Share</div>
            <CardTitle>Share unavailable</CardTitle>
            <p className="muted">{error ?? 'Invalid or missing share token.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-public">
      <header className="public-topbar panel">
        <CardContent className="panel-tight topbar-block">
          <div className="topbar-copy">
            <CardTitle>{info?.noteName ?? 'Shared note'}</CardTitle>
          </div>

          <div className="topbar-controls">
            <Badge variant="outline" className={`tone-${statusTone(currentStatus)}`}>
              <CircleDot />
              <span>{shareStatusLabel(currentStatus)}</span>
            </Badge>

            <Button
              variant="icon"
              className="name-chip settings-button"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 />
            </Button>
          </div>
        </CardContent>
      </header>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <div>
              <div className="eyebrow">Settings</div>
              <DialogTitle id="public-settings-title">Display name</DialogTitle>
              <DialogDescription>Pick the name collaborators will see while you edit this note.</DialogDescription>
            </div>
            <DialogClose />
          </DialogHeader>

          <DialogBody>
            <label className="settings-field">
              <span className="muted">Your name</span>
              <div className="mini-field settings-input">
                <span className="inline-icon">
                  <UserRound />
                </span>
                <Input
                  ref={nameInputRef}
                  aria-label="Display name"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      applyDisplayName();
                    }
                  }}
                  placeholder="Join with your name"
                />
              </div>
            </label>

            <div className="settings-links">
              <a className="button-ghost settings-link" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                <ExternalLink />
                <span>View on GitHub</span>
              </a>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyDisplayName} disabled={!nameDraft.trim()}>
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="public-workspace">
        <section className="workspace-panel public-editor-panel panel">
          <div className="workspace-panel-header">
            <CardTitle>Editor</CardTitle>
            <span className="muted">{connectionState === 'connected' ? 'Synced' : connectionState}</span>
          </div>

          <EditorHost
            doc={docRef}
            awareness={awarenessRef}
            editable={editable}
            onContentChange={setEditorText}
          />

          {!displayName ? <div className="editor-empty-hint muted">Open settings to add your name and join the live session.</div> : null}
        </section>

        <aside className="workspace-panel public-preview-panel panel">
          <div className="workspace-panel-header">
            <CardTitle>Preview</CardTitle>
            <span className="muted">Updates as you type</span>
          </div>

          <div className="preview-surface">
            <MarkdownPreview
              content={deferredEditorText}
              emptyLabel="Start typing to generate the rendered note."
              resolveImageUrl={(source) => buildAssetUrl(token, source)}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
