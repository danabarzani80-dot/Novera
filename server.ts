import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { getDb } from './src/db/database';
import { createRouter } from './src/server/routes';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

export function createApp() {
  getDb(); // opens + migrates
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use((req, res, next) => (req.path === '/api/restore' ? next() : express.json({ limit: '2mb' })(req, res, next)));
  app.use('/api', createRouter());
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  const dist = path.join(here, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createApp().listen(PORT, HOST, () => {
    console.log(`Pharmacy POS running at http://${HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
      for (const list of Object.values(os.networkInterfaces()))
        for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) console.log(`  on your network: http://${i.address}:${PORT}`);
    }
  });
}
