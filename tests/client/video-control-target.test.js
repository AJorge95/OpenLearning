import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('keeps learner video action targets large enough at every responsive breakpoint', () => {
  const baseRule = styles.match(/\.video-control-button\s*\{([^}]*)\}/)?.[1];
  assert.ok(baseRule, 'expected base video-control button styles');
  assert.match(baseRule, /width:\s*40px/);
  assert.match(baseRule, /height:\s*40px/);

  const mobileRule = styles.match(/\.video-control-button\s*\{ width:\s*40px; height:\s*40px; \}/)?.[0];
  assert.ok(mobileRule, 'expected compact breakpoint video-control target styles');

  assert.match(styles, /\.lesson-video-controls\s*\{ display:\s*grid; grid-template-columns:\s*40px 60px max-content minmax\(40px, 1fr\) 40px;/);
  assert.match(styles, /\.lesson-video-controls\.has-caption-tracks\s*\{ display:\s*grid; grid-template-columns:\s*40px 60px max-content minmax\(40px, 1fr\) 40px;/);
  assert.match(styles, /\.video-caption-select \.app-select-trigger\s*\{ min-height:\s*40px;/);
  assert.match(styles, /\.lesson-video-controls\.has-caption-tracks \.video-caption-select \.app-select-trigger\s*\{ min-height:\s*40px;/);
});
