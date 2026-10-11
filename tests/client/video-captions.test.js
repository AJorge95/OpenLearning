import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectVideoCaptionTrack } from '../../src/video-captions.ts';

function createVideoFixture() {
  const english = { mode: 'hidden' };
  const french = { mode: 'disabled' };
  const metadata = { mode: 'hidden' };
  const trackElements = [
    { dataset: { captionId: 'english-id' }, track: english },
    { dataset: { captionId: 'french-id' }, track: french },
  ];
  const video = {
    textTracks: [english, french, metadata],
    querySelectorAll(selector) {
      assert.equal(selector, 'track[data-caption-id]');
      return trackElements;
    },
  };
  return { video, english, french, metadata };
}

test('selects one caption track and disables the other text tracks', () => {
  const { video, english, french, metadata } = createVideoFixture();

  selectVideoCaptionTrack(video, 'french-id');

  assert.equal(english.mode, 'disabled');
  assert.equal(french.mode, 'showing');
  assert.equal(metadata.mode, 'disabled');
});

test('turns all text tracks off and ignores unknown caption ids', () => {
  const { video, english, french, metadata } = createVideoFixture();

  selectVideoCaptionTrack(video, 'english-id');
  selectVideoCaptionTrack(video, 'missing-id');

  assert.deepEqual([english.mode, french.mode, metadata.mode], ['disabled', 'disabled', 'disabled']);
  selectVideoCaptionTrack(video, '');
  assert.deepEqual([english.mode, french.mode, metadata.mode], ['disabled', 'disabled', 'disabled']);
  assert.doesNotThrow(() => selectVideoCaptionTrack(null, 'english-id'));
});

test('watch-tracked lessons expose an accessible selector for available captions', () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-learner.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const styles = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css'), 'utf8');

  assert.match(source, /data-caption-id=\{caption\.id\}/);
  assert.match(source, /current\.captions\.length > 0 && <AppSelect className="video-caption-select" ariaLabel="Captions"/);
  assert.match(source, /label: 'Captions off'/);
  assert.match(source, /setSelectedCaptionId\(captionId\); selectVideoCaptionTrack\(videoRef\.current, captionId\)/);
  assert.match(source, /selectVideoCaptionTrack\(videoRef\.current, activeCaptionId\)/);
  assert.match(styles, /\.lesson-video-controls\.has-caption-tracks \.video-caption-select \{ grid-column: 1 \/ 4; grid-row: 2;/);
});

test('keeps the full-screen control in its own mobile grid cell when captions are present', () => {
  const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-learner.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const styles = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css'), 'utf8');

  assert.match(source, /className="video-control-button video-fullscreen-button" type="button" aria-label="Enter full screen"/);
  assert.match(styles, /\.lesson-video-controls > \.video-fullscreen-button \{ grid-column: 5; grid-row: 2; \}/);
  assert.match(styles, /\.lesson-video-controls\.has-caption-tracks > \.video-fullscreen-button \{ grid-column: 5; grid-row: 2; \}/);
  assert.doesNotMatch(styles, /\.lesson-video-controls(?:\.has-caption-tracks)? > \.video-control-button:last-child/);
});
