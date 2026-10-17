import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const registrationForm = source.slice(source.indexOf('function RegistrationFieldsForm'), source.indexOf('export function SetupPage'));
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const registrationFields = fs.readFileSync(new URL('../../server/registration-fields.js', import.meta.url), 'utf8');

test('custom registration text fields expose a count and preserve validation descriptions', () => {
  assert.match(registrationForm, /maxLength=\{field\.type === 'text' \? 2000 : undefined\}/);
  assert.match(registrationForm, /aria-describedby=\{describedBy\}/);
  assert.match(registrationForm, /fieldDescriptionId = field\.type === 'text' \? `registration-field-count-\$\{field\.id\}` : undefined/);
  assert.match(registrationForm,
    /<small id=\{fieldDescriptionId\} className="field-character-count">\{fieldValue\.length\} \/ 2,000 characters<\/small>/);
  assert.match(registrationForm, /isInvalid \? 'registration-form-error' : undefined/);
  assert.match(styles, /\.registration-custom-field > span small, \.registration-checkbox-field small/);
  assert.match(registrationFields, /const maximumTextLength = 2000/);
  assert.match(registrationFields, /rawValue\.length > maximumTextLength/);
});
