const timezoneSuffix = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

// SQLite CURRENT_TIMESTAMP values are UTC even when the API string has no timezone marker.
export function parseApiTimestamp(value: string) {
  const normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const hasDateTime = /^\d{4}-\d{2}-\d{2}T/.test(normalized);
  return new Date(hasDateTime && !timezoneSuffix.test(normalized) ? `${normalized}Z` : normalized);
}
