import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import dotenv from 'dotenv';
import { chooseDevPort, readDevPortArgument } from '../../scripts/dev-port.js';

test('development command reads a port from either supported CLI form', () => {
  assert.equal(readDevPortArgument(['--port', '7443']), '7443');
  assert.equal(readDevPortArgument(['--port=7444']), '7444');
  assert.equal(readDevPortArgument(['--host', '127.0.0.1']), '');
});

test('development command reports a missing CLI port value', () => {
  assert.throws(() => readDevPortArgument(['--port']), /Use --port <number>/);
  assert.throws(() => readDevPortArgument(['--port', '--host']), /Use --port <number>/);
  assert.throws(() => readDevPortArgument(['--port=']), /Use --port <number>/);
});

test('dev port selection preserves an explicitly configured port', async () => {
  let probed = false;
  const selectedPort = await chooseDevPort('7443', {
    isAvailable: async () => { probed = true; return false; },
  });

  assert.equal(selectedPort, '7443');
  assert.equal(probed, false);
});

test('dev port selection skips occupied defaults and chooses the first available port', async () => {
  const checkedPorts = [];
  const selectedPort = await chooseDevPort('', {
    startPort: 5173,
    maxPort: 5175,
    isAvailable: async (port) => {
      checkedPorts.push(port);
      return port === 5175;
    },
  });

  assert.equal(selectedPort, '5175');
  assert.deepEqual(checkedPorts, [5173, 5174, 5175]);
});

test('dev port selection explains when its search range is exhausted', async () => {
  await assert.rejects(
    () => chooseDevPort(undefined, { startPort: 5173, maxPort: 5174, isAvailable: async () => false }),
    /No development port is available between 5173 and 5174\. Set PORT to choose a specific port\./,
  );
});

test('example environment leaves PORT unset so development can use its occupied-port fallback', () => {
  const sampleEnvironment = dotenv.parse(fs.readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));

  assert.equal(sampleEnvironment.PORT, undefined);
});
