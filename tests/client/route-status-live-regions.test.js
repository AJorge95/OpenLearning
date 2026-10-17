import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const routeStatusSource = source.slice(source.indexOf('function RouteStatus'), source.indexOf('function AuthRoutes'));

test('route announcements mount only when a page heading is available', () => {
  assert.match(routeStatusSource, /return announcement \? <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{announcement\}<\/div> : null;/);
  assert.doesNotMatch(routeStatusSource, /return <div className="sr-only" role="status"/);
});

test('route status keeps focus and heading observation behavior', () => {
  assert.match(routeStatusSource, /document\.getElementById\('main-content'\)\?\.focus\(\)/);
  assert.match(routeStatusSource, /observer\.observe\(contentRoot, \{ childList: true, subtree: true, characterData: true \}\)/);
  assert.match(routeStatusSource, /setAnnouncement\(title\)/);
});
