import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDirectory, '../../src/components.tsx'), 'utf8');
const styles = fs.readFileSync(path.resolve(testDirectory, '../../src/styles.css'), 'utf8');

test('staff sign-out keeps its accessible name and a reliable icon-only target', () => {
  assert.match(source, /<button type="button" disabled=\{signingOut\} aria-busy=\{signingOut\} aria-label=\{signingOut \? 'Signing out' : 'Sign out'\} title=\{signingOut \? 'Signing out' : 'Sign out'\} onClick=\{handleSignOut\}><LogOut size=\{17\} aria-hidden="true" \/><\/button>/);
  assert.match(styles, /\.staff-account button \{[^}]*display: grid;[^}]*flex: 0 0 40px;[^}]*width: 40px;[^}]*height: 40px;/);
  assert.match(styles, /\.staff-account button:hover:not\(:disabled\) \{[^}]*border-color: var\(--purple-border-strong\);[^}]*background: var\(--purple-soft\);/);
  assert.match(styles, /\.staff-account button:focus-visible \{[^}]*outline: 2px solid var\(--purple\);[^}]*border-color: var\(--purple\);/);
});
