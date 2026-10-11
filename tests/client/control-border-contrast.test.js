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
