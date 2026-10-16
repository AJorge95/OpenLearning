import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

export async function mountWebClient(app, server, config) {
  if (config.nodeEnv === 'development') {
    const { createServer } = await import('vite');
    // Vite shares Express's HTTP server, including its hot-reload WebSocket.
    const vite = await createServer({
      root: config.projectDir,
      // Avoid temporary config bundles that Node's backend watcher would treat
      // as source changes, causing a restart loop at development startup.
      configLoader: 'runner',
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    return vite;
  }

  const indexPath = path.join(config.clientDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('Built web client is missing. Run npm run build before npm start.');
  }
  app.use('/assets', express.static(path.join(config.clientDir, 'assets'), {
    index: false,
    maxAge: '1y',
    immutable: true,
  }));
  // Missing chunks must return 404 rather than the SPA HTML fallback.
  app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Asset not found.'));
  app.get('/favicon.svg', (_req, res) => res.sendFile(path.join(config.clientDir, 'favicon.svg')));
  const sendPage = (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  };
  app.get('/', sendPage);
  app.get('*splat', sendPage);
  return null;
}
