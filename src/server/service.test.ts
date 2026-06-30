import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { MdShareService } from './service.js';
import type { AppConfig } from './config.js';

async function createTempWorkspace(): Promise<{ root: string; notesDir: string; dataDir: string; dbPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-share-settings-'));
  const notesDir = path.join(root, 'notes');
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'md-share.sqlite');

  await fs.mkdir(notesDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(notesDir, 'shared.md'), '# shared note\n\nhello world\n', 'utf8');

  return { root, notesDir, dataDir, dbPath };
}

describe('MdShareService shared link base URL settings', () => {
  it('updates share URLs and persists the override across restarts', async () => {
    const workspace = await createTempWorkspace();
    const config: AppConfig = {
      notesDir: workspace.notesDir,
      dataDir: workspace.dataDir,
      databasePath: workspace.dbPath,
      backupsDir: path.join(workspace.dataDir, 'backups'),
      adminPort: 3020,
      publicPort: 3021,
      adminBaseUrl: 'http://localhost:3020',
      publicBaseUrl: 'http://localhost:3021',
    };

    const db1 = await openDatabase(config.databasePath);
    const service1 = await MdShareService.create(config, db1);

    const [note] = await service1.listNotes();
    expect(note).toBeTruthy();

    const created = await service1.createShare({ noteId: note.id });
    expect(created.shareUrl).toBe(`http://localhost:3021/s/${created.token}`);

    const updatedConfig = service1.updateShareBaseUrl('https://share.example.com');
    expect(updatedConfig.shareBaseUrl).toBe('https://share.example.com/');
    expect(updatedConfig.shareBaseUrlOverride).toBe('https://share.example.com/');
    expect(updatedConfig.defaultShareBaseUrl).toBe('http://localhost:3021/');

    expect(() => service1.updateShareBaseUrl('https://share.example.com/app')).toThrow(
      'Shared link base URL must point to a site root',
    );

    const updatedShares = await service1.listShares();
    expect(updatedShares[0]?.shareUrl).toBe(`https://share.example.com/s/${created.token}`);

    service1.close();

    const db2 = await openDatabase(config.databasePath);
    const service2 = await MdShareService.create(config, db2);
    const reloadedConfig = service2.getAdminConfig();
    expect(reloadedConfig.shareBaseUrl).toBe('https://share.example.com/');
    expect(reloadedConfig.shareBaseUrlOverride).toBe('https://share.example.com/');
    expect(reloadedConfig.defaultShareBaseUrl).toBe('http://localhost:3021/');

    const reloadedShares = await service2.listShares();
    expect(reloadedShares[0]?.shareUrl).toBe(`https://share.example.com/s/${created.token}`);

    const resetConfig = service2.updateShareBaseUrl(null);
    expect(resetConfig.shareBaseUrl).toBe('http://localhost:3021/');
    expect(resetConfig.shareBaseUrlOverride).toBeNull();
    expect(resetConfig.defaultShareBaseUrl).toBe('http://localhost:3021/');

    const resetShares = await service2.listShares();
    expect(resetShares[0]?.shareUrl).toBe(`http://localhost:3021/s/${created.token}`);

    service2.close();
    await fs.rm(workspace.root, { recursive: true, force: true });
  });
});
