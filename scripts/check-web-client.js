import { pathToFileURL } from 'node:url';

export async function checkWebClient(baseUrl) {
  const base = new URL(baseUrl);
  const request = async (pathname) => {
    const response = await fetch(new URL(pathname, base), {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}.`);
    return response;
  };
  const page = await request('/');
  if (!page.headers.get('content-type')?.includes('text/html')) {
    throw new Error('The application URL did not return an HTML page.');
  }
  if (base.protocol === 'http:' && /(?:^|;)\s*upgrade-insecure-requests\s*(?:;|$)/i.test(page.headers.get('content-security-policy') || '')) {
    throw new Error('The HTTP page forces assets onto HTTPS, which prevents the web client from loading.');
  }
  const html = await page.text();
  // Production Vite HTML references same-origin, hashed JavaScript/CSS chunks.
  const assets = new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map((match) => match[1]));
  if (!/id=["']root["']/.test(html) || ![...assets].some((asset) => asset.endsWith('.js'))) {
    throw new Error('The application page does not contain the built web client.');
  }

  // Check lazy page bundles and nested CSS imports as well as HTML entry assets.
  const pendingAssets = [...assets];
  const checkedAssets = new Set();
  while (pendingAssets.length > 0) {
    const asset = pendingAssets.pop();
    if (checkedAssets.has(asset)) continue;
    checkedAssets.add(asset);

    const response = await request(asset);
    const assetPath = new URL(asset, base).pathname;
    const isStylesheet = assetPath.endsWith('.css');
    const expectedType = isStylesheet ? /text\/css/i : /(?:text|application)\/javascript/i;
    if (!expectedType.test(response.headers.get('content-type') || '')) {
      throw new Error(`${asset} has an invalid content type; the browser cannot load it.`);
    }
    const body = await response.text();
    if (!body.trim()) throw new Error(`${asset} is empty.`);

    const references = new Set([...body.matchAll(/["']((?:\/assets\/|assets\/|\.{1,2}\/)[^"'?#\s]+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map((match) => match[1]));
    if (isStylesheet) {
      for (const match of body.matchAll(/url\(\s*["']?((?:\/assets\/|assets\/|\.{1,2}\/)[^)"'\s]+\.(?:js|css)(?:\?[^)"'\s]*)?)["']?\s*\)/gi)) {
        references.add(match[1]);
      }
    }
    for (const reference of references) {
      const dependency = reference.startsWith('assets/')
        ? new URL(`/${reference}`, base)
        : new URL(reference, new URL(asset, base));
      if (dependency.origin !== base.origin || !dependency.pathname.startsWith('/assets/')) continue;
      if (/\.(?:js|css)$/i.test(dependency.pathname)) {
        pendingAssets.push(`${dependency.pathname}${dependency.search}`);
      }
    }
  }
  return checkedAssets.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    // Fail with the command contract before URL parsing produces a misleading error.
    console.error('[openlearning] Usage: node scripts/check-web-client.js <base-url>');
    process.exitCode = 2;
  } else {
    try {
      const count = await checkWebClient(baseUrl);
      console.log(`[openlearning] Web page and ${count} JavaScript/CSS assets passed HTTP checks.`);
    } catch (error) {
      console.error(`[openlearning] Web client check failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
