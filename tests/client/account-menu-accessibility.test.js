import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/components.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const styles = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css'), 'utf8');
const header = source.match(/export function Header\(\) \{([\s\S]*?)\n\}\n\nexport function AppFrame/);
assert.ok(header, 'Expected to find the shared learner header.');

test('account disclosure exposes its native open state to assistive technology', () => {
  const headerSource = header[1];

  assert.match(headerSource, /const \[userMenuOpen, setUserMenuOpen\] = useState\(false\);/);
  assert.match(headerSource, /<details ref=\{userMenuRef\} className="user-menu" onToggle=\{\(event\) => setUserMenuOpen\(event\.currentTarget\.open\)\}>/);
  assert.match(headerSource, /<summary role="button" aria-label=\{user\?\.username \? `Open account menu for \$\{user\.username\}` : 'Open account menu'\} aria-expanded=\{userMenuOpen\} aria-controls="user-menu-popover">/);
  assert.match(headerSource, /<div id="user-menu-popover" className="user-menu-popover">/);
});

test('route changes reset the account disclosure state', () => {
  assert.match(header[1], /if \(userMenuRef\.current\) userMenuRef\.current\.open = false;\s*setUserMenuOpen\(false\);/);
});

test('account chevron follows the disclosure state', () => {
  assert.match(styles, /\.user-menu summary > svg \{ transition: transform \.15s ease; \}/);
  assert.match(styles, /\.user-menu\[open\] summary > svg \{ transform: rotate\(180deg\); \}/);
});
