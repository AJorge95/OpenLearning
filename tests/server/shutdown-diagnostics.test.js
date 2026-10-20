import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { trackActiveConnections } from '../../server/shutdown-diagnostics.js';

test('shutdown diagnostics report active requests and connection age without peer details', () => {
  const server = new EventEmitter();
  let now = 1_000;
  const getActiveConnections = trackActiveConnections(server, () => now);
  const socket = new EventEmitter();
  socket.remoteAddress = '192.0.2.20';
  server.emit('connection', socket);

  const response = new EventEmitter();
  server.emit('request', { socket, method: 'POST', url: '/api/private?token=secret' }, response);
  now = 1_600;

  assert.deepEqual(getActiveConnections(), [{ connectionId: 1, ageMs: 600, activeRequests: 1 }]);

  response.emit('close');
  assert.deepEqual(getActiveConnections(), [{ connectionId: 1, ageMs: 600, activeRequests: 0 }]);

  socket.emit('close');
  assert.deepEqual(getActiveConnections(), []);
});

test('shutdown diagnostics count concurrent requests on a keep-alive connection', () => {
  const server = new EventEmitter();
  const getActiveConnections = trackActiveConnections(server, () => 42);
  const socket = new EventEmitter();
  server.emit('connection', socket);
  const firstResponse = new EventEmitter();
  const secondResponse = new EventEmitter();

  server.emit('request', { socket }, firstResponse);
  server.emit('request', { socket }, secondResponse);
  firstResponse.emit('close');

  assert.deepEqual(getActiveConnections(), [{ connectionId: 1, ageMs: 0, activeRequests: 1 }]);
});
