import { db, setSetting, setting } from './db.js';
import { fail } from './http.js';

const allowedTypes = new Set(['date', 'text', 'select', 'checkbox']);
const maximumFields = 30;
const maximumOptions = 30;
const maximumTextLength = 2000;

function caseInsensitiveKey(value) {
  return value.normalize('NFC').toLowerCase().normalize('NFC');
}

export function normalizeRegistrationFields(value, { allowCanonicalDuplicates = false } = {}) {
  if (!Array.isArray(value) || value.length > maximumFields) {
    fail(400, `Add between 0 and ${maximumFields} registration fields.`, 'invalid_registration_fields');
  }

  const ids = new Set();
  const labels = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail(400, `Registration field ${index + 1} is invalid.`, 'invalid_registration_fields');
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const type = item.type;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) {
      fail(400, `Registration field ${index + 1} needs a unique field ID.`, 'invalid_registration_fields');
    }
    const normalizedLabel = caseInsensitiveKey(label);
    if (!label || label.length > 80 || (!allowCanonicalDuplicates && labels.has(normalizedLabel))) {
      fail(400, `Registration field ${index + 1} needs a unique label of 1 to 80 characters.`, 'invalid_registration_fields');
    }
    if (!allowedTypes.has(type)) {
      fail(400, `Choose a valid type for registration field "${label}".`, 'invalid_registration_fields');
    }
    if (typeof item.required !== 'boolean') {
      fail(400, `Choose whether "${label}" is required.`, 'invalid_registration_fields');
    }
    ids.add(id);
    labels.add(normalizedLabel);

    let options = [];
    if (type === 'select') {
      if (!Array.isArray(item.options)) {
        fail(400, `Add options for "${label}".`, 'invalid_registration_fields');
      }
      options = item.options.map((option) => typeof option === 'string' ? option.trim() : '');
      while (options.length && options.at(-1) === '') options.pop();
      if (options.length < 2 || options.length > maximumOptions || options.some((option) => !option || option.length > 100)
        || (!allowCanonicalDuplicates && new Set(options.map(caseInsensitiveKey)).size !== options.length)) {
        fail(400, `"${label}" needs 2 to ${maximumOptions} unique options, each up to 100 characters.`, 'invalid_registration_fields');
      }
    }
    return { id, label, type, required: item.required, options };
  });
}

export function readRegistrationFields() {
  const value = setting('registration_fields');
  if (!value) return { fields: [], configurationValid: true };
  try {
    // Keep previously saved canonically equivalent values readable; strict uniqueness applies to new writes.
    return { fields: normalizeRegistrationFields(JSON.parse(value), { allowCanonicalDuplicates: true }), configurationValid: true };
  } catch {
    return { fields: [], configurationValid: false };
  }
}

export function getRegistrationFields() {
  const result = readRegistrationFields();
  if (!result.configurationValid) {
    fail(503, 'The registration form is temporarily unavailable. Please contact an administrator.', 'registration_fields_unavailable');
  }
  return result.fields;
}

export function saveRegistrationFields(fields) {
  const normalized = normalizeRegistrationFields(fields);
  setSetting('registration_fields', JSON.stringify(normalized));
  return normalized;
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeRegistrationFieldValues(value, fields) {
  const submitted = value === undefined ? {} : value;
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    fail(400, 'Registration field answers must be an object.', 'invalid_registration_answers');
  }
  const knownIds = new Set(fields.map((field) => field.id));
  if (Object.keys(submitted).some((id) => !knownIds.has(id))) {
    fail(409, 'Registration fields changed. Refresh the page and try again.', 'registration_fields_changed');
  }

  return fields.map((field) => {
    const rawValue = Object.hasOwn(submitted, field.id) ? submitted[field.id] : undefined;
    if (field.type === 'checkbox') {
      if (rawValue !== undefined && typeof rawValue !== 'boolean') {
        fail(400, `Enter a valid answer for "${field.label}".`, 'invalid_registration_answers');
      }
      const answer = rawValue ?? false;
      if (field.required && !answer) fail(400, `You must agree to "${field.label}".`, 'required_registration_field');
      return { ...field, value: answer ? 'true' : 'false' };
    }

    if (rawValue !== undefined && typeof rawValue !== 'string') {
      fail(400, `Enter a valid answer for "${field.label}".`, 'invalid_registration_answers');
    }
    if (typeof rawValue === 'string' && rawValue.length > maximumTextLength) {
      fail(400, `"${field.label}" must be ${maximumTextLength} characters or fewer.`, 'invalid_registration_answers');
    }
    const answer = (rawValue ?? '').trim();
    if (field.required && !answer) fail(400, `"${field.label}" is required.`, 'required_registration_field');
    if (answer && field.type === 'date' && !validCalendarDate(answer)) {
      fail(400, `Choose a valid date for "${field.label}".`, 'invalid_registration_answers');
    }
    if (answer && field.type === 'select' && !field.options.includes(answer)) {
      fail(400, `Choose one of the available options for "${field.label}".`, 'invalid_registration_answers');
    }
    return { ...field, value: answer };
  });
}

export function saveUserRegistrationFieldValues(userId, answers) {
  const insert = db.prepare(`INSERT INTO user_registration_field_values
    (user_id, field_id, field_label, field_type, field_value, position)
    VALUES (?, ?, ?, ?, ?, ?)`);
  answers.forEach((answer, position) => {
    insert.run(userId, answer.id, answer.label, answer.type, answer.value, position);
  });
}
