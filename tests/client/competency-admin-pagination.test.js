import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-programs.tsx');

test('competency administration loads bounded pages and provides accessible navigation', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /api\.get<CompetencyAdminPage>\(`\/api\/admin\/competencies\?\$\{params\}`/);
  assert.match(source, /setItems\(result\.competencies\)[\s\S]*?setPage\(result\.page\)[\s\S]*?setPageSize\(result\.pageSize\)[\s\S]*?setTotal\(result\.total\)/);
  assert.match(source, /api\.post<\{ page: number \}>\('\/api\/admin\/competencies'[\s\S]*?await load\(result\.page, ''\)/);
  assert.match(source, /api\.patch<\{ page: number \}>\(`\/api\/admin\/competencies\/\$\{item\.id\}\$\{queryString\}`[\s\S]*?await load\(result\.page, appliedQuery\)/);
  assert.match(source, /<CompetencyAdminPagination page=\{page\} pageSize=\{pageSize\} total=\{total\} busy=\{loading \|\| saving \|\| savingId !== null\}/);
  assert.match(source, /aria-label="Competency pages"[\s\S]*?role="status" aria-live="polite"[\s\S]*?>Previous[\s\S]*?>Next/);
});

test('competency paging is disabled while create or status updates are pending', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /function CompetencyAdminPagination\(\{ page, pageSize, total, busy, onChange \}/);
  assert.match(source, /disabled=\{busy \|\| page <= 1\} onClick=\{\(\) => onChange\(page - 1\)\}>Previous/);
  assert.match(source, /disabled=\{busy \|\| page >= pageCount\} onClick=\{\(\) => onChange\(page \+ 1\)\}>Next/);
});
