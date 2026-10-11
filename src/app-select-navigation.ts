export type AppSelectNavigationOption = { disabled?: boolean };
export type AppSelectTypeaheadOption = AppSelectNavigationOption & { label: string };
export type AppSelectDisplayOption<T extends string | number> = { value: T; label: string };

export function isAppSelectUnavailable(
  options: readonly AppSelectNavigationOption[],
  disabled = false,
) {
  return disabled || !options.some((option) => !option.disabled);
}

export function getAppSelectDisplayLabel<T extends string | number>(
  options: readonly AppSelectDisplayOption<T>[],
  value: T,
) {
  return options.find((option) => option.value === value)?.label ?? 'Choose an option';
}

export function findEnabledAppSelectIndex(
  options: readonly AppSelectNavigationOption[],
  start: number,
  direction: 1 | -1 = 1,
) {
  if (!options.length) return 0;
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = ((start + offset * direction) % options.length + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return 0;
}

export function findAppSelectTypeaheadIndex(
  options: readonly AppSelectTypeaheadOption[],
  start: number,
  prefix: string,
  cycleRepeatedCharacter = false,
) {
  if (!options.length || !prefix) return -1;
  const characters = Array.from(prefix);
  const needle = cycleRepeatedCharacter ? characters.at(-1) ?? '' : prefix;
  const normalizedNeedle = needle.normalize('NFC').toLocaleLowerCase().normalize('NFC');
  const firstIndex = cycleRepeatedCharacter ? start + 1 : start;
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = ((firstIndex + offset) % options.length + options.length) % options.length;
    const option = options[index];
    const normalizedLabel = option.label.normalize('NFC').toLocaleLowerCase().normalize('NFC');
    if (!option.disabled && normalizedLabel.startsWith(normalizedNeedle)) return index;
  }
  return -1;
}
