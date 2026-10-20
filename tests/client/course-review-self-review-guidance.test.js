import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('a revision submitter is told another staff member must review the revision', () => {
  assert.match(source, /review\?\.status === 'in_review' && <div className="review-state">[\s\S]*?review\.submittedBy === editorUser\?\.id && <>[\s\S]*?<small>A different administrator or moderator must review this revision before it can be published\.<\/small>[\s\S]*?review\?\.status === 'in_review' && review\.submittedBy !== editorUser\?\.id/);
});
