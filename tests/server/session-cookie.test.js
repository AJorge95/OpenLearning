import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCookieProtocolMiddleware } from '../../server/session-cookie.js';

test('stored session cookie security follows the current request as a boolean', () => {
  const middleware = createSessionCookieProtocolMiddleware();
  for (const secure of [false, true, false]) {
    const request = { secure, session: { cookie: { secure: 'auto' } } };
    let nextCalled = false;
    middleware(request, {}, () => { nextCalled = true; });
    assert.equal(request.session.cookie.secure, secure);
    assert.equal(nextCalled, true);
  }
});
