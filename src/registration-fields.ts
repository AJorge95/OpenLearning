import type { RegistrationField, RegistrationFieldValues } from './types';

export type RegistrationFieldEditorIssue = {
  fieldId: string;
  target: 'label' | 'options';
  message: string;
};

export function findMissingRequiredRegistrationField(fields: RegistrationField[], values: RegistrationFieldValues) {
  return fields.find((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return field.type === 'checkbox' ? value !== true : typeof value !== 'string' || !value.trim();
  });
}

export function validateRegistrationFieldEditor(fields: RegistrationField[]): RegistrationFieldEditorIssue | null {
  const labels = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const label = field.label.trim();
    const normalizedLabel = label.toLocaleLowerCase();
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
      || new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      return {
        fieldId: field.id,
        target: 'options',
        message: `"${label}" needs 2 to 30 unique options, each up to 100 characters.`,
      };
    }
  }
  return null;
}
