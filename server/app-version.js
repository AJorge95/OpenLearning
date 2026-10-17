import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json');
const match = /^(\d+)\.(\d+)\.0$/.exec(packageMetadata.version);

if (!match) throw new Error(`The app version must use x.y.0 format; received ${JSON.stringify(packageMetadata.version)}.`);

export const appVersion = `${match[1]}.${match[2]}`;
