import { performance } from 'node:perf_hooks';

export function trackActiveConnections(server, now = () => performance.now()) {
  const connections = new Map();
  let nextConnectionId = 0;

  server.on('connection', (socket) => {
    const connection = {
      connectionId: ++nextConnectionId,
      openedAt: now(),
      activeRequests: 0,
    };
    connections.set(socket, connection);
    socket.once('close', () => connections.delete(socket));
  });

  server.on('request', (request, response) => {
    const connection = connections.get(request.socket);
    if (!connection) return;
    connection.activeRequests += 1;
    response.once('close', () => {
      connection.activeRequests = Math.max(0, connection.activeRequests - 1);
    });
  });

  return () => [...connections.values()].map((connection) => ({
    connectionId: connection.connectionId,
    ageMs: Math.max(0, Math.round(now() - connection.openedAt)),
    activeRequests: connection.activeRequests,
  }));
}
