// The initial free-port probe can race; retry the real bind only for auto-selected dev ports.
export function listenWithDevelopmentPortFallback(server, {
  port,
  host,
  enabled = false,
  maxPort = 65_535,
  onFallback = () => {},
}) {
  return new Promise((resolve, reject) => {
    let activePort = port;
    let settled = false;

    function cleanup() {
      server.removeListener('listening', handleListening);
      server.removeListener('error', handleError);
    }

    function handleListening() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(activePort);
    }

    function handleError(error) {
      if (settled) return;
      if (error.code === 'EADDRINUSE' && enabled && activePort < maxPort) {
        const occupiedPort = activePort;
        activePort += 1;
        try {
          onFallback(occupiedPort, activePort);
          server.listen(activePort, host);
        } catch (retryError) {
          handleError(retryError);
        }
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    server.on('listening', handleListening);
    server.on('error', handleError);
    try {
      server.listen(activePort, host);
    } catch (error) {
      handleError(error);
    }
  });
}
