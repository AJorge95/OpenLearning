import helmet from 'helmet';

export function createSecurityHeaders(nodeEnv) {
  return helmet({
    contentSecurityPolicy: nodeEnv === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        // The course editor decodes a selected cover through a local object URL before upload.
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        // Native installations serve HTTP until a TLS proxy is configured.
        // Same-origin HTTPS pages already request their assets over HTTPS.
        upgradeInsecureRequests: null,
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  });
}
