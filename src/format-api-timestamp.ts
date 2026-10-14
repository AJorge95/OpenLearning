import { parseApiTimestamp } from './api-timestamp.ts';

// Keep management views usable when a legacy record contains a malformed timestamp.
export function formatApiTimestamp(value: string, formatter: Intl.DateTimeFormat, fallback = '—') {
  const date = parseApiTimestamp(value);
  return Number.isNaN(date.getTime()) ? fallback : formatter.format(date);
}
