import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const devScript = fs.readFileSync(new URL('../../scripts/dev.js', import.meta.url), 'utf8');

test('development command uses explicit source watch paths outside Linux', () => {
  assert.equal(packageJson.scripts.dev, 'node scripts/dev.js');
  assert.match(devScript, /const backendWatchPaths = \['server', 'scripts', 'shared'\];/);
  assert.match(devScript, /backendWatchPaths\.map\(\(directory\) => `--watch-path=\$\{directory\}`\)/);
  assert.match(devScript, /process\.platform === 'linux'/);
  assert.match(devScript, /\['--watch', 'scripts\/start\.js', '--dev'\]/);
  assert.match(devScript, /readDevPortArgument\(process\.argv\.slice\(2\)\) \|\| process\.env\.PORT/);
});
