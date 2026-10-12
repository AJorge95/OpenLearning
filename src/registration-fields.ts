import type { RegistrationField, RegistrationFieldValues } from './types';

export type RegistrationFieldEditorIssue = {
  fieldId: string;
  target: 'label' | 'options';
  message: string;
};

export function buildRegistrationFieldSelectOptions(fields: RegistrationField[]) {
  const optionsByFieldId = new Map<string, { value: string; label: string }[]>();
  for (const field of fields) {
    if (field.type !== 'select') continue;
    optionsByFieldId.set(field.id, [
      { value: '', label: 'Choose an option' },
      ...field.options.map((option) => ({ value: option, label: option })),
    ]);
  }
  return optionsByFieldId;
}

function caseInsensitiveKey(value: string) {
  return value.normalize('NFC').toLowerCase().normalize('NFC');
}

export function findMissingRequiredRegistrationField(fields: RegistrationField[], values: RegistrationFieldValues) {
  return fields.find((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return field.type === 'checkbox' ? value !== true : typeof value !== 'string' || !value.trim();
  });
}

export function refreshRegistrationFieldValues(
  previousFields: RegistrationField[],
  currentFields: RegistrationField[],
  values: RegistrationFieldValues,
): RegistrationFieldValues {
  const previousById = new Map(previousFields.map((field) => [field.id, field]));
  return Object.fromEntries(currentFields.map((field) => {
    const previous = previousById.get(field.id);
    const value = values[field.id];
    const emptyValue = field.type === 'checkbox' ? false : '';
    if (!previous || previous.type !== field.type) return [field.id, emptyValue];
    if (field.type === 'checkbox') return [field.id, typeof value === 'boolean' ? value : false];
    if (typeof value !== 'string') return [field.id, ''];
    if (field.type === 'select' && value && !field.options.includes(value)) return [field.id, ''];
    if (field.type === 'text' && value.length > 2000) return [field.id, ''];
    return [field.id, value];
  }));
}

export function validateRegistrationFieldEditor(fields: RegistrationField[]): RegistrationFieldEditorIssue | null {
  const labels = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const label = field.label.trim();
    const normalizedLabel = caseInsensitiveKey(label);
    if (!label || label.length > 80 || labels.has(normalizedLabel)) {
      return {
        fieldId: field.id,
        target: 'label',
        message: `Registration field ${index + 1} needs a unique label of 1 to 80 characters.`,
      };
    }
    labels.add(normalizedLabel);

    if (field.type !== 'select') continue;
    const options = field.options.map((option) => option.trim());
    while (options.length && options.at(-1) === '') options.pop();
    if (options.length < 2 || options.length > 30 || options.some((option) => !option || option.length > 100)
      || new Set(options.map(caseInsensitiveKey)).size !== options.length) {
      return {
        fieldId: field.id,
        target: 'options',
        message: `"${label}" needs 2 to 30 unique options, each up to 100 characters.`,
      };
    }
  }
  return null;
}
