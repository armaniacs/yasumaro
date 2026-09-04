/**
 * server.mjs — static server for the e2e benchmark fixtures.
 *
 * Serves bench/fixtures/*.html on port 8110 (BENCH_FIXTURE_PORT). Generated
 * pages are built on the fly from bench/fixtures/_sizes.mjs so the repo carries
 * generators, not multi-hundred-KB HTML blobs.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { newsArticle, spaHeavy, longText } from '../fixtures/_sizes.mjs';

const PORT = 8110;
const __dirname = fileURLToPath(new URL('.', import.meta.url));

function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${bodyHtml}</body></html>`;
}

const ROUTES = {
  '/news': (scale) => pageShell('Bench News', newsArticle(scale)),
  '/spa': (scale) => pageShell('Bench SPA', spaHeavy(scale)),
  '/long': (scale) => pageShell('Bench Long', `<article><p>${longText(scale).replace(/</g, '&lt;')}</p></article>`),
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const scale = Math.max(1, Math.min(64, Number(url.searchParams.get('scale')) || 4));
  const route = ROUTES[url.pathname] ?? ROUTES['/news'];
  const html = route(scale);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}).listen(PORT, () => {
  console.log(`Bench fixture server on http://localhost:${PORT} (dir: ${__dirname})`);
});
