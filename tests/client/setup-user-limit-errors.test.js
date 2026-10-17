import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const setupPage = source.slice(source.indexOf('export function SetupPage'), source.indexOf('function BookOpenMark'));

test('setup associates invalid account-limit responses with the account-limit field', () => {
  assert.match(setupPage, /const setupUserLimitErrorId = useId\(\);/);
  assert.match(setupPage, /const setupUserLimitInputRef = useRef<HTMLInputElement>\(null\);/);
  assert.match(setupPage, /cause\.code === 'invalid_user_limit'[\s\S]*setUserLimitError\(cause\.message\)[\s\S]*setupUserLimitInputRef\.current\?\.focus\(\)/);
  assert.match(setupPage, /ref=\{setupUserLimitInputRef\}[^>]*type="number"[^>]*aria-invalid=\{userLimitError \? true : undefined\}[^>]*aria-describedby=\{userLimitError \? setupUserLimitErrorId : undefined\}/);
  assert.match(setupPage, /id=\{setupUserLimitErrorId\} className="form-error" role="alert"\>\{userLimitError\}<\/p>/);
  assert.match(setupPage, /setUserLimit\(event\.target\.value\); setUserLimitError\(''\)/);
  assert.match(setupPage, /setError\(''\); setUserLimitError\(''\); setStep\(1\)/);
});
