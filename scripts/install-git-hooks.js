import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let gitRoot;
try {
  gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // npm prepare also runs in source archives and deployment copies without a .git directory.
  process.exit(0);
}
if (path.resolve(gitRoot) !== projectRoot) process.exit(0);

let currentHooksPath = '';
try {
  currentHooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // No configured hook directory; install the project hook below.
}
if (currentHooksPath && currentHooksPath !== '.githooks') {
  console.warn(`Keeping the existing Git hooks path (${currentHooksPath}); OpenLearning's version hook was not installed.`);
  process.exit(0);
}

execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: projectRoot, stdio: 'ignore' });
console.log('OpenLearning Git hooks are enabled.');
