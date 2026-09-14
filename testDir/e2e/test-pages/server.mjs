import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8080;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };

createServer((req, res) => {
  // Strip the query string before mapping to a file path (e.g. probe pages
  // pass worker URLs via ?worker=...).
  const pathOnly = (req.url || '/').split('?')[0];
  const filePath = join(__dirname, pathOnly === '/' ? 'long-page.html' : pathOnly);
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, () => console.log(`Test server on http://localhost:${PORT}`));
