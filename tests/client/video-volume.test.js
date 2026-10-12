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

test('gives the volume slider the same high-contrast focus ring as nearby video controls', () => {
  const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(styles, /\.video-control-button:focus-visible \{ outline: 2px solid #fff; outline-offset: 2px; \}/);
  assert.match(styles, /\.video-volume-control:focus-visible \{ outline: 2px solid #fff; outline-offset: 2px; \}/);
});
