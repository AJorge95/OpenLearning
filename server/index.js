import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { appVersion } from './app-version.js';
import { versionRouter } from './routes-version.js';
import { db, setting } from './db.js';
import { SQLiteSessionStore } from './session-store.js';
import { createSessionCookieProtocolMiddleware } from './session-cookie.js';
import { mountAuthenticationRateLimits } from './auth-rate-limit-mount.js';
import { csrfMiddleware, errorHandler, loadCurrentUser, noStoreApiResponses } from './http.js';
import { authRouter, authRateLimitError } from './routes-auth.js';
import { courseRouter } from './routes-courses.js';
import { adminRouter } from './routes-admin.js';
import { mediaUploadRouter, protectedMediaRouter } from './routes-media.js';
import { writeSystemLog } from './log-store.js';
import { cleanupOrphanedCourseMedia, getOrphanedMediaCleanupLog } from './media-cleanup.js';
import { programsRouter } from './routes-programs.js';
import { isReadyToServe } from './readiness.js';
import { isPlatformResetActive, platformResetGate } from './platform-reset.js';
import { backupWriteGate, startBackupScheduler, stopBackupScheduler } from './backup-scheduler.js';

const app = express();
let isShuttingDown = false;
if (config.trustProxy) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: config.nodeEnv === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(noStoreApiResponses);
app.use('/api', versionRouter);
app.get('/healthz', (_req, res) => res.setHeader('Cache-Control', 'no-store').json({ status: 'ok' }));
app.get('/readyz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return isReadyToServe(db, isShuttingDown || isPlatformResetActive())
    ? res.json({ status: 'ok' })
    : res.status(503).json({ status: 'unavailable' });
});
app.use('/assets', express.static(path.join(config.clientDir, 'assets'), {
  index: false,
  maxAge: config.nodeEnv === 'production' ? '1y' : 0,
  immutable: config.nodeEnv === 'production',
}));
app.use('/assets', (_req, res) => res.status(404).type('text/plain').send('Asset not found.'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
const sessionStore = new SQLiteSessionStore(db, {
  onCleanupError: (error) => writeSystemLog('error', 'sessions', 'Expired session cleanup failed', {
    errorName: String(error?.name || 'Error').slice(0, 100),
    errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
  }),
});
app.use(session({
  name: 'openlearning.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  },
}));
app.use(createSessionCookieProtocolMiddleware(setting, config.nodeEnv));
app.use(loadCurrentUser);
app.use(platformResetGate);
app.use(backupWriteGate);

const authRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    if (req.rateLimit?.used === req.rateLimit.limit + 1) {
      writeSystemLog('warn', 'auth', 'Authentication request rate limited', { path: req.baseUrl || req.path });
    }
    res.status(429).json({ error: authRateLimitError().message, code: 'rate_limited' });
  },
};
const authLimiter = rateLimit(authRateLimitOptions);
const loginLimiter = rateLimit({ ...authRateLimitOptions, skipSuccessfulRequests: true });

app.use('/api', csrfMiddleware);
mountAuthenticationRateLimits(app, loginLimiter, authLimiter);
app.use('/api', authRouter);
app.use('/api', courseRouter);
app.use('/api', programsRouter);
app.use('/api/admin', adminRouter);
app.use('/api', mediaUploadRouter);
app.use('/media', protectedMediaRouter);
app.use('/media', (_req, res) => res.status(404).json({ error: 'Media route not found.', code: 'not_found' }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.', code: 'not_found' }));

if (fs.existsSync(path.join(config.clientDir, 'index.html'))) {
  app.get('/', (_req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
  app.get('*splat', (_req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => res.status(200).send('OpenLearning API is running. Start the Vite client with npm run dev, or build the client with npm run build.'));
}

app.use(errorHandler);

function cleanupOrphanedMedia() {
  if (isShuttingDown) return;
  const startedAt = performance.now();
  void cleanupOrphanedCourseMedia(db, config.mediaRoot, Math.max(config.requestTimeoutMs, 24 * 60 * 60 * 1000)).then((cleanupResult) => {
    if (isShuttingDown) return;
    const log = getOrphanedMediaCleanupLog(cleanupResult, Math.max(0, Math.round(performance.now() - startedAt)));
    writeSystemLog(log.level, 'media', log.message, log.details);
  }).catch((error) => {
    if (isShuttingDown) return;
    writeSystemLog('warn', 'media', 'Orphaned course media cleanup failed during startup', {
      errorName: String(error?.name || 'Error').slice(0, 100),
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 100) : undefined,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  });
}

const server = app.listen(config.port, config.host, () => {
  console.log(`OpenLearning listening on ${config.host}:${config.port}`);
  if (config.nodeEnv === 'production') {
    console.log(`Use the server's reachable IPv4 address or DNS name on port ${config.port} from a browser on another computer.`);
  } else {
    console.log(`Open the local development API at http://${config.host}:${config.port}`);
  }
  console.log(`Database: ${config.dbPath}`);
  console.log(`Course media: ${config.mediaRoot}`);
  writeSystemLog('info', 'server', 'OpenLearning server started', { port: config.port, environment: config.nodeEnv, nodeVersion: process.versions.node });
  setImmediate(cleanupOrphanedMedia);
});
server.requestTimeout = config.requestTimeoutMs;
startBackupScheduler({ shouldDefer: isPlatformResetActive });

function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  writeSystemLog('info', 'server', 'OpenLearning server is shutting down');
  const backupShutdown = stopBackupScheduler();
  const shutdownDeadline = setTimeout(() => {
    writeSystemLog('warn', 'server', 'Graceful shutdown exceeded 30 seconds; closing active connections');
    server.closeAllConnections();
  }, 30_000);
  shutdownDeadline.unref?.();
  server.close(() => {
    clearTimeout(shutdownDeadline);
    void backupShutdown.finally(() => {
      sessionStore.close();
      db.close();
      process.exit(0);
    });
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
