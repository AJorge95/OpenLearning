import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildRegistrationFieldSelectOptions, findMissingRequiredRegistrationField, hasUnsavedRegistrationFieldChanges, refreshRegistrationFieldValues, validateRegistrationFieldEditor } from '../../src/registration-fields.ts';

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

test('registration field edits compare against the saved schema and clear when reverted', () => {
  assert.equal(hasUnsavedRegistrationFieldChanges(fields, null), false);
  assert.equal(hasUnsavedRegistrationFieldChanges(fields, structuredClone(fields)), false);
  assert.equal(hasUnsavedRegistrationFieldChanges([{ ...fields[0], label: 'Team' }, ...fields.slice(1)], fields), true);
  assert.equal(hasUnsavedRegistrationFieldChanges([{ ...fields[0], options: ['Research', 'Design'] }, ...fields.slice(1)], fields), true);
  assert.equal(hasUnsavedRegistrationFieldChanges([...fields].reverse(), fields), true);
  const edited = [{ ...fields[0], label: 'Team' }, ...fields.slice(1)];
  assert.equal(hasUnsavedRegistrationFieldChanges(edited, fields), true);
  const reverted = structuredClone(fields);
  assert.equal(hasUnsavedRegistrationFieldChanges(reverted, fields), false, 'restoring the saved schema should clear the dirty state');
});

test('custom signup fields use a navigable heading without changing its visual size', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

  assert.match(pageSource, /registration-form-fields-heading"><h2>About you<\/h2><span>/);
  assert.match(styles, /\.registration-form-fields-heading h2 \{ margin: 0; color: var\(--ink\); font-size: 14px; \}/);
});

test('registration field editor stacks before its fixed minimum columns overflow staff content', () => {
  const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.registration-field-editor-grid \{ display: grid; grid-template-columns: minmax\(180px, 1fr\) minmax\(170px, \.8fr\) minmax\(150px, \.65fr\);/);
  assert.match(styles, /@media \(max-width: 860px\) \{\s*\.registration-field-editor-grid \{ grid-template-columns: 1fr; \}\s*\}/);
});

test('registration select options stay stable while answer values rerender the form', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
  const optionsByFieldId = buildRegistrationFieldSelectOptions(fields);

  assert.match(pageSource, /useMemo\(\(\) => buildRegistrationFieldSelectOptions\(fields\), \[fields\]\)/);
  assert.match(pageSource, /options=\{selectOptionsByFieldId\.get\(field\.id\) \?\? EMPTY_REGISTRATION_SELECT_OPTIONS\}/);
  assert.deepEqual(optionsByFieldId.get('department'), [
    { value: '', label: 'Choose an option' },
    { value: 'Design', label: 'Design' },
    { value: 'Research', label: 'Research' },
  ]);
  assert.equal(optionsByFieldId.has('about'), false);
});

test('checkbox requiredness and optional blank fields are handled separately', () => {
  const values = { department: 'Research', about: 'Here', 'start-date': '2026-10-09', policy: false, optional: '  ' };
  assert.equal(findMissingRequiredRegistrationField(fields, values)?.id, 'policy');
  assert.equal(findMissingRequiredRegistrationField(fields, { ...values, policy: true }), undefined);
});

test('registration field refresh keeps only answers that remain compatible with the updated schema', () => {
  const previousFields = [
    ...fields,
    { id: 'changed-type', label: 'Old text', type: 'text', required: false, options: [] },
    { id: 'long-text', label: 'Long response', type: 'text', required: false, options: [] },
  ];
  const nextFields = [
    { ...fields[0], label: 'Team', options: ['Design', 'Support'] },
    { ...fields[1], label: 'Updated about you' },
    { ...fields[2], required: false },
    { ...fields[3], label: 'Updated policy text' },
    { ...fields[4] },
    { id: 'changed-type', label: 'Updated choice', type: 'select', required: false, options: ['A', 'B'] },
    { id: 'new-field', label: 'New detail', type: 'date', required: false, options: [] },
  ];

  assert.deepEqual(refreshRegistrationFieldValues(previousFields, nextFields, {
    department: 'Research',
    policy: true,
    'start-date': '2026-10-09',
    about: 'Returning learner',
    optional: 'Optional answer',
    'changed-type': 'Old answer',
    'long-text': 'x'.repeat(2001),
    removed: 'Old field answer',
  }), {
    department: '',
    policy: true,
    'start-date': '2026-10-09',
    about: 'Returning learner',
    optional: 'Optional answer',
    'changed-type': '',
    'new-field': '',
  });
});

test('stale registration field answers reload the schema and announce that review is needed', () => {
  const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');

  assert.match(source, /cause instanceof ApiError && \(cause\.code === 'registration_fields_changed' \|\| cause\.code === 'invalid_registration_answers'\)/);
  assert.match(source, /Select options may change while the learner's registration form is open; refresh before asking them to retry\./);
  assert.match(source, /setRegistrationFieldsRetryVersion\(\(version\) => version \+ 1\)/);
  assert.match(source, /refreshRegistrationFieldValues\(previousFields, result\.fields, current\)/);
  assert.match(source, /Answers that still match were kept; review the updated fields and submit again\./);
  assert.match(source, /registrationFieldsRef\.current = result\.fields/);
});

test('invalid registration checkboxes can receive focus and reference the form error', () => {
  const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
  const checkboxBranch = source.match(/if \(field\.type === 'checkbox'\) return <label[\s\S]*?<\/label>/)?.[0];

  assert.ok(checkboxBranch, 'Expected to find the custom registration checkbox field.');
  assert.match(checkboxBranch, /id=\{`registration-field-\$\{field\.id\}`\}/);
  assert.match(checkboxBranch, /aria-invalid=\{invalidFieldId === field\.id \|\| undefined\}/);
  assert.match(checkboxBranch, /aria-describedby=\{invalidFieldId === field\.id \? 'registration-form-error' : undefined\}/);
});

test('required registration selects expose required semantics to assistive technology', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
  const selectBranch = pageSource.match(/if \(field\.type === 'select'\) return <div className="registration-custom-field"[\s\S]*?<\/div>;/)?.[0];
  const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

  assert.ok(selectBranch, 'Expected to find the custom registration select field.');
  assert.match(selectBranch, /ariaLabel=\{field\.label\}/);
  assert.match(selectBranch, /required=\{field\.required\}/);
  assert.match(componentSource, /aria-required=\{required \|\| undefined\}/);
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

test('registration editor rejects canonically equivalent duplicate labels and options', () => {
  assert.equal(validateRegistrationFieldEditor([
    { ...fields[0], options: ['Café', 'Cafe\u0301'] },
  ])?.target, 'options');
  assert.equal(validateRegistrationFieldEditor([
    { ...fields[1], label: 'Café' },
    { ...fields[2], id: 'duplicate-label', label: 'Cafe\u0301' },
  ])?.target, 'label');
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
