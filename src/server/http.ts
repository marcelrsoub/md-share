import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { createServer, type IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { MdShareService } from './service.js';

const createShareBodySchema = z.object({
  noteId: z.string().min(1),
  expiresInMinutes: z.number().int().positive().nullable().optional(),
});

const updateAdminConfigBodySchema = z.object({
  shareBaseUrl: z.union([z.string(), z.null()]),
});

const tokenSchema = z.string().min(1);
const assetPathSchema = z.string().min(1);

function sendHtml(res: express.Response, filePath: string, fallbackMessage: string): void {
  res.sendFile(filePath, (error) => {
    if (!error) {
      return;
    }

    if (!res.headersSent) {
      res.status(503).type('text/plain').send(fallbackMessage);
    }
  });
}

function jsonError(res: express.Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function asyncHandler<T extends express.RequestHandler>(handler: T): express.RequestHandler {
  return ((req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  }) as express.RequestHandler;
}

function createBaseApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  return app;
}

export interface CreatedHttpServers {
  adminServer: Server;
  publicServer: Server;
  wsServer: WebSocketServer;
}

export function createHttpServers(service: MdShareService, config: AppConfig, clientDistDir: string): CreatedHttpServers {
  const adminHtmlPath = path.join(clientDistDir, 'admin.html');
  const publicHtmlPath = path.join(clientDistDir, 'public.html');

  const adminApp = createBaseApp();
  const publicApp = createBaseApp();

  adminApp.use(
    '/api/admin',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  publicApp.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  adminApp.get(
    '/api/admin/config',
    asyncHandler(async (_req, res) => {
      res.json(service.getAdminConfig());
    }),
  );

  adminApp.put(
    '/api/admin/config',
    asyncHandler(async (req, res) => {
      const bodyResult = updateAdminConfigBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        return jsonError(res, 400, 'Invalid admin config request');
      }

      const shareBaseUrl =
        typeof bodyResult.data.shareBaseUrl === 'string'
          ? bodyResult.data.shareBaseUrl.trim() || null
          : null;

      const updated = service.updateShareBaseUrl(shareBaseUrl);
      res.json(updated);
    }),
  );

  adminApp.get(
    '/api/admin/notes',
    asyncHandler(async (req, res) => {
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const notes = await service.listNotes(query);
      res.json(notes);
    }),
  );

  adminApp.get(
    '/api/admin/notes/:noteId/preview',
    asyncHandler(async (req, res) => {
      const noteId = tokenSchema.safeParse(req.params.noteId);
      if (!noteId.success) {
        return jsonError(res, 400, 'Invalid note id');
      }

      const preview = await service.getNotePreview(noteId.data);
      if (!preview) {
        return jsonError(res, 404, 'Markdown note not found');
      }

      res.json(preview);
    }),
  );

  adminApp.get(
    '/api/admin/notes/:noteId/assets',
    asyncHandler(async (req, res) => {
      const noteId = tokenSchema.safeParse(req.params.noteId);
      if (!noteId.success) {
        return jsonError(res, 400, 'Invalid note id');
      }

      const assetPath = typeof req.query.path === 'string' ? req.query.path : '';
      const parsedAssetPath = assetPathSchema.safeParse(assetPath);
      if (!parsedAssetPath.success) {
        return jsonError(res, 400, 'Invalid asset path');
      }

      const asset = await service.resolveNoteAsset(noteId.data, parsedAssetPath.data);
      if (!asset) {
        return jsonError(res, 404, 'Image not found');
      }

      res.setHeader('Cache-Control', 'private, max-age=300');
      res.type(asset.contentType);
      res.sendFile(asset.realPath, (error) => {
        if (!error) {
          return;
        }

        if (!res.headersSent) {
          jsonError(res, 500, 'Failed to stream image');
        }
      });
    }),
  );

  adminApp.post(
    '/api/admin/shares',
    asyncHandler(async (req, res) => {
      const bodyResult = createShareBodySchema.safeParse(req.body);
      if (!bodyResult.success) {
        return jsonError(res, 400, 'Invalid create-share request');
      }

      const expiresAt =
        bodyResult.data.expiresInMinutes != null
          ? Date.now() + bodyResult.data.expiresInMinutes * 60_000
          : null;
      const share = await service.createShare({
        noteId: bodyResult.data.noteId,
        expiresAt,
      });

      res.status(201).json(share);
    }),
  );

  adminApp.get(
    '/api/admin/shares',
    asyncHandler(async (_req, res) => {
      res.json(await service.listShares());
    }),
  );

  adminApp.post(
    '/api/admin/shares/:token/revoke',
    asyncHandler(async (req, res) => {
      const token = tokenSchema.safeParse(req.params.token);
      if (!token.success) {
        return jsonError(res, 400, 'Invalid share token');
      }

      const share = await service.revokeShare(token.data);
      res.json(share);
    }),
  );

  adminApp.post(
    '/api/admin/shares/:token/export',
    asyncHandler(async (req, res) => {
      const token = tokenSchema.safeParse(req.params.token);
      if (!token.success) {
        return jsonError(res, 400, 'Invalid share token');
      }

      const result = await service.exportShare(token.data, 'manual');
      res.json(result);
    }),
  );

  adminApp.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  adminApp.use(express.static(clientDistDir, { maxAge: '1y', immutable: true }));
  adminApp.get('/', (_req, res) => sendHtml(res, adminHtmlPath, 'MD Share admin build is missing.'));
  adminApp.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (!res.headersSent) {
      jsonError(res, 500, 'Admin request failed');
    }
  });

  publicApp.get(
    '/api/share/:token',
    asyncHandler(async (req, res) => {
      const token = tokenSchema.safeParse(req.params.token);
      if (!token.success) {
        return jsonError(res, 400, 'Invalid share token');
      }

      const info = await service.getPublicShareInfo(token.data);
      if (!info) {
        return jsonError(res, 404, 'Share not found');
      }

      res.json(info);
    }),
  );

  publicApp.get(
    '/api/share/:token/assets',
    asyncHandler(async (req, res) => {
      const token = tokenSchema.safeParse(req.params.token);
      if (!token.success) {
        return jsonError(res, 400, 'Invalid share token');
      }

      const assetPath = typeof req.query.path === 'string' ? req.query.path : '';
      const parsedAssetPath = assetPathSchema.safeParse(assetPath);
      if (!parsedAssetPath.success) {
        return jsonError(res, 400, 'Invalid asset path');
      }

      const asset = await service.resolveShareAsset(token.data, parsedAssetPath.data);
      if (!asset) {
        return jsonError(res, 404, 'Image not found');
      }

      res.setHeader('Cache-Control', 'private, max-age=300');
      res.type(asset.contentType);
      res.sendFile(asset.realPath, (error) => {
        if (!error) {
          return;
        }

        if (!res.headersSent) {
          jsonError(res, 500, 'Failed to stream image');
        }
      });
    }),
  );

  publicApp.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  publicApp.use(express.static(clientDistDir, { maxAge: '1y', immutable: true }));
  publicApp.get('/s/:token', (_req, res) => sendHtml(res, publicHtmlPath, 'MD Share public build is missing.'));
  publicApp.get('/', (_req, res) => {
    res.status(404).type('text/plain').send('Open a share link at /s/<token>.');
  });
  publicApp.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (!res.headersSent) {
      jsonError(res, 500, 'Public request failed');
    }
  });

  const adminServer = createServer(adminApp);
  const publicServer = createServer(publicApp);
  const wsServer = new WebSocketServer({ noServer: true });

  publicServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const match = pathname.match(/^\/ws\/share\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const token = match[1];
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      void service.handleWebSocketConnection(ws, token).catch((error) => {
        console.error(error);
        ws.close(1011, 'websocket failed');
      });
    });
  });

  return { adminServer, publicServer, wsServer };
}
