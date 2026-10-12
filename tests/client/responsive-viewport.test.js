import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css');

test('document and body can shrink to the usable mobile viewport width', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const htmlRule = styles.match(/^html\s*\{([^}]*)\}/m);
  const bodyRule = styles.match(/^body\s*\{([^}]*)\}/m);

  assert.ok(htmlRule, 'expected the document root style');
  assert.ok(bodyRule, 'expected the document body style');
  assert.doesNotMatch(htmlRule[1], /min-width\s*:/);
  assert.doesNotMatch(bodyRule[1], /min-width\s*:/);
});

test('authentication and setup screens follow the dynamic visible viewport height', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const authRule = styles.match(/^\.auth-page, \.setup-page\s*\{([^}]*)\}/m);

  assert.ok(authRule, 'expected shared auth and setup surface styling');
  assert.match(authRule[1], /min-height:\s*100vh;/, 'keep a fallback for older browsers');
  assert.match(authRule[1], /min-height:\s*100dvh;/, 'use the current visible viewport on mobile');
  assert.ok(authRule[1].indexOf('min-height: 100vh') < authRule[1].indexOf('min-height: 100dvh'));
});

test('desktop staff navigation scrolls at short viewport heights and returns to page flow on mobile', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const sidebarRule = styles.match(/^\.staff-sidebar\s*\{([^}]*)\}/m);
  const mobileRule = styles.match(/\.staff-sidebar\s*\{ position: static; height: auto; overflow-y: visible;[^}]*\}/);

  assert.ok(sidebarRule, 'expected desktop staff sidebar styling');
  assert.match(sidebarRule[1], /height:\s*100vh;/, 'keep a fallback for older browsers');
  assert.match(sidebarRule[1], /height:\s*100dvh;/, 'follow the visible viewport height');
  assert.match(sidebarRule[1], /overflow-y:\s*auto;/, 'keep lower navigation actions reachable');
  assert.ok(sidebarRule[1].indexOf('height: 100vh') < sidebarRule[1].indexOf('height: 100dvh'));
  assert.ok(mobileRule, 'mobile navigation should remain in normal page flow');
});

test('course catalog filters stack before the sort value is truncated', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const breakpointStart = styles.indexOf('@media (max-width: 450px)');

  assert.notEqual(breakpointStart, -1, 'expected a compact catalog-filter breakpoint');
  const nextBreakpoint = styles.indexOf('@media', breakpointStart + 1);
  const filterRules = styles.slice(breakpointStart, nextBreakpoint === -1 ? undefined : nextBreakpoint);

  assert.match(filterRules, /\.catalog-tools\s+\.filter-controls\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/);
  assert.match(filterRules, /\.catalog-tools\s+\.catalog-filter-control\s*\{\s*width:\s*100%;\s*\}/);
});

test('platform icon picker actions can wrap at mobile widths', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const mobilePickerRule = styles.indexOf('.platform-icon-picker { align-items: flex-start;');
  const mobileBreakpoint = styles.lastIndexOf('@media (max-width: 720px)', mobilePickerRule);
  const mobileBreakpointEnd = styles.indexOf('\n}', mobilePickerRule);

  assert.notEqual(mobilePickerRule, -1, 'expected a mobile platform icon picker rule');
  assert.notEqual(mobileBreakpoint, -1, 'expected the picker rule to be inside the mobile breakpoint');
  assert.notEqual(mobileBreakpointEnd, -1, 'expected the mobile breakpoint to close');

  const mobileRules = styles.slice(mobileBreakpoint, mobileBreakpointEnd);
  const actionRule = mobileRules.match(/\.platform-icon-actions\s*\{([^}]*)\}/);
  assert.ok(actionRule, 'expected mobile platform icon actions styling');
  assert.match(actionRule[1], /flex-wrap:\s*wrap;/);
});
