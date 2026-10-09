import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { db, setting } from './db.js';
import { SQLiteSessionStore } from './session-store.js';
import { csrfMiddleware, errorHandler, loadCurrentUser } from './http.js';
import { authRouter, authRateLimitError } from './routes-auth.js';
import { courseRouter } from './routes-courses.js';
import { adminRouter } from './routes-admin.js';
import { mediaUploadRouter, protectedMediaRouter } from './routes-media.js';

const app = express();
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'openlearning.sid',
  secret: config.sessionSecret,
  store: new SQLiteSessionStore(db),
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
app.use((req, _res, next) => {
  const protocol = setting('connection_protocol');
  req.session.cookie.secure = protocol === 'http' ? false : protocol === 'https' ? true : config.nodeEnv === 'production';
  next();
});
app.use(loadCurrentUser);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: authRateLimitError().message, code: 'rate_limited' }),
});

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', csrfMiddleware);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/setup', authLimiter);
app.use('/api', authRouter);
app.use('/api', courseRouter);
app.use('/api/admin', adminRouter);
app.use('/api', mediaUploadRouter);
app.use('/media', protectedMediaRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.', code: 'not_found' }));

if (fs.existsSync(path.join(config.clientDir, 'index.html'))) {
  app.use(express.static(config.clientDir, { index: false, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.get('/', (_req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
  app.get('*splat', (_req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => res.status(200).send('OpenLearning API is running. Start the Vite client with npm run dev, or build the client with npm run build.'));
}

app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`OpenLearning listening on http://localhost:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
  console.log(`Course media: ${config.mediaRoot}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

