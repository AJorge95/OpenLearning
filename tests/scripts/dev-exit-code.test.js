import assert from 'node:assert/strict';
import test from 'node:test';
import { devChildExitCode } from '../../scripts/dev-exit-code.js';

test('dev runner preserves conventional statuses for requested shutdown signals', () => {
  assert.equal(devChildExitCode(null, 'SIGINT'), 130);
  assert.equal(devChildExitCode(null, 'SIGTERM'), 143);
});

test('dev runner preserves ordinary child exit codes and treats unexpected signals as failures', () => {
  assert.equal(devChildExitCode(0, null), 0);
  assert.equal(devChildExitCode(17, null), 17);
  assert.equal(devChildExitCode(null, 'SIGKILL'), 1);
  assert.equal(devChildExitCode(null, null), 1);
});
