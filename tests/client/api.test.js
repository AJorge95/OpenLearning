import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, api } from '../../src/api.ts';

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

function installFakeXhr(t, onSend) {
  const originalXhr = globalThis.XMLHttpRequest;
  const requests = [];
  globalThis.XMLHttpRequest = class {
    upload = {};
    requestHeaders = new Map();
    responseContentType = '';
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.requestHeaders.set(name, value); }
    getResponseHeader(name) { return name.toLowerCase() === 'content-type' ? this.responseContentType : null; }
    send(body) {
      this.body = body;
      requests.push(this);
      onSend(this, requests.length);
    }
  };
  t.after(() => {
    if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXhr;
  });
  return requests;
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

test('clearing CSRF state during refresh prevents the old session token from being reused', async (t) => {
  restoreFetch(t);
  const responses = [];
  let csrfRequests = 0;
  globalThis.fetch = async () => {
    csrfRequests += 1;
    const request = new Promise((resolve) => { responses.push(resolve); });
    return request;
  };

  const oldSessionRefresh = api.refreshCsrf();
  api.clearCsrf();
  const newSessionRefresh = api.refreshCsrf();
  const requestsAfterClear = responses.length;

  const responseFor = (token) => jsonResponse({ token });
  responses[0](responseFor('old-session-token'));
  if (responses[1]) responses[1](responseFor('new-session-token'));
  const [oldRefreshResult, newRefreshResult] = await Promise.all([oldSessionRefresh, newSessionRefresh]);

  assert.equal(requestsAfterClear, 2);
  assert.equal(oldRefreshResult, 'new-session-token');
  assert.equal(newRefreshResult, 'new-session-token');
  assert.equal(csrfRequests, 2);
});

test('aborting a caller-owned CSRF refresh leaves later startup retries available', async (t) => {
  restoreFetch(t);
  const signals = [];
  globalThis.fetch = async (input, options = {}) => {
    assert.equal(String(input), '/api/csrf');
    signals.push(options.signal);
    if (signals.length === 1) return new Promise(() => {});
    return jsonResponse({ token: 'retry-token' });
  };

  const controller = new AbortController();
  const pendingRefresh = api.refreshCsrf({ signal: controller.signal });
  controller.abort();

  await assert.rejects(pendingRefresh, (error) => error?.name === 'AbortError');
  assert.equal(signals[0], controller.signal);
  assert.equal(await api.refreshCsrf(), 'retry-token');
  assert.equal(signals.length, 2);
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

test('preserves structured request-body errors from the server', async (t) => {
  restoreFetch(t);
  const failures = [
    { status: 400, code: 'invalid_json', error: 'Request body contains invalid JSON.' },
    { status: 413, code: 'payload_too_large', error: 'Request body is too large.' },
  ];
  let writeRequests = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === '/api/csrf') return jsonResponse({ token: 'request-body-token' });
    const failure = failures[writeRequests++];
    return jsonResponse(failure, failure.status);
  };

  for (const failure of failures) {
    await assert.rejects(api.post('/api/action', { value: 1 }), (error) => (
      error instanceof ApiError
      && error.status === failure.status
      && error.code === failure.code
      && error.message === failure.error
    ));
  }
  assert.equal(writeRequests, failures.length);
});

test('accepts empty 204 responses for delete requests', async (t) => {
  restoreFetch(t);
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const path = String(input);
    if (path === '/api/csrf') return jsonResponse({ token: 'delete-token' });
    requests.push({ path, method: options.method, csrf: new Headers(options.headers).get('X-CSRF-Token') });
    return new Response(null, { status: 204 });
  };

  const result = await api.delete('/api/resource');

  assert.equal(result, undefined);
  assert.deepEqual(requests, [{ path: '/api/resource', method: 'DELETE', csrf: 'delete-token' }]);
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

test('normalizes API connection failures into a stable retryable error', async (t) => {
  restoreFetch(t);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

  await assert.rejects(api.get('/api/data'), (error) => (
    error instanceof ApiError
    && error.status === 0
    && error.code === 'network_error'
    && error.message === 'The server could not be reached. Check your connection and try again.'
  ));
});

test('normalizes connection failures while starting a write session', async (t) => {
  restoreFetch(t);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

  await assert.rejects(api.post('/api/action', { value: 1 }), (error) => (
    error instanceof ApiError && error.status === 0 && error.code === 'network_error'
  ));
});

test('keeps aborted API requests as AbortError', async (t) => {
  restoreFetch(t);
  const abortError = new DOMException('The request was aborted.', 'AbortError');
  globalThis.fetch = async () => { throw abortError; };

  await assert.rejects(api.get('/api/data'), (error) => error === abortError);
});

test('normalizes connection loss while reading an API response', async (t) => {
  restoreFetch(t);
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => { throw new TypeError('Connection closed'); },
  });

  await assert.rejects(api.get('/api/data'), (error) => (
    error instanceof ApiError && error.status === 0 && error.code === 'network_error'
  ));
});

test('reports upload connection loss consistently and warns that completion is uncertain', async (t) => {
  restoreFetch(t);
  const originalXhr = globalThis.XMLHttpRequest;
  let sentBody;
  globalThis.fetch = async () => jsonResponse({ token: 'upload-token' });
  globalThis.XMLHttpRequest = class {
    upload = {};
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) {
      sentBody = body;
      this.onerror?.();
    }
  };
  t.after(() => {
    if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXhr;
  });

  await assert.rejects(api.upload('/api/upload', {}, new Blob(['lesson handout']), () => {}), (error) => (
    error instanceof ApiError
    && error.status === 0
    && error.code === 'network_error'
    && error.message === 'The upload connection was interrupted. Reload the course editor to check whether the file was added before retrying.'
  ));
  assert.ok(sentBody instanceof FormData);
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

test('rejects promptly without multipart creation when cancelled while fetching the CSRF token', async (t) => {
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
  const outcomePromise = upload.then(
    () => ({ fulfilled: true }),
    (error) => ({ fulfilled: false, error }),
  );
  assert.equal(fetchRequests, 1);
  controller.abort();
  let timeoutId;
  const rejectedPromptly = await Promise.race([
    outcomePromise.then(() => true),
    new Promise((resolve) => { timeoutId = setTimeout(() => resolve(false), 50); }),
  ]);
  clearTimeout(timeoutId);
  resolveCsrfResponse(jsonResponse({ token: 'unused-token' }));
  const outcome = await outcomePromise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(rejectedPromptly, true);
  assert.equal(outcome.fulfilled, false);
  assert.equal(outcome.error.name, 'AbortError');
  assert.equal(fetchRequests, 1);
  assert.equal(formDataConstructed, false);
  assert.equal(xhrConstructed, false);
});

test('aborts an active XHR upload and suppresses progress after cancellation', async (t) => {
  restoreFetch(t);
  const originalXhr = globalThis.XMLHttpRequest;
  let xhr;
  globalThis.fetch = async () => jsonResponse({ token: 'active-upload-token' });
  globalThis.XMLHttpRequest = class {
    upload = {};
    sendCalls = 0;
    abortCalls = 0;
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) { this.body = body; this.sendCalls += 1; }
    abort() { this.abortCalls += 1; this.onabort?.(); }
    constructor() { xhr = this; }
  };
  t.after(() => {
    if (originalXhr === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXhr;
  });

  const controller = new AbortController();
  const progress = [];
  const outcomePromise = api.upload('/api/upload', {}, new Blob(['lesson handout']), (value) => progress.push(value), { signal: controller.signal }).then(
    () => ({ fulfilled: true }),
    (error) => ({ fulfilled: false, error }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(xhr);
  assert.equal(xhr.sendCalls, 1);
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/api/upload');
  assert.ok(xhr.body instanceof FormData);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
  assert.deepEqual(progress, [25]);

  controller.abort();
  xhr.upload.onprogress({ lengthComputable: true, loaded: 75, total: 100 });
  const outcome = await outcomePromise;

  assert.equal(xhr.abortCalls, 1);
  assert.equal(outcome.fulfilled, false);
  assert.equal(outcome.error.name, 'AbortError');
  assert.deepEqual(progress, [25]);
});

test('retries a multipart upload once after a CSRF rejection and resets progress', async (t) => {
  restoreFetch(t);
  let csrfRequests = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), '/api/csrf');
    csrfRequests += 1;
    return jsonResponse({ token: csrfRequests === 1 ? 'stale-upload-token' : 'fresh-upload-token' });
  };
  const requests = installFakeXhr(t, (xhr, attempt) => {
    queueMicrotask(() => {
      xhr.upload.onprogress({ lengthComputable: true, loaded: attempt === 1 ? 50 : 25, total: 100 });
      xhr.status = attempt === 1 ? 403 : 201;
      xhr.responseContentType = 'application/json; charset=utf-8';
      xhr.responseText = JSON.stringify(attempt === 1
        ? { code: 'csrf_invalid', error: 'Refresh the page.' }
        : { media: { id: 'media-1' } });
      xhr.onload();
    });
  });
  const progress = [];

  const result = await api.upload(
    '/api/manage/courses/course-1/media',
    { kind: 'video', lessonId: 'lesson-1' },
    new Blob(['video bytes'], { type: 'video/mp4' }),
    (value) => progress.push(value),
  );

  assert.deepEqual(result, { media: { id: 'media-1' } });
  assert.equal(csrfRequests, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((xhr) => xhr.requestHeaders.get('X-CSRF-Token')), [
    'stale-upload-token',
    'fresh-upload-token',
  ]);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/api/manage/courses/course-1/media');
  assert.equal(requests[0].withCredentials, true);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].body.get('kind'), 'video');
  assert.equal(requests[0].body.get('lessonId'), 'lesson-1');
  assert.ok(requests[0].body.get('file') instanceof Blob);
  assert.deepEqual(progress, [50, 0, 25]);
});

test('returns structured upload validation errors without retrying the file', async (t) => {
  restoreFetch(t);
  let csrfRequests = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), '/api/csrf');
    csrfRequests += 1;
    return jsonResponse({ token: 'upload-token' });
  };
  const requests = installFakeXhr(t, (xhr) => {
    queueMicrotask(() => {
      xhr.status = 413;
      xhr.responseContentType = 'application/json';
      xhr.responseText = JSON.stringify({
        code: 'payload_too_large',
        error: 'File exceeds the upload size limit.',
      });
      xhr.onload();
    });
  });

  await assert.rejects(
    api.upload('/api/manage/courses/course-1/media', {}, new Blob(['too large']), () => {}),
    (error) => error instanceof ApiError
      && error.status === 413
      && error.code === 'payload_too_large'
      && error.message === 'File exceeds the upload size limit.',
  );

  assert.equal(csrfRequests, 1);
  assert.equal(requests.length, 1);
});
