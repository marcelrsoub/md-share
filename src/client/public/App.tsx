import { useEffect, useRef, useState } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yCollab } from 'y-codemirror.next';
import { CircleDot, ExternalLink, FileText, Settings2, UserRound, Users, X } from 'lucide-react';
import type { PublicShareInfo } from '../../shared/types.js';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../shared/binary.js';
import { setDocumentMetadata } from '../shared/document.js';
import { fetchJson, formatTimestamp, shareStatusLabel, statusTone } from '../shared/api.js';

const STORAGE_KEY = 'md-share.display-name';
const GITHUB_REPO_URL = 'https://github.com/marcelrsoub/md-share';

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

function EditorHost({
  doc,
  awareness,
  editable,
}: {
  doc: Y.Doc;
  awareness: Awareness;
  editable: boolean;
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
          EditorView.theme({
            '&': {
              backgroundColor: 'transparent',
              color: 'var(--text)',
            },
            '.cm-scroller': {
              padding: '0',
              fontFamily: 'var(--font-sans)',
            },
            '.cm-content': {
              minHeight: '64vh',
              padding: '28px 32px 72px',
              fontSize: '0.95rem',
              lineHeight: '1.7',
              maxWidth: '78ch',
              margin: '0 auto',
            },
            '.cm-focused': {
              outline: 'none',
            },
            '.cm-line': {
              padding: '0',
            },
            '.cm-gutters': {
              borderRight: 'none',
              backgroundColor: 'transparent',
              color: 'var(--muted)',
            },
            '.cm-activeLineGutter': {
              backgroundColor: 'transparent',
            },
            '.cm-activeLine': {
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
            },
            '.cm-cursor': {
              borderLeftColor: 'var(--text)',
            },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
              backgroundColor: 'rgba(163, 230, 255, 0.16)',
            },
          }),
          EditorView.lineWrapping,
        ],
      }),
    });

    return () => {
      view.destroy();
    };
  }, [awareness, doc]);

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
  const docRef = useState(() => new Y.Doc())[0];
  const awarenessRef = useState(() => new Awareness(docRef))[0];
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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
      color: '#8fd3ff',
    });
  }, [awarenessRef, displayName]);

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

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin && typeof origin === 'object' && (origin as { source?: string }).source === 'server') {
        return;
      }

      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'update', update: uint8ArrayToBase64(update) }));
      }
    };

    docRef.on('update', handleUpdate);

    socket.addEventListener('open', () => {
      setConnectionState('connected');
      socket.send(JSON.stringify({ type: 'hello', displayName }));
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
      socket.close();
    };
  }, [displayName, docRef, info?.status, token]);

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

  const editable = isEditableShareStatus(currentStatus) && connectionState === 'connected';
  const participantCount = participantNames.length;

  if (loading) {
    return (
      <div className="app-shell">
        <div className="hero-shell hero-shell-compact">
          <div className="eyebrow">MD Share</div>
          <h1>Loading share</h1>
          <p className="muted">Validating the token and opening the collaborative note.</p>
        </div>
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="app-shell">
        <div className="hero-shell hero-shell-compact">
          <div className="eyebrow">MD Share</div>
          <h1>Share unavailable</h1>
          <p className="muted">{error ?? 'Invalid or missing share token.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell app-shell-public">
      <header className="public-topbar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <FileText />
          </span>
          <div className="brand-copy">
            <div className="eyebrow">MD Share</div>
            <strong>{info?.noteName ?? 'Shared note'}</strong>
          </div>
        </div>

        <div className="public-toolbar">
          <span className={`status-pill tone-${statusTone(currentStatus)}`}>
            <CircleDot />
            <span>{shareStatusLabel(currentStatus)}</span>
          </span>

          <div className="presence-chip" tabIndex={0}>
            <Users />
            <span>{participantCount}</span>
            <div className="presence-tooltip">
              <strong>Active now</strong>
              {participantNames.length > 0 ? (
                participantNames.map((name) => <span key={name}>{name}</span>)
              ) : (
                <span>Waiting for collaborators</span>
              )}
            </div>
          </div>

          <span className="subtle-chip">Last export {formatTimestamp(info?.lastExportedAt ?? null)}</span>

          <button type="button" className="button-ghost name-chip settings-button" onClick={() => setSettingsOpen(true)}>
            <Settings2 />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <div className="settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-dialog panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="public-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-dialog-header">
              <div>
                <div className="eyebrow">Settings</div>
                <h2 id="public-settings-title">Display name</h2>
                <p className="muted">Pick the name collaborators will see while you edit this note.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X />
              </button>
            </div>

            <div className="settings-dialog-body">
              <label className="settings-field">
                <span className="muted">Your name</span>
                <div className="mini-field settings-input">
                  <span className="inline-icon">
                    <UserRound />
                  </span>
                  <input
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
            </div>

            <div className="settings-dialog-footer">
              <button type="button" className="button-ghost" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button type="button" className="button-primary" onClick={applyDisplayName} disabled={!nameDraft.trim()}>
                Save name
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <main className="public-workspace">
        <section className="editor-stage">
          <EditorHost doc={docRef} awareness={awarenessRef} editable={editable} />
          {!displayName ? (
            <div className="editor-empty-hint muted">Open settings to add your name and join the live session.</div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
