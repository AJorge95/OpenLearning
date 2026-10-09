export function likeContains(value) {
  return `%${String(value).replace(/[!%_]/g, '!$&')}%`;
}
