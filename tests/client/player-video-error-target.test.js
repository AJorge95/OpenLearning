import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('learner playback recovery actions keep a reliable target', () => {
  assert.match(source, /<div className="player-video-error" role="alert"><p>Playback is still waiting for video data\./);
  assert.match(source, /<Button type="button" variant="secondary" onClick=\{\(\) => retryVideo\(true\)\}>Retry playback<\/Button>/);
  assert.match(source, /<Button type="button" variant="secondary" onClick=\{\(\) => retryVideo\(true\)\}>Retry video<\/Button>/);
  assert.match(source, /<Button type="button" variant="secondary" disabled=\{retryingWatchProgressLoad\} aria-busy=\{retryingWatchProgressLoad\} onClick=\{retryWatchProgressLoad\}>\{retryingWatchProgressLoad \? 'Checking video…' : 'Retry video check'\}<\/Button>/);

  const recoveryRule = styles.match(/\.player-video-error \.button\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(recoveryRule, /min-height:\s*40px/);
  assert.match(recoveryRule, /flex:\s*0 0 auto/);
});
