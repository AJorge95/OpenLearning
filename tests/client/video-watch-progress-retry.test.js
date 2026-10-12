import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('temporary watch-progress read failures expose a guarded retry action', () => {
  assert.match(pageSource, /canRetryVideoWatchProgressLoad\(apiError\.status, apiError\.code\)/);
  const retryMarkup = pageSource.slice(pageSource.indexOf('{watchError &&'), pageSource.indexOf('<div className="player-controls-row">'));
  assert.ok(retryMarkup.includes('{canRetryWatchProgressLoad && <Button'));
  assert.ok(retryMarkup.includes('disabled={retryingWatchProgressLoad}'));
  assert.ok(retryMarkup.includes('onClick={retryWatchProgressLoad}'));
  assert.ok(retryMarkup.includes("'Checking video…' : 'Retry video check'"));
  assert.match(pageSource, /function retryWatchProgressLoad\(\) \{[\s\S]*?watchRequestControllerRef\.current\?\.abort\(\)[\s\S]*?loadWatchProgress\(requestedLessonId, controller\);/);
});
