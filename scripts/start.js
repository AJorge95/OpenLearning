// Both commands load the same .env through server/config.js. Only the command
// selects whether Vite serves live source or Express serves the built client.
import { secureProductionRuntimePermissions } from '../server/production-permissions.js';

process.env.NODE_ENV = process.argv.includes('--dev') ? 'development' : 'production';
secureProductionRuntimePermissions();
await import('../server/index.js');
