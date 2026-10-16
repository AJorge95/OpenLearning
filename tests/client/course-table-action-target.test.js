import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course table links keep reliable row-action targets', () => {
  const courseActions = source.match(/<div className="table-actions">[\s\S]*?<CourseRowMenu/)?.[0];
  assert.ok(courseActions, 'expected the course table action group');
  assert.match(courseActions, /<Link className="text-action" to=\{`\/manage\/courses\/\$\{course\.id\}\/edit`\}>Edit<\/Link>/);
  assert.match(courseActions, /<Link className="text-action" to=\{`\/manage\/courses\/\$\{course\.id\}\/analytics`\}>Analytics<\/Link>/);

  const targetRule = styles.match(/\.table-actions \.text-action\s*\{([^}]*)\}/)?.[1];
  assert.ok(targetRule, 'expected explicit course table action styles');
  assert.match(targetRule, /min-height:\s*40px/);
  assert.match(targetRule, /padding:\s*0 4px/);
});
