export function likeContains(value) {
  return `%${String(value).replace(/[!%_]/g, '!$&')}%`;
}

export function unicodeContains(value, query) {
  if (typeof value !== 'string' || typeof query !== 'string') return 0;
  const normalizedValue = value.normalize('NFC').toLowerCase().normalize('NFC');
  const normalizedQuery = query.normalize('NFC').toLowerCase().normalize('NFC');
  return normalizedValue.includes(normalizedQuery) ? 1 : 0;
}

export function textSearchPredicate(columns, query) {
  const fields = Array.isArray(columns) ? columns : [];
  // SQLite LIKE folds ASCII case only; keep its native path for common queries.
  if (Array.from(query).some((character) => character.codePointAt(0) > 0x7f)) {
    return {
      sql: fields.map((field) => `unicode_contains(${field}, ?)`).join(' OR '),
      params: fields.map(() => query),
    };
  }
  const pattern = likeContains(query);
  return {
    sql: fields.map((field) => `${field} LIKE ? ESCAPE '!'`).join(' OR '),
    params: fields.map(() => pattern),
  };
}
