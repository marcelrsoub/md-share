import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import { WebSocket, type RawData } from 'ws';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/database.js';
import { createHttpServers } from '../src/server/http.js';
import { MdShareService } from '../src/server/service.js';
import { hashFile } from '../src/shared/hash.js';
import type { ShareSummary } from '../src/shared/types.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function listen(server: import('node:http').Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine listener port');
  }

  return address.port;
}

async function waitForMessage(socket: WebSocket, predicate: (payload: any) => boolean, timeoutMs = 5000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for websocket message'));
    }, timeoutMs);

    const onMessage = (data: RawData) => {
      try {
        const text = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf8');
        const payload = JSON.parse(text);
        if (predicate(payload)) {
          cleanup();
          resolve(payload);
        }
      } catch {
        // Ignore malformed data in this helper.
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
    };

    socket.on('message', onMessage);
  });
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('md-share integration', () => {
  it('creates shares, syncs edits, exports safely, and writes conflict copies', async () => {
    const notesDir = await makeTempDir('md-share-int-notes-');
    const dataDir = await makeTempDir('md-share-int-data-');
    const sourcePath = path.join(notesDir, 'shared-note.md');
    const imagePath = path.join(notesDir, 'cover.png');
    await fs.writeFile(
      imagePath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO4X5ioAAAAASUVORK5CYII=', 'base64'),
    );
    await fs.writeFile(sourcePath, '# Shared note\n\nHello from MD Share\n\n![Cover](cover.png)\n', 'utf8');

    const adminPort = 0;
    const publicPort = 0;
    const config = loadConfig({
      NOTES_DIR: notesDir,
      DATA_DIR: dataDir,
      ADMIN_PORT: String(adminPort),
      PUBLIC_PORT: String(publicPort),
      ADMIN_BASE_URL: 'http://127.0.0.1',
      PUBLIC_BASE_URL: 'http://127.0.0.1',
    });

    const db = await openDatabase(config.databasePath);
    const service = await MdShareService.create(config, db);
    const { adminServer, publicServer } = createHttpServers(service, config, path.join(process.cwd(), 'dist', 'client'));

    const actualAdminPort = await listen(adminServer);
    const actualPublicPort = await listen(publicServer);

    const adminBase = `http://127.0.0.1:${actualAdminPort}`;
    const publicBase = `http://127.0.0.1:${actualPublicPort}`;

    let socket1: WebSocket | undefined;
    let socket2: WebSocket | undefined;
    let socket3: WebSocket | undefined;

    try {
      const notesResponse = await fetch(`${adminBase}/api/admin/notes`);
      expect(notesResponse.ok).toBe(true);
      const notes = (await notesResponse.json()) as Array<{ id: string; name: string }>;
      expect(notes).toHaveLength(1);
      expect(notes[0]?.name).toBe('shared-note.md');

      const previewResponse = await fetch(`${adminBase}/api/admin/notes/${notes[0]?.id}/preview`);
      expect(previewResponse.ok).toBe(true);
      const preview = (await previewResponse.json()) as { excerpt: string; relativePath: string; content: string };
      expect(preview.relativePath).toBe('shared-note.md');
      expect(preview.excerpt).toContain('Hello from MD Share');
      expect(preview.content).toContain('![Cover](cover.png)');

      const createResponse = await fetch(`${adminBase}/api/admin/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: notes[0]?.id, expiresInMinutes: null }),
      });
      expect(createResponse.ok).toBe(true);
      const share = (await createResponse.json()) as ShareSummary;
      expect(share.status).toBe('active');
      expect(share.shareUrl).toContain('/s/');

      const imageResponse = await fetch(`${publicBase}/api/share/${share.token}/assets?path=${encodeURIComponent('cover.png')}`);
      expect(imageResponse.ok).toBe(true);
      expect(imageResponse.headers.get('content-type')).toContain('image/png');

      const duplicateCreateResponse = await fetch(`${adminBase}/api/admin/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId: notes[0]?.id, expiresInMinutes: null }),
      });
      expect(duplicateCreateResponse.ok).toBe(true);
      const duplicateShare = (await duplicateCreateResponse.json()) as ShareSummary;
      expect(duplicateShare.token).toBe(share.token);

      const publicInfoResponse = await fetch(`${publicBase}/api/share/${share.token}`);
      expect(publicInfoResponse.ok).toBe(true);
      const publicInfo = (await publicInfoResponse.json()) as { noteName: string };
      expect(publicInfo.noteName).toBe('shared-note.md');

      socket1 = new WebSocket(`${publicBase.replace('http', 'ws')}/ws/share/${share.token}`);
      socket2 = new WebSocket(`${publicBase.replace('http', 'ws')}/ws/share/${share.token}`);

      await Promise.all([
        once(socket1, 'open'),
        once(socket2, 'open'),
      ]);

      const aliceState = waitForMessage(
        socket1,
        (payload) =>
          payload.type === 'state' &&
          Array.isArray(payload.participantNames) &&
          payload.participantNames.includes('Alice') &&
          payload.participantNames.includes('Bob'),
      );
      const bobState = waitForMessage(
        socket2,
        (payload) =>
          payload.type === 'state' &&
          Array.isArray(payload.participantNames) &&
          payload.participantNames.includes('Alice') &&
          payload.participantNames.includes('Bob'),
      );

      socket1.send(JSON.stringify({ type: 'hello', displayName: 'Alice' }));
      socket2.send(JSON.stringify({ type: 'hello', displayName: 'Bob' }));

      await Promise.all([aliceState, bobState]);

      const aliceAwarenessDoc = new Y.Doc();
      const aliceAwareness = new Awareness(aliceAwarenessDoc);
      aliceAwareness.setLocalState({
        user: {
          name: 'Alice',
          color: '#ff4d6d',
          colorLight: 'rgba(255, 77, 109, 0.24)',
        },
        cursor: {
          anchor: { type: 'relative-position', tname: null, item: null, assoc: 0 },
          head: { type: 'relative-position', tname: null, item: null, assoc: 0 },
        },
      });

      const awarenessMessage = waitForMessage(socket2, (payload) => payload.type === 'awareness');
      socket1.send(
        JSON.stringify({
          type: 'awareness',
          update: Buffer.from(encodeAwarenessUpdate(aliceAwareness, [aliceAwareness.clientID])).toString('base64'),
        }),
      );

      const receivedAwareness = await awarenessMessage;
      const bobAwarenessDoc = new Y.Doc();
      const bobAwareness = new Awareness(bobAwarenessDoc);
      applyAwarenessUpdate(bobAwareness, Buffer.from(receivedAwareness.update, 'base64'), 'test');
      const aliceStateEntry = Array.from(bobAwareness.getStates().values()).find(
        (state) => state?.user?.name === 'Alice',
      );
      expect(aliceStateEntry?.user?.color).toBe('#ff4d6d');

      const baseDoc = new Y.Doc();
      baseDoc.getText('content').insert(0, 'Hello from MD Share\n');
      const editingDoc = new Y.Doc();
      Y.applyUpdate(editingDoc, Y.encodeStateAsUpdate(baseDoc));
      const editingText = editingDoc.getText('content');
      editingText.insert(editingText.length, 'More text\n');
      const update = Y.encodeStateAsUpdate(editingDoc);
      socket1.send(JSON.stringify({ type: 'update', update: Buffer.from(update).toString('base64') }));

      const updateMessage = await waitForMessage(socket2, (payload) => payload.type === 'update');
      const receiverDoc = new Y.Doc();
      Y.applyUpdate(receiverDoc, Y.encodeStateAsUpdate(baseDoc));
      Y.applyUpdate(receiverDoc, Buffer.from(updateMessage.update, 'base64'));
      expect(receiverDoc.getText('content').toString()).toContain('More text');

      const dirtyInfoResponse = await fetch(`${publicBase}/api/share/${share.token}`);
      expect(dirtyInfoResponse.ok).toBe(true);
      const dirtyInfo = (await dirtyInfoResponse.json()) as { status: string };
      expect(dirtyInfo.status).toBe('dirty');

      socket3 = new WebSocket(`${publicBase.replace('http', 'ws')}/ws/share/${share.token}`);
      await once(socket3, 'open');
      const readyAfterDirty = waitForMessage(socket3, (payload) => payload.type === 'ready' && payload.status === 'dirty');
      socket3.send(JSON.stringify({ type: 'hello', displayName: 'Charlie' }));
      await readyAfterDirty;

      const exportResponse = await fetch(`${adminBase}/api/admin/shares/${share.token}/export`, {
        method: 'POST',
      });
      expect(exportResponse.ok).toBe(true);
      const exportResult = await exportResponse.json();
      expect(exportResult.status).toBe('exported');
      expect(await fs.readFile(sourcePath, 'utf8')).toContain('More text');

      const currentHash = await hashFile(sourcePath);
      expect(currentHash).toBeTruthy();

      await fs.writeFile(sourcePath, 'external edit\n', 'utf8');

      const conflictResponse = await fetch(`${adminBase}/api/admin/shares/${share.token}/export`, {
        method: 'POST',
      });
      expect(conflictResponse.ok).toBe(true);
      const conflictResult = await conflictResponse.json();
      expect(conflictResult.status).toBe('conflict');
      expect(await fs.readFile(sourcePath, 'utf8')).toBe('external edit\n');
      expect(conflictResult.conflictCopyPath).toContain('.conflict-');
      expect(await fs.readFile(conflictResult.conflictCopyPath, 'utf8')).toContain('More text');

      const socket1Closed = once(socket1, 'close');
      const socket2Closed = once(socket2, 'close');
      const socket3Closed = once(socket3, 'close');
      socket1.close();
      socket2.close();
      socket3.close();
      await Promise.all([socket1Closed, socket2Closed, socket3Closed]);
    } finally {
      socket1?.removeAllListeners();
      socket2?.removeAllListeners();
      socket3?.removeAllListeners();
      socket1?.close();
      socket2?.close();
      socket3?.close();
      await new Promise<void>((resolve) => adminServer.close(() => resolve()));
      await new Promise<void>((resolve) => publicServer.close(() => resolve()));
      service.close();
    }
  });
});
