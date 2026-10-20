import { spawn } from 'node:child_process';
import { devChildExitCode } from './dev-exit-code.js';

const backendWatchPaths = ['server', 'scripts', 'shared'];
// Vite writes its dependency cache under node_modules/.vite during the first
// browser request. Keep frontend source files out of Node's restart graph as
// Vite already watches them and provides frontend HMR.
const nodeArguments = process.platform === 'linux'
  ? ['--watch', 'scripts/start.js', '--dev']
  : [...backendWatchPaths.map((directory) => `--watch-path=${directory}`), 'scripts/start.js', '--dev'];

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
