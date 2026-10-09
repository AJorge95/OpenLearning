function parseTimestamp(value) {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) return null;

  return {
    hours: (match[1] || '0').replace(/^0+(?=\d)/, ''),
    minutes: Number(match[2]),
    seconds: Number(match[3]),
    milliseconds: Number(match[4]),
  };
}

function compareTimestamps(left, right) {
  if (left.hours.length !== right.hours.length) return left.hours.length < right.hours.length ? -1 : 1;
  if (left.hours !== right.hours) return left.hours < right.hours ? -1 : 1;
  for (const part of ['minutes', 'seconds', 'milliseconds']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  return 0;
}

function parseCueTiming(line) {
  const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/.exec(line);
  if (!match) return null;

  const start = parseTimestamp(match[1]);
  const end = parseTimestamp(match[2]);
  if (start === null || end === null || compareTimestamps(end, start) <= 0) return null;

  if (match[3] !== undefined) {
    const settings = match[3].split(/[ \t]+/);
    if (settings.some((setting) => {
      const separator = setting.indexOf(':');
      return separator <= 0 || separator === setting.length - 1 || setting.includes('-->');
    })) return null;
  }

  return { start };
}

/**
 * Check WebVTT headers and cue timing structure without interpreting cue text or CSS.
 * The browser remains responsible for parsing and rendering WebVTT payloads.
 */
export function hasValidWebVttCueTimings(text) {
  if (typeof text !== 'string') return false;

  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const header = /^WEBVTT(?:[ \t][^\n]*)?\n{2,}/.exec(normalized);
  if (!header) return false;

  const blocks = normalized.slice(header[0].length).split(/\n{2,}/);
  const cueIdentifiers = new Set();
  let previousStart = null;
  let sawCue = false;

  for (const block of blocks) {
    if (!block) continue;
    const lines = block.split('\n');
    const firstLine = lines[0];

    if (/^NOTE(?:[ \t]|$)/.test(firstLine)) {
      if (block.includes('-->')) return false;
      continue;
    }

    if (!sawCue && /^STYLE[ \t]*$/.test(firstLine)) {
      if (block.includes('-->')) return false;
      continue;
    }

    if (!sawCue && /^REGION[ \t]*$/.test(firstLine)) {
      if (block.includes('-->') || lines.length < 2 || !lines[1]) return false;
      continue;
    }

    let identifier = null;
    let timing = parseCueTiming(firstLine);
    let payloadStart = 1;
    if (!timing) {
      identifier = firstLine;
      if (identifier.includes('-->') || !lines[1]) return false;
      timing = parseCueTiming(lines[1]);
      payloadStart = 2;
    }

    if (!timing || lines.slice(payloadStart).some((line) => line.includes('-->'))) return false;
    if (identifier !== null) {
      if (cueIdentifiers.has(identifier)) return false;
      cueIdentifiers.add(identifier);
    }
    if (previousStart !== null && compareTimestamps(timing.start, previousStart) < 0) return false;

    previousStart = timing.start;
    sawCue = true;
  }

  return true;
}
