import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { createHttpServers } from './http.js';
import { MdShareService } from './service.js';

const thisFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(thisFilePath), '..', '..');
const clientDistDir = path.join(projectRoot, 'dist', 'client');

async function listen(server: import('node:http').Server, port: number, name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      console.log(`${name} listening on port ${port}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDatabase(config.databasePath);
  const service = await MdShareService.create(config, db);
  const servers = createHttpServers(service, config, clientDistDir);

  await Promise.all([
    listen(servers.adminServer, config.adminPort, 'Admin UI'),
    listen(servers.publicServer, config.publicPort, 'Public UI'),
  ]);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down MD Share...`);

    for (const client of servers.wsServer.clients) {
      client.close(1001, 'server shutting down');
    }
    await new Promise<void>((resolve) => servers.wsServer.close(() => resolve()));
    await Promise.allSettled([
      new Promise<void>((resolve) => servers.adminServer.close(() => resolve())),
      new Promise<void>((resolve) => servers.publicServer.close(() => resolve())),
    ]);

    service.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

void main().catch((error) => {
  console.error('MD Share failed to start', error);
  process.exit(1);
});
