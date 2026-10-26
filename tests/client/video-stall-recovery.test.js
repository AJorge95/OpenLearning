import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const playerSource = source.slice(source.indexOf('export function CoursePlayerPage()'), source.indexOf('export function QuizPage()'));

test('video player watches for no-progress stalls after playback starts', () => {
  const watchdog = playerSource.match(/function scheduleVideoStallRecovery\(showBuffering = true\)[\s\S]*?\n  useEffect\(/)?.[0] ?? '';

  assert.match(watchdog, /const observedPositionSeconds = video\.currentTime/);
  assert.match(watchdog, /}, 8_000\)/);
  assert.match(watchdog, /activeVideo\.currentTime > observedPositionSeconds \+ 0\.5/);
  assert.match(watchdog, /startAutomaticVideoRecovery\(requestedLessonId\)/);
  assert.doesNotMatch(watchdog, /readyState/);
  assert.match(playerSource, /onPlaying=\{\(event\) => \{[\s\S]*?scheduleVideoStallRecovery\(false\)/);
});

test('video retries rewind through the authorized watch-progress endpoint', () => {
  assert.match(playerSource, /getVideoStallRecoveryPlan\(\{ attempts: recoveryState\.attempts, lastPositionSeconds \}\)/);
  assert.match(playerSource, /watch-progress\/rewind`, \{ positionSeconds: plan\.targetPositionSeconds \}/);
  assert.match(playerSource, /Playback did not recover after three automatic attempts/);
  assert.match(playerSource, /onClick=\{retryVideoManually\}/);
});
