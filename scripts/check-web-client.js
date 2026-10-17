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
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map((match) => match[1]))];
  if (!/id=["']root["']/.test(html) || !assets.some((asset) => asset.endsWith('.js'))) {
    throw new Error('The application page does not contain the built web client.');
  }
  for (const asset of assets) {
    const response = await request(asset);
    const expectedType = asset.endsWith('.css') ? /text\/css/i : /(?:text|application)\/javascript/i;
    if (!expectedType.test(response.headers.get('content-type') || '')) {
      throw new Error(`${asset} has an invalid content type; the browser cannot load it.`);
    }
    if (!(await response.text()).trim()) throw new Error(`${asset} is empty.`);
  }
  return assets.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const count = await checkWebClient(process.argv[2]);
    console.log(`[openlearning] Web page and ${count} JavaScript/CSS assets passed HTTP checks.`);
  } catch (error) {
    console.error(`[openlearning] Web client check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
