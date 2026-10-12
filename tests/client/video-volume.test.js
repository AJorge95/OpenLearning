import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('announces learner video volume in percentage units', () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-learner.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const slider = source.split(/\r?\n/).find((line) => line.includes('<input className="video-volume-control"'));

  assert.ok(slider, 'expected the learner video volume slider');
  assert.match(slider, /aria-label="Video volume"/);
  assert.match(slider, /value=\{videoMuted \? 0 : videoVolume\}/);
  assert.match(slider, /aria-valuetext=\{`\$\{Math\.round\(\(videoMuted \? 0 : videoVolume\) \* 100\)\}%`\}/);
});
