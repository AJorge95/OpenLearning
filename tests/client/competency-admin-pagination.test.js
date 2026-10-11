import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-programs.tsx');

test('competency administration loads bounded pages and provides accessible navigation', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /api\.get<CompetencyAdminPage>\(`\/api\/admin\/competencies\?page=\$\{requestedPage\}`/);
  assert.match(source, /setItems\(result\.competencies\)[\s\S]*?setPage\(result\.page\)[\s\S]*?setPageSize\(result\.pageSize\)[\s\S]*?setTotal\(result\.total\)/);
  assert.match(source, /api\.post<\{ page: number \}>\('\/api\/admin\/competencies'[\s\S]*?await load\(result\.page\)/);
  assert.match(source, /api\.patch<\{ page: number \}>\(`\/api\/admin\/competencies\/\$\{item\.id\}`[\s\S]*?await load\(result\.page\)/);
  assert.match(source, /<CompetencyAdminPagination page=\{page\} pageSize=\{pageSize\} total=\{total\}/);
  assert.match(source, /aria-label="Competency pages"[\s\S]*?role="status" aria-live="polite"[\s\S]*?>Previous[\s\S]*?>Next/);
});
