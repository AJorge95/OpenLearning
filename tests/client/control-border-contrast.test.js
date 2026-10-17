import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const rootBlocks = Array.from(styles.matchAll(/:root(?:\[data-palette="([^"]+)"\])?\s*\{([^}]*)\}/g), (match) => ({
  palette: match[1] ?? 'default',
  tokens: Object.fromEntries(Array.from(match[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), (token) => [token[1], token[2].trim()])),
}));
const [root] = rootBlocks;
const palettes = rootBlocks.slice(1).map(({ palette, tokens }) => ({ palette, tokens: { ...root.tokens, ...tokens } }));
palettes.unshift({ palette: 'default', tokens: root.tokens });

function resolveColor(tokens, name) {
  const value = tokens[name];
  assert.ok(value, `Expected ${name} to be defined`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? resolveColor(tokens, reference[1]) : value;
}

function luminance(color) {
  const hex = color.slice(1);
  const expandedHex = hex.length === 3 ? Array.from(hex, (channel) => channel + channel).join('') : hex;
  const channels = expandedHex.match(/.{2}/g)?.map((channel) => parseInt(channel, 16) / 255);
  assert.equal(channels?.length, 3, `Expected a three- or six-digit hex color, got ${color}`);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

test('palette text colors keep 4.5:1 contrast on their tinted surfaces', () => {
  // These colors appear in small labels and links, so each foreground/background pair needs text contrast.
  const textPairs = [
    ['--purple', '--purple-soft'],
    ['--purple', '--purple-hover-bg'],
    ['--purple-dark', '--purple-soft'],
    ['--purple-dark', '--purple-hover-bg'],
    ['--purple-dark', '--purple-selected'],
    ['--purple-contrast', '--purple-selection'],
    ['--purple-contrast', '--purple-hover-bg'],
    ['--purple-contrast', '--purple-selected'],
    ['--muted', '--surface'],
    ['--muted', '--subtle'],
  ];

  for (const { palette, tokens } of palettes) {
    for (const [foreground, background] of textPairs) {
      const ratio = contrastRatio(resolveColor(tokens, foreground), resolveColor(tokens, background));
      assert.ok(ratio >= 4.5, `${palette} ${foreground} has only ${ratio.toFixed(2)}:1 contrast on ${background}`);
    }
  }
});

test('shared control borders keep 3:1 contrast on primary and subtle surfaces in every palette', () => {
  for (const { palette, tokens } of palettes) {
    const border = resolveColor(tokens, '--line-strong');
    for (const surface of ['--surface', '--subtle']) {
      const ratio = contrastRatio(border, resolveColor(tokens, surface));
      assert.ok(ratio >= 3, `${palette} control border has only ${ratio.toFixed(2)}:1 contrast on ${surface}`);
    }
  }
});

test('select hover and expanded borders keep 3:1 contrast in every palette', () => {
  for (const { palette, tokens } of palettes) {
    const border = resolveColor(tokens, '--purple-border-strong');
    for (const surface of ['--surface', '--subtle']) {
      const ratio = contrastRatio(border, resolveColor(tokens, surface));
      assert.ok(ratio >= 3, `${palette} select border has only ${ratio.toFixed(2)}:1 contrast on ${surface}`);
    }
  }
});

test('palette state indicators keep 3:1 contrast on their tinted surfaces', () => {
  for (const { palette, tokens } of palettes) {
    const accent = resolveColor(tokens, '--purple-border-strong');
    for (const surface of ['--purple-soft', '--purple-hover-bg', '--purple-selected']) {
      const ratio = contrastRatio(accent, resolveColor(tokens, surface));
      assert.ok(ratio >= 3, `${palette} state indicator has only ${ratio.toFixed(2)}:1 contrast on ${surface}`);
    }
  }
});

test('interactive palette states use the contrast-safe accent border', () => {
  const selectors = [
    '.button-secondary:hover:not(:disabled)',
    '.choice-selected',
    '.calendar-day time[aria-current="date"]',
    '.calendar-event:hover',
  ];

  for (const selector of selectors) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `Expected a CSS rule for ${selector}`);
    assert.match(rule[1], /(?:border-color|outline):[^;]*var\(--purple-border-strong\)/, `${selector} should use the contrast-safe palette accent`);
  }
});
