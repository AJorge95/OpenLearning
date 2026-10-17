import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(
  new URL('../../.github/workflows/publish-container.yml', import.meta.url),
  'utf8',
);
const triggers = workflow.match(/^on:\r?\n((?:[ \t].*\r?\n)*)/m)?.[1]?.replace(/\r\n/g, '\n');

test('container publishing is triggered only by pushes to main', () => {
  assert.equal(triggers, '  push:\n    branches:\n      - main\n');
});
