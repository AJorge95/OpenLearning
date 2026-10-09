import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCookieProtocolMiddleware } from './session-cookie.js';

function applyPolicy(middleware) {
  const request = { session: { cookie: { secure: null } } };
  let nextCalled = false;
  middleware(request, {}, () => { nextCalled = true; });
  return { secure: request.session.cookie.secure, nextCalled };
}

test('session cookie protocol follows the saved setting on each request', () => {
  let protocol = 'http';
  const settingReads = [];
  const middleware = createSessionCookieProtocolMiddleware((key) => {
    settingReads.push(key);
    return protocol;
  }, 'development');

  assert.deepEqual(applyPolicy(middleware), { secure: false, nextCalled: true });
  protocol = 'https';
  assert.deepEqual(applyPolicy(middleware), { secure: true, nextCalled: true });
  protocol = 'http';
  assert.deepEqual(applyPolicy(middleware), { secure: false, nextCalled: true });
  assert.deepEqual(settingReads, ['connection_protocol', 'connection_protocol', 'connection_protocol']);
});

test('session cookie protocol falls back to the environment when unset or invalid', () => {
  let protocol;
  const setting = () => protocol;
  const development = createSessionCookieProtocolMiddleware(setting, 'development');
  const production = createSessionCookieProtocolMiddleware(setting, 'production');

  assert.equal(applyPolicy(development).secure, false);
  assert.equal(applyPolicy(production).secure, true);
  protocol = 'invalid';
  assert.equal(applyPolicy(development).secure, false);
  assert.equal(applyPolicy(production).secure, true);
});
