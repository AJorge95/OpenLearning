import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const playerSource = source.slice(source.indexOf('export function CoursePlayerPage()'), source.indexOf('export function QuizPage()'));

test('completed lesson watch guidance does not claim completion is still locked', () => {
  assert.match(playerSource, /const watchGuidance = current\?\.completed\s*\n\s*\? 'This lesson is complete\. Review the video or mark it incomplete to watch it again\.'/);
  assert.match(playerSource, /watchGuidance\}<\/p>/);
  assert.match(playerSource, /watchedForCurrent \|\| current\.completed \? 'is-watched' : ''/);
  assert.match(playerSource, /'Watch the full video to unlock lesson completion\. Forward seeking and speed changes are disabled\.'/);
});
