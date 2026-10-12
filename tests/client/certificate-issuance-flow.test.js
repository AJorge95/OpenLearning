import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const learnerPageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-learner.tsx'), 'utf8');
const certificatePageStart = learnerPageSource.indexOf('export function CourseCertificatePage()');
const certificatePageEnd = learnerPageSource.indexOf('export function CourseOverviewPage()', certificatePageStart);
const certificatePageSource = learnerPageSource.slice(certificatePageStart, certificatePageEnd);

test('certificate lookup stays a GET and creation waits for an explicit issue action', () => {
  assert.match(certificatePageSource, /api\.get<\{ certificate: CourseCertificate \}>\(`\/api\/certificates\/\$\{certificateRef\}`/);
  assert.match(certificatePageSource, /cause\.code === 'certificate_not_issued'/);
  assert.match(certificatePageSource, /api\.post<\{ certificate: CourseCertificate \}>\(`\/api\/certificates\/\$\{certificateRef\}\/issue`/);
  assert.match(certificatePageSource, /Your certificate is ready to issue\./);
  assert.match(certificatePageSource, /onClick=\{\(\) => void issueCertificate\(\)\}/);
  assert.match(certificatePageSource, /issuing \? 'Issuing certificate…' : 'Issue certificate'/);
});
