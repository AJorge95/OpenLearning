import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clearPasswordConfirmationError, getPasswordConfirmationError, passwordConfirmationFieldProps, PASSWORD_CONFIRMATION_ERROR } from '../../src/password-confirmation.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('password confirmation accepts identical values without trimming', () => {
  assert.equal(getPasswordConfirmationError('correct horse battery staple', 'correct horse battery staple'), null);
  assert.equal(getPasswordConfirmationError(' password ', ' password '), null);
});

test('password confirmation reports mismatched values', () => {
  assert.equal(getPasswordConfirmationError('correct horse battery staple', 'correct horse battery stapler'), 'Passwords do not match.');
  assert.equal(getPasswordConfirmationError('password', ' password'), 'Passwords do not match.');
});

test('password edits clear only the password confirmation warning', () => {
  assert.equal(clearPasswordConfirmationError(PASSWORD_CONFIRMATION_ERROR), '');
  assert.equal(clearPasswordConfirmationError('Another validation error.'), 'Another validation error.');
});

test('password mismatch feedback marks and describes only the confirmation field', () => {
  assert.deepEqual(passwordConfirmationFieldProps(PASSWORD_CONFIRMATION_ERROR, 'password-error'), {
    'aria-invalid': true,
    'aria-describedby': 'password-error',
  });
  assert.deepEqual(passwordConfirmationFieldProps('Another validation error.', 'password-error'), {
    'aria-invalid': undefined,
    'aria-describedby': undefined,
  });
});

test('server-confirmation errors can keep the confirmation field associated with the alert', () => {
  assert.deepEqual(passwordConfirmationFieldProps('The passwords differ.', 'password-error', true), {
    'aria-invalid': true,
    'aria-describedby': 'password-error',
  });
});

test('all password confirmation forms use the shared client validation', () => {
  const countValidationCalls = (fileName) => {
    const source = fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8');
    return source.match(/getPasswordConfirmationError\(/g)?.length ?? 0;
  };

  assert.equal(countValidationCalls('pages-auth.tsx'), 3);
  assert.equal(countValidationCalls('pages-manage.tsx'), 3);
});

test('all password confirmation forms clear a stale warning when either value changes', () => {
  const countErrorClears = (fileName) => {
    const source = fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8');
    return source.match(/clearPasswordConfirmationError\(currentError\)/g)?.length ?? 0;
  };

  assert.equal(countErrorClears('pages-auth.tsx'), 6);
  assert.equal(countErrorClears('pages-manage.tsx'), 4);
  const manageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const accountDetailsPage = manageSource.slice(
    manageSource.indexOf('export function AdminUserDetailsPage()'),
    manageSource.indexOf('\nexport function AdminAuditLogPage()'),
  );
  assert.equal(accountDetailsPage.match(/clearAccountActionFeedback\(\);/g)?.length ?? 0, 5);
});

test('all six confirmation fields link mismatch feedback to their rendered alert', () => {
  for (const fileName of ['pages-auth.tsx', 'pages-manage.tsx']) {
    const source = fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8');
    const fields = source.match(/<PasswordField label="Confirm(?: new)? password"[\s\S]*?\/>/g) || [];

    assert.equal(fields.length, 3, `${fileName} should contain three password-confirmation fields`);
    for (const field of fields) {
      const errorId = field.match(/passwordConfirmationFieldProps\(error,\s*(?:'([^']+)'|([A-Za-z][\w]*))(?:,\s*[^)]*)?\)/);
      assert.ok(errorId, `${fileName} confirmation field should derive invalid state from the shared helper`);
      const id = errorId[1] || errorId[2];
      assert.match(source, new RegExp(`(?:<p|<Notice)[^>]*id=(?:\\{${id}\\}|"${id}")`), `${fileName} should render the referenced mismatch alert`);
    }
  }
});
