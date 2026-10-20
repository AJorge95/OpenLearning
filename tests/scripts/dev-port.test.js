import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDevPort } from '../../scripts/dev-port.js';

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
