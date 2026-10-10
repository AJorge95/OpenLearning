export type AppSelectNavigationOption = { disabled?: boolean };

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
