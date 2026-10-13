import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('catalog action buttons hide icons that duplicate their accessible labels', () => {
  assert.match(source, /className="clear-catalog-filters"[^>]*onClick=\{clearCatalogFilters\}><FilterX size=\{17\} aria-hidden="true" \/>/);
  assert.match(source, /<button type="submit" aria-label="Submit search"><ArrowRight size=\{17\} aria-hidden="true" \/>/);
});

test('the catalog reset icon is distinct from the native search-field clear affordance', () => {
  assert.match(source, /import \{[^\n]*\bFilterX\b[^\n]*\} from 'lucide-react'/);
});
