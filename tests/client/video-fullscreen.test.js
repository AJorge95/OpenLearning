import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tryEnterFullscreen, tryToggleFullscreen } from '../../src/video-fullscreen.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('enters full screen when the browser request succeeds', async () => {
  let calls = 0;
  const target = { requestFullscreen: async () => { calls += 1; } };

  assert.equal(await tryEnterFullscreen(target), 'entered');
  assert.equal(calls, 1);
});

test('reports when the browser does not support full screen', async () => {
  assert.equal(await tryEnterFullscreen(null), 'unsupported');
  assert.equal(await tryEnterFullscreen({}), 'unsupported');
});

test('converts a rejected browser request into a failure result', async () => {
  const target = { requestFullscreen: async () => { throw new Error('Permission denied'); } };

  assert.equal(await tryEnterFullscreen(target), 'failed');
});

test('toggles the player frame into fullscreen when it is not already active', async () => {
  let calls = 0;
  const target = { requestFullscreen: async () => { calls += 1; } };

  assert.equal(await tryToggleFullscreen(target, { fullscreenElement: null }), 'entered');
  assert.equal(calls, 1);
});

test('exits fullscreen only when the player frame is the active fullscreen element', async () => {
  let exits = 0;
  const target = { requestFullscreen: async () => assert.fail('must not enter fullscreen again') };
  const fullscreenDocument = {
    fullscreenElement: target,
    async exitFullscreen() {
      assert.equal(this.fullscreenElement, target);
      exits += 1;
    },
  };

  assert.equal(await tryToggleFullscreen(target, fullscreenDocument), 'exited');
  assert.equal(exits, 1);
});

test('enters the player frame when another element owns fullscreen', async () => {
  let enters = 0;
  let exits = 0;
  const target = { requestFullscreen: async () => { enters += 1; } };
  const fullscreenDocument = {
    fullscreenElement: {},
    async exitFullscreen() { exits += 1; },
  };

  assert.equal(await tryToggleFullscreen(target, fullscreenDocument), 'entered');
  assert.equal(enters, 1);
  assert.equal(exits, 0);
});

test('reports unsupported and failed fullscreen exits', async () => {
  const target = {};
  assert.equal(await tryToggleFullscreen(target, { fullscreenElement: target }), 'unsupported');
  assert.equal(await tryToggleFullscreen(null, {
    fullscreenElement: null,
    async exitFullscreen() { assert.fail('must not exit without a player target'); },
  }), 'unsupported');

  const rejectedExit = { fullscreenElement: target, async exitFullscreen() { throw new Error('Exit denied'); } };
  assert.equal(await tryToggleFullscreen(target, rejectedExit), 'failed');
});

test('learner fullscreen keeps video, controls, and caption menu in the same frame', () => {
  const pageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-learner.tsx'), 'utf8');
  const componentSource = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');
  const frameStart = pageSource.indexOf('<div ref={videoPlayerFrameRef} className="video-player-frame">');
  const frameEnd = pageSource.indexOf('      {watchRequired && current.hasVideo && <p className={`video-watch-guidance', frameStart);
  const frameSource = pageSource.slice(frameStart, frameEnd);

  assert.ok(frameStart >= 0, 'expected the shared fullscreen frame');
  assert.ok(frameEnd > frameStart, 'expected the fullscreen frame to contain the player controls');
  assert.match(frameSource, /<section className="video-stage">/);
  assert.match(frameSource, /className=\{`lesson-video-controls/);
  assert.match(frameSource, /portalContainer=\{videoPlayerFrameRef\.current\}/);
  assert.match(frameSource, /fullscreenError && <div className="player-video-error" role="alert">/);
  assert.match(pageSource, /aria-label=\{videoFullscreen \? 'Exit full screen' : 'Enter full screen'\}/);
  assert.match(pageSource, /document\.addEventListener\('fullscreenchange', syncVideoFullscreenState\)/);
  assert.match(componentSource, /createPortal\([\s\S]*?menuPortalContainer\)/);
  assert.match(styles, /\.video-player-frame:fullscreen \.lesson-video-controls\s*\{/);
});
