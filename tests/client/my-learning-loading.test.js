import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-learner.tsx'), 'utf8');

test('My Learning loads courses and certificates independently with a first-page certificate retry', () => {
  assert.match(pageSource, /api\.get<CourseListResponse>\('\/api\/my-learning\?page=1&includeCertificates=0'/);
  assert.match(pageSource, /api\.get<CertificateListResponse>\('\/api\/my-learning\/certificates\?page=1'/);
  assert.match(pageSource, /void loadCertificatesFirstPage\(\);/);
  assert.match(pageSource, /Your certificates could not be loaded\./);
  assert.match(pageSource, /\{loadingCertificates && <p className="page-loading" role="status" aria-live="polite">Loading certificates…<\/p>\}/);
  assert.match(pageSource, /certificateError && <ErrorNotice message=\{certificateError\} onRetry=\{certificatesHasMore && certificates\.length > 0 \? loadMoreCertificates : loadCertificatesFirstPage\}/);
  assert.match(pageSource, /const hasEmptyCourses = !loading && !error && courses\.length === 0/);
  assert.match(pageSource, /hasEmptyCourses && !loadingCertificates && !certificateError && certificates\.length === 0/);
});

test('My Learning waits for certificate history before showing its combined empty state', () => {
  assert.match(pageSource, /: hasEmptyCourses && !loadingCertificates && !certificates\.length && <EmptyState/);
});
