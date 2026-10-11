import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ApiError } from '../../src/api.ts';
import { isRegistrationAvailabilityError } from '../../src/registration-availability.ts';

test('recognizes only registration-closed server responses as availability changes', () => {
  assert.equal(isRegistrationAvailabilityError(new ApiError(403, 'Registration is disabled.', 'registration_disabled')), true);
  assert.equal(isRegistrationAvailabilityError(new ApiError(403, 'The user limit has been reached.', 'user_limit_reached')), true);
  assert.equal(isRegistrationAvailabilityError(new ApiError(403, 'Not allowed.', 'forbidden')), false);
  assert.equal(isRegistrationAvailabilityError(new ApiError(400, 'Invalid request.', 'user_limit_reached')), false);
  assert.equal(isRegistrationAvailabilityError(new TypeError('Failed to fetch')), false);
});

test('sign-up refreshes platform status before returning an availability error', () => {
  const source = fs.readFileSync(new URL('../../src/auth-context.tsx', import.meta.url), 'utf8');
  const signUpStart = source.indexOf('const signUp = useCallback(');
  const signUpEnd = source.indexOf('const completeSetup = useCallback(', signUpStart);
  const signUp = source.slice(signUpStart, signUpEnd);

  assert.notEqual(signUpStart, -1);
  assert.notEqual(signUpEnd, -1);
  assert.match(signUp, /isRegistrationAvailabilityError\(cause\)/);
  assert.match(signUp, /await refresh\(\)/);
  assert.match(signUp, /throw cause/);
  assert.match(signUp, /\}, \[refresh\]\);/);
});
