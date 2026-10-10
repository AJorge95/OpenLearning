import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { findMissingRequiredRegistrationField, validateRegistrationFieldEditor } from '../../src/registration-fields.ts';

const fields = [
  { id: 'department', label: 'Department', type: 'select', required: true, options: ['Design', 'Research'] },
  { id: 'about', label: 'About you', type: 'text', required: true, options: [] },
  { id: 'start-date', label: 'Start date', type: 'date', required: true, options: [] },
  { id: 'policy', label: 'Learning policy', type: 'checkbox', required: true, options: [] },
  { id: 'optional', label: 'Optional detail', type: 'text', required: false, options: [] },
];

test('required registration answers are found when choices or text are blank', () => {
  assert.equal(findMissingRequiredRegistrationField(fields, { department: '' })?.id, 'department');
  assert.equal(findMissingRequiredRegistrationField(fields, { department: 'Design', about: '  ' })?.id, 'about');
  assert.equal(findMissingRequiredRegistrationField(fields, { department: 'Design', about: 'Returning learner' })?.id, 'start-date');
});

test('checkbox requiredness and optional blank fields are handled separately', () => {
  const values = { department: 'Research', about: 'Here', 'start-date': '2026-10-09', policy: false, optional: '  ' };
  assert.equal(findMissingRequiredRegistrationField(fields, values)?.id, 'policy');
  assert.equal(findMissingRequiredRegistrationField(fields, { ...values, policy: true }), undefined);
});

test('invalid registration checkboxes can receive focus and reference the form error', () => {
  const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
  const checkboxBranch = source.match(/if \(field\.type === 'checkbox'\) return <label[\s\S]*?<\/label>/)?.[0];

  assert.ok(checkboxBranch, 'Expected to find the custom registration checkbox field.');
  assert.match(checkboxBranch, /id=\{`registration-field-\$\{field\.id\}`\}/);
  assert.match(checkboxBranch, /aria-invalid=\{invalidFieldId === field\.id \|\| undefined\}/);
  assert.match(checkboxBranch, /aria-describedby=\{invalidFieldId === field\.id \? 'registration-form-error' : undefined\}/);
});

test('registration field editor identifies blank and duplicate labels', () => {
  assert.deepEqual(validateRegistrationFieldEditor([
    { ...fields[0], label: '  ' },
  ]), {
    fieldId: 'department',
    target: 'label',
    message: 'Registration field 1 needs a unique label of 1 to 80 characters.',
  });
  assert.equal(validateRegistrationFieldEditor([
    { ...fields[0], label: 'Department' },
    { ...fields[1], id: 'duplicate', label: ' department ' },
  ])?.fieldId, 'duplicate');
});

test('registration label and option uniqueness does not depend on browser locale', () => {
  const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = function toTurkishLowerCase() {
    return originalToLocaleLowerCase.call(this, 'tr');
  };
  try {
    assert.equal(validateRegistrationFieldEditor([
      { ...fields[0], id: 'interest', label: 'I', options: ['I', 'ı'] },
    ]), null);
    assert.equal(validateRegistrationFieldEditor([
      { ...fields[1], id: 'first', label: 'I' },
      { ...fields[2], id: 'second', label: 'ı' },
    ]), null);
  } finally {
    String.prototype.toLocaleLowerCase = originalToLocaleLowerCase;
  }
});

test('registration field editor validates select options using server rules', () => {
  const result = validateRegistrationFieldEditor([
    { ...fields[0], options: ['Design', ' design '] },
  ]);
  assert.deepEqual(result, {
    fieldId: 'department',
    target: 'options',
    message: '"Department" needs 2 to 30 unique options, each up to 100 characters.',
  });
  assert.equal(validateRegistrationFieldEditor([
    { ...fields[0], options: [' Design ', ' Research ', ''] },
  ]), null);
});
