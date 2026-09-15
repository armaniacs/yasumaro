import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, normalize, sep, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8080;
// testDir/e2e/test-pages -> repo root, for serving dist/ artifacts.
const ROOT_DIR = join(__dirname, '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

createServer((req, res) => {
  // Strip the query string before mapping to a file path (e.g. probe pages
  // pass worker URLs via ?worker=...).
  const pathOnly = (req.url || '/').split('?')[0];
  let filePath;
  if (pathOnly.startsWith('/dist/')) {
    // Serve the built extension under /dist/* so smoke tests can drive real
    // dist artifacts (built workers, wasm) from the same origin. Constrained
    // to the dist directory (no directory traversal).
    const resolved = normalize(join(ROOT_DIR, pathOnly.slice(1)));
    if (!resolved.startsWith(join(ROOT_DIR, 'dist') + sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }
    filePath = resolved;
  } else {
    filePath = join(__dirname, pathOnly === '/' ? 'long-page.html' : pathOnly);
  }
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, () => console.log(`Test server on http://localhost:${PORT}`));
