import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const setupPage = authSource.slice(authSource.indexOf('export function SetupPage'), authSource.indexOf('function BookOpenMark'));

test('setup progress is announced when the wizard step changes', () => {
  assert.match(setupPage, /<div className="setup-step-label" role="status">Step \{step\} of 2<\/div>/);
  assert.match(setupPage, /if \(previousStepRef\.current === step\) return;[\s\S]*stepHeadingRef\.current\?\.focus\(\);/);
});
