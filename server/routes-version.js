import express from 'express';
import { appVersion } from './app-version.js';

export const versionRouter = express.Router();

versionRouter.get('/version', (_req, res) => res.json({ version: appVersion }));
