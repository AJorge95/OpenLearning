import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authPages = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const managementPages = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('authentication and account autofill fields have stable form names', () => {
  const fields = [authPages, managementPages]
    .flatMap((source) => [...source.matchAll(/<(?:input|PasswordField)\b(?:(?!>).)*autoComplete="(?!off")[^"]+"(?:(?!>).)*>/gs)])
    .map((match) => match[0]);

  assert.ok(fields.length >= 30, 'the covered authentication and account forms should remain in the scan');
  for (const field of fields) {
    assert.match(field, /\bname="[A-Za-z][A-Za-z0-9]*"/, `autofill field is missing a stable name: ${field}`);
  }
});
