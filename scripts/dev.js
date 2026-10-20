import { spawn } from 'node:child_process';
// Resolve the same .env values as the child before deciding whether PORT was configured.
import 'dotenv/config';
import { devChildExitCode } from './dev-exit-code.js';
import { chooseDevPort } from './dev-port.js';

const backendWatchPaths = ['server', 'scripts', 'shared'];
// Vite writes its dependency cache under node_modules/.vite during the first
// browser request. Keep frontend source files out of Node's restart graph as
// Vite already watches them and provides frontend HMR.
const nodeArguments = process.platform === 'linux'
  ? ['--watch', 'scripts/start.js', '--dev']
  : [...backendWatchPaths.map((directory) => `--watch-path=${directory}`), 'scripts/start.js', '--dev'];

// Keep explicit ports authoritative; only auto-select when the default is in use.
const configuredPort = process.env.PORT?.trim() || '';
process.env.PORT = await chooseDevPort(configuredPort);
if (configuredPort) {
  delete process.env.OPENLEARNING_DEV_PORT_FALLBACK;
} else {
  // Let the server retry if another process claims the probed port before bind.
  process.env.OPENLEARNING_DEV_PORT_FALLBACK = 'true';
}
if (!configuredPort && process.env.PORT !== '5173') {
  console.log(`Port 5173 is occupied; using ${process.env.PORT}. Set PORT to choose a specific port.`);
}

const child = spawn(process.execPath, nodeArguments, {
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  process.exitCode = devChildExitCode(code, signal);
});
