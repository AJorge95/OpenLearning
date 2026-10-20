import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { listenWithDevelopmentPortFallback } from '../../server/development-port-fallback.js';

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('development bind retries occupied ports until concurrent servers get unique ports', async () => {
  const blocker = createServer();
  await listen(blocker, 0);
  const blockedPort = blocker.address().port;
  const servers = Array.from({ length: 8 }, () => createServer());
  const fallbackEvents = [];

  try {
    const selectedPorts = await Promise.all(servers.map((server) => listenWithDevelopmentPortFallback(server, {
      port: blockedPort,
      host: '127.0.0.1',
      enabled: true,
      maxPort: blockedPort + 20,
      onFallback: (occupiedPort, nextPort) => fallbackEvents.push([occupiedPort, nextPort]),
    })));

    assert.equal(new Set(selectedPorts).size, servers.length);
    assert.ok(selectedPorts.every((port) => port > blockedPort));
    assert.ok(fallbackEvents.length >= servers.length);
    assert.deepEqual(servers.map((server) => server.address().port), selectedPorts);
  } finally {
    await Promise.all([...servers, blocker].map(close));
  }
});

test('an explicit development port remains pinned when it is occupied', async () => {
  const blocker = createServer();
  await listen(blocker, 0);
  const blockedPort = blocker.address().port;
  const server = createServer();
  const fallbackEvents = [];

  try {
    await assert.rejects(
      listenWithDevelopmentPortFallback(server, {
        port: blockedPort,
        host: '127.0.0.1',
        enabled: false,
        onFallback: (...ports) => fallbackEvents.push(ports),
      }),
      (error) => error.code === 'EADDRINUSE',
    );
    assert.deepEqual(fallbackEvents, []);
  } finally {
    await Promise.all([server, blocker].map(close));
  }
});
