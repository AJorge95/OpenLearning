import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const managementSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const programsSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('shared management search actions retain a usable target and visible focus', () => {
  const searchActionRule = styles.match(/\.management-search > button, \.management-search > \.button\s*\{([^}]*)\}/)?.[1];
  assert.ok(searchActionRule, 'expected a shared management search action rule');
  assert.match(searchActionRule, /min-height:\s*40px/);
  assert.match(searchActionRule, /padding:\s*0 7px/);

  const focusRule = styles.match(/\.management-search > button:focus-visible, \.management-search > \.button:focus-visible\s*\{([^}]*)\}/)?.[1];
  assert.ok(focusRule, 'expected a visible keyboard focus rule for management search actions');
  assert.match(focusRule, /outline:\s*2px solid var\(--purple\)/);

  assert.match(styles, /\.path-assignment-search \.button\s*\{[^}]*min-height:\s*40px/);
  assert.match(managementSource, /className="management-search"[\s\S]*?>Search<\/button>/);
  assert.match(programsSource, /className="management-search"[\s\S]*?>Search<\/button>/);
  assert.match(programsSource, /className="management-search competency-search"[\s\S]*?<Button type="submit" variant="quiet"/);
  assert.match(programsSource, /className="management-search path-assignment-search"[\s\S]*?<Button type="submit" variant="quiet"/);
});
