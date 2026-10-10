import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, api } from './api.ts';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function restoreFetch(t) {
  const originalFetch = globalThis.fetch;
  api.clearCsrf();
  t.after(() => {
    globalThis.fetch = originalFetch;
    api.clearCsrf();
  });
}

test('coalesces CSRF refreshes and retries concurrent writes once with the fresh token', async (t) => {
  restoreFetch(t);
  let csrfRequests = 0;
  const writeTokens = [];
  const writeAttempts = new Map();
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input);
    if (path === '/api/csrf') {
      csrfRequests += 1;
      return jsonResponse({ token: csrfRequests === 1 ? 'initial-token' : 'fresh-token' });
    }

    const attempt = (writeAttempts.get(path) || 0) + 1;
    writeAttempts.set(path, attempt);
    const token = new Headers(options.headers).get('X-CSRF-Token');
    writeTokens.push(token);
    if (token === 'initial-token') return jsonResponse({ code: 'csrf_invalid', error: 'Refresh the page.' }, 403);
    return jsonResponse({ path, saved: true });
  };

  const results = await Promise.all([
    api.post('/api/first', { value: 1 }),
    api.post('/api/second', { value: 2 }),
  ]);

  assert.deepEqual(results, [
    { path: '/api/first', saved: true },
    { path: '/api/second', saved: true },
  ]);
  assert.equal(csrfRequests, 2);
  assert.deepEqual([...writeAttempts.values()], [2, 2]);
  assert.deepEqual(writeTokens.sort(), ['fresh-token', 'fresh-token', 'initial-token', 'initial-token']);
});

test('returns a repeated CSRF rejection after one retry instead of looping', async (t) => {
  restoreFetch(t);
  let csrfRequests = 0;
  let writeRequests = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === '/api/csrf') {
      csrfRequests += 1;
      return jsonResponse({ token: `token-${csrfRequests}` });
    }
    writeRequests += 1;
    return jsonResponse({ code: 'csrf_invalid', error: 'Refresh the page.' }, 403);
  };

  await assert.rejects(api.post('/api/action', { value: 1 }), (error) => (
    error instanceof ApiError && error.status === 403 && error.code === 'csrf_invalid'
  ));
  assert.equal(csrfRequests, 2);
  assert.equal(writeRequests, 2);
});

test('reports a stable invalid-response error for non-JSON API responses', async (t) => {
  restoreFetch(t);
  globalThis.fetch = async () => new Response('<html>Not an API response</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

  await assert.rejects(api.get('/api/data'), (error) => (
    error instanceof ApiError && error.status === 200 && error.code === 'invalid_response'
  ));
});

test('does not construct or send an upload when its signal is already aborted', async (t) => {
  restoreFetch(t);
  const originalFormData = globalThis.FormData;
  const originalXhr = globalThis.XMLHttpRequest;
  let fetchRequests = 0;
  let formDataConstructed = false;
  let xhrConstructed = false;
  globalThis.fetch = async () => {
    fetchRequests += 1;
    return jsonResponse({ token: 'unused-token' });
  };
  globalThis.FormData = class {
    constructor() { formDataConstructed = true; }
    append() {}
  };
  globalThis.XMLHttpRequest = class {
    constructor() { xhrConstructed = true; }
  };
  t.after(() => {
    globalThis.FormData = originalFormData;
    if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXhr;
  });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.upload('/api/upload', {}, new Blob(['test']), () => {}, { signal: controller.signal }), (error) => (
    error.name === 'AbortError'
  ));
  assert.equal(fetchRequests, 0);
  assert.equal(formDataConstructed, false);
  assert.equal(xhrConstructed, false);
});

test('does not construct a multipart body if cancelled while fetching the CSRF token', async (t) => {
  restoreFetch(t);
  const originalFormData = globalThis.FormData;
  const originalXhr = globalThis.XMLHttpRequest;
  let resolveCsrfResponse;
  let fetchRequests = 0;
  let formDataConstructed = false;
  let xhrConstructed = false;
  const csrfResponse = new Promise((resolve) => { resolveCsrfResponse = resolve; });
  globalThis.fetch = async () => {
    fetchRequests += 1;
    return csrfResponse;
  };
  globalThis.FormData = class {
    constructor() { formDataConstructed = true; }
    append() {}
  };
  globalThis.XMLHttpRequest = class {
    constructor() { xhrConstructed = true; }
  };
  t.after(() => {
    globalThis.FormData = originalFormData;
    if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXhr;
  });

  const controller = new AbortController();
  const upload = api.upload('/api/upload', {}, new Blob(['test']), () => {}, { signal: controller.signal });
  assert.equal(fetchRequests, 1);
  controller.abort();
  resolveCsrfResponse(jsonResponse({ token: 'unused-token' }));

  await assert.rejects(upload, (error) => error.name === 'AbortError');
  assert.equal(fetchRequests, 1);
  assert.equal(formDataConstructed, false);
  assert.equal(xhrConstructed, false);
});
