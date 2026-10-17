import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const componentsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/components.tsx');

test('platform brand fallback stays decorative beside the platform name', () => {
  const source = fs.readFileSync(componentsPath, 'utf8');

  assert.match(source, /<ImageWithFallback src=\{platformIcon\} className="brand-icon" alt="" fallback=\{<span className="brand-icon brand-icon-fallback" aria-hidden="true"><BookOpen size=\{18\} \/><\/span>\} \/>/);
  assert.match(source, /<span className="brand-name">\{platformName\}<\/span>/);
});
