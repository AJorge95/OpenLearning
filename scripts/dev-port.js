import { createServer } from 'node:net';

const defaultDevPort = 5173;

// Probe the same loopback address that the development server binds.
function canListenOnLoopback(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function chooseDevPort(configuredPort, {
  startPort = defaultDevPort,
  maxPort = 65_535,
  isAvailable = canListenOnLoopback,
} = {}) {
  const requestedPort = typeof configuredPort === 'string' ? configuredPort.trim() : '';
  if (requestedPort) return requestedPort;

  for (let port = startPort; port <= maxPort; port += 1) {
    if (await isAvailable(port)) return String(port);
  }
  throw new Error(`No development port is available between ${startPort} and ${maxPort}. Set PORT to choose a specific port.`);
}
