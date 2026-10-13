import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('lesson feedback icons stay decorative beside visible control labels', () => {
  const reactionGroup = source.match(/<div className="lesson-reactions"[\s\S]*?<\/div>/)?.[0];
  assert.ok(reactionGroup, 'Expected the lesson reaction group.');
  assert.match(reactionGroup, /<ThumbsUp size=\{17\} aria-hidden="true" \/>Like/);
  assert.match(reactionGroup, /<ThumbsDown size=\{17\} aria-hidden="true" \/>Dislike/);

  const composer = source.match(/<form className="lesson-comment-form"[\s\S]*?<\/form>/)?.[0];
  assert.ok(composer, 'Expected the lesson comment composer.');
  assert.match(composer, /<Send size=\{16\} aria-hidden="true" \/>/);

  const removal = source.match(/className="lesson-comment-remove"[\s\S]*?<\/Button>/)?.[0];
  assert.ok(removal, 'Expected the course-manager comment removal action.');
  assert.match(removal, /<Trash2 size=\{14\} aria-hidden="true" \/>Remove/);
});
