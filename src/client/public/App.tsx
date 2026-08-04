import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { AlertTriangle, Radio, Settings2, UserRound, UsersRound } from 'lucide-react';
import { resolveMarkdownImageSource } from '../shared/markdown-assets.js';
import type { PublicShareInfo } from '../../shared/types.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardTitle } from '../components/ui/card.js';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../shared/binary.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, shareStatusLabel, statusTone } from '../shared/api.js';
import { GITHUB_REPO_URL } from '../shared/app-meta.js';
import { MarkdownEditor } from '../components/markdown-editor.js';
import { KanbanWorkspace } from './kanban-workspace.js';
import { useKanbanDocument } from './use-kanban-document.js';

const STORAGE_KEY = 'md-share.display-name';
const CLIENT_ID_KEY = 'md-share.presence-id';
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

function connectionLabel(state: 'idle' | 'connecting' | 'connected' | 'closed', status: PublicShareInfo['status']): string {
  if (status === 'conflict') {
    return 'Editing paused';
  }
  if (status === 'expired' || status === 'revoked') {
    return shareStatusLabel(status);
  }
  if (state === 'connected') {
    return 'Live and synced';
  }
  if (state === 'connecting' || state === 'idle') {
    return 'Connecting…';
  }
  return 'Connection closed';
}

function connectionTone(state: 'idle' | 'connecting' | 'connected' | 'closed', status: PublicShareInfo['status']): string {
  if (status === 'conflict' || status === 'expired' || status === 'revoked') {
    return `tone-${statusTone(status)}`;
  }
  return state === 'connected' ? 'tone-good' : state === 'closed' ? 'tone-bad' : 'tone-neutral';
}

function buildAssetUrl(token: string, sourcePath: string): string {
  const url = new URL(`/api/share/${encodeURIComponent(token)}/assets`, window.location.origin);
  url.searchParams.set('path', sourcePath);
  return url.toString();
}

function GithubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0.297C5.37 0.297 0 5.667 0 12.297c0 5.302 3.438 9.8 8.205 11.384.6.113.82-.26.82-.577 0-.285-.01-1.04-.016-2.04-3.338.725-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.73.084-.73 1.205.085 1.838 1.238 1.838 1.238 1.07 1.835 2.807 1.305 3.492.998.107-.776.418-1.306.76-1.606-2.665-.304-5.466-1.333-5.466-5.93 0-1.31.469-2.382 1.236-3.223-.124-.303-.536-1.527.117-3.176 0 0 1.008-.322 3.3 1.23a11.48 11.48 0 0 1 6.005 0c2.291-1.552 3.298-1.23 3.298-1.23.653 1.649.242 2.873.12 3.176.77.841 1.235 1.913 1.235 3.223 0 4.609-2.807 5.624-5.48 5.92.43.37.814 1.103.814 2.222 0 1.606-.014 2.896-.014 3.287 0 .322.216.694.825.576C20.565 22.096 24 17.599 24 12.297c0-6.63-5.373-12-12-12Z" />
    </svg>
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
  const docRef = useState(() => new Y.Doc())[0];
  const awarenessRef = useState(() => new Awareness(docRef))[0];
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const clientId = useState(() => getPresenceId())[0];
  const kanbanDocument = useKanbanDocument(docRef);
  const [workspaceMode, setWorkspaceMode] = useState<'board' | 'source'>('board');
  const presenceTheme = useMemo(() => getPresenceTheme(clientId), [clientId]);
  const resolvePublicImageUrl = useMemo(() => {
    if (!token) {
      return () => null;
    }

    return (source: string) => resolveMarkdownImageSource(source, (localSource) => buildAssetUrl(token, localSource));
  }, [token]);

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
  const isKanbanNote = kanbanDocument.board !== null;
  const showKanbanBoard = isKanbanNote && workspaceMode === 'board';
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
          <div className="brand-lockup">
            <img className="brand-logo" src="/logo-gpt-topbar.png" width="72" height="72" alt="" aria-hidden="true" />
            <div className="brand-copy">
              <CardTitle>{info?.noteName ?? 'Shared note'}</CardTitle>
              <span className="topbar-context">Shared Markdown note</span>
            </div>
          </div>

          <div className="topbar-controls">
            <div className="public-presence-row" aria-label="Collaboration status">
              <span className={`status-pill ${connectionTone(connectionState, currentStatus)} public-connection-pill`}>
                <Radio />
                {connectionLabel(connectionState, currentStatus)}
              </span>
              <span className="presence-summary">
                <UsersRound />
                {participantNames.length > 1 ? `${participantNames.length} collaborators` : 'Just you'}
              </span>
            </div>
            <Button
              variant="icon"
              className="name-chip settings-button"
              aria-label="Open settings"
              title={displayName ? `Editing as ${displayName}` : 'Join this session'}
              onClick={() => setSettingsOpen(true)}
            >
              <UserRound />
              <span>{displayName || 'Join session'}</span>
              <Settings2 />
            </Button>
          </div>
        </CardContent>
      </header>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <div>
              <DialogTitle id="public-settings-title">Display name</DialogTitle>
              <DialogDescription>Shown to collaborators.</DialogDescription>
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
                <GithubMark />
                <span>See MD Share on GitHub</span>
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
            <CardTitle>{showKanbanBoard ? 'Board' : 'Editor'}</CardTitle>
            <div className="public-editor-header-controls">
              {isKanbanNote ? (
                <div className="public-editor-mode-toggle" role="group" aria-label="Kanban workspace mode">
                  <Button
                    variant="ghost"
                    className={workspaceMode === 'board' ? 'is-active' : ''}
                    aria-pressed={workspaceMode === 'board'}
                    onClick={() => setWorkspaceMode('board')}
                  >
                    Board
                  </Button>
                  <Button
                    variant="ghost"
                    className={workspaceMode === 'source' ? 'is-active' : ''}
                    aria-pressed={workspaceMode === 'source'}
                    onClick={() => setWorkspaceMode('source')}
                  >
                    Source
                  </Button>
                </div>
              ) : null}
              <span className="editor-session-label">{shareStatusLabel(currentStatus)}</span>
            </div>
          </div>

          {currentStatus === 'conflict' ? (
            <div className="public-conflict-banner" role="alert">
              <AlertTriangle />
              This note changed on the NAS while it was being edited. Editing is paused until the owner chooses which version to keep.
            </div>
          ) : null}

          {showKanbanBoard && kanbanDocument.board ? (
            <KanbanWorkspace
              board={kanbanDocument.board}
              doc={docRef}
              editable={editable}
              title={info?.noteName ?? 'Shared note'}
              resolveImageUrl={resolvePublicImageUrl}
            />
          ) : (
            <MarkdownEditor
              content=""
              doc={docRef}
              awareness={awarenessRef}
              editable={editable}
              className={`editor-host-public${editable ? '' : ' is-readonly'}`}
              disabledOverlayLabel="This share is not editable right now."
              resolveImageUrl={resolvePublicImageUrl}
            />
          )}

          {!displayName ? (
            <div className="editor-join-hint" role="status">
              <span className="editor-join-icon" aria-hidden="true">
                <UserRound />
              </span>
              <div>
                <strong>Join the live session</strong>
                <span>Choose a display name so collaborators know who is editing.</span>
              </div>
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                Add your name
              </Button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
