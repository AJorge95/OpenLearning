import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sourceRoot = new URL('../../src/', import.meta.url);
const componentSource = fs.readFileSync(new URL('components.tsx', sourceRoot), 'utf8');
const authSource = fs.readFileSync(new URL('pages-auth.tsx', sourceRoot), 'utf8');
const managementSource = fs.readFileSync(new URL('pages-manage.tsx', sourceRoot), 'utf8');
const styles = fs.readFileSync(new URL('styles.css', sourceRoot), 'utf8');

test('password fields start concealed and expose a labeled, non-submit show/hide action button', () => {
  assert.match(componentSource, /const \[visible, setVisible\] = useState\(false\)/);
  assert.match(componentSource, /type=\{visible \? 'text' : 'password'\}/);
  const visibilityButton = componentSource.match(/<button[^>]*className="password-visibility-toggle"[\s\S]*?<\/button>/)?.[0];
  assert.ok(visibilityButton, 'Expected a native button for changing password visibility.');
  assert.match(visibilityButton, /type="button"/);
  assert.match(visibilityButton, /aria-label=\{`\$\{visible \? 'Hide' : 'Show'\} \$\{label\.toLowerCase\(\)\}`\}/);
  assert.match(visibilityButton, /aria-controls=\{inputId\}/);
  assert.doesNotMatch(visibilityButton, /aria-pressed/);
  assert.match(visibilityButton, /onClick=\{\(\) => setVisible\(\(current\) => !current\)\}/);
  assert.match(visibilityButton, />\s*\{visible \? 'Hide' : 'Show'\}\s*<\/button>/);
  assert.match(componentSource, /\[\.\.\.new Set\(\[describedBy, visibleHintId\]\.filter\(Boolean\)\)\]/);
});

test('revealed password fields remask when their value is cleared', () => {
  assert.ok(componentSource.includes("if (inputProps.value === '') setVisible(false);"));
  assert.ok(componentSource.includes('inputProps.onChange?.(event);'));
  assert.ok(componentSource.includes('if (isEmpty) setVisible(false);'));
  assert.match(componentSource, /onChange=\{handlePasswordChange\}/);
});

test('all password-entry forms use the shared field while the setup token stays concealed', () => {
  assert.equal((authSource.match(/<PasswordField\b/g) || []).length, 8);
  assert.equal((managementSource.match(/<PasswordField\b/g) || []).length, 6);
  assert.equal((authSource.match(/type="password"/g) || []).length, 1);
  assert.match(authSource, /<label><span className="form-label-row"><span>One-time setup token<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input name="setupToken" required[^>]*type="password"/);
  assert.doesNotMatch(managementSource, /type="password"/);
});

test('the visibility control keeps a clear target, palette focus, and room for password text', () => {
  assert.match(styles, /\.password-visibility-toggle\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*40px;/);
  assert.match(styles, /\.password-visibility-toggle:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\);/);
  assert.match(styles, /\.form-stack \.password-input-control input, \.account-password-form \.password-input-control input\s*\{\s*padding-inline-end:\s*64px;\s*\}/);
});
