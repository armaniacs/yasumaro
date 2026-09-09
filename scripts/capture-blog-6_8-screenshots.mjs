/**
 * Capture dashboard screenshots for the blog-6_8 note article.
 *
 * Reuses the chrome.* API mock and static-server setup from
 * capture-store-screenshots.mjs. Serves dist/chromium-mv3 over HTTP, opens the
 * options page with Japanese i18n messages, and saves one trimmed PNG per
 * feature panel into dev-docs/blogs/blog-6_8/note/images/.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { mockChromeApisInitScript, dismissModals } from './capture-store-screenshots.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'chromium-mv3');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'dev-docs', 'blogs', 'blog-6_8', 'note', 'images');
const MESSAGES_PATH = path.join(PROJECT_ROOT, 'public', '_locales', 'ja', 'messages.json');

const VIEWPORT = { width: 1120, height: 1000 };
// note recommends >=1280px wide images. The dashboard content column is narrower
// than that, so we render at 2x device scale: the clipped PNGs come out at
// roughly twice the CSS pixel size, comfortably past 1280px and crisp.
const DEVICE_SCALE = 2;

// One entry per screenshot. `anchor` is the deepest element that still contains
// the point of the shot; the capture is clipped from the panel's top-left to the
// bottom of `anchor` so trailing empty panel space is cropped out.
const SHOTS = [
  { panel: 'panel-general', name: '01-ai-provider.png', start: '#aiProviderSection', anchor: '#aiProviderPriority1Model' },
  { panel: 'panel-ai-summary-cleansing', name: '02-cleansing.png', start: '#cleansing-preset', anchor: '#aiSummaryCleansingFieldset' },
  { panel: 'panel-archive', name: '03-archive.png', start: null, anchor: '#archive-status' },
  { panel: 'panel-diagnostics', name: '04-diagnostics.png', start: null, anchor: '#diagStorageStats' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}

function startStaticServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      let urlPath = decodeURIComponent(url.pathname);
      if (urlPath === '/') urlPath = '/options.html';
      const requestedPath = path.resolve(root, urlPath.slice(1));
      if (!requestedPath.startsWith(root + path.sep) && requestedPath !== root) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(requestedPath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': getContentType(requestedPath) });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// Runs in-page after the base mock. Overrides the stored AI provider so the
// General panel renders the Built-in AI provider UI.
function overrideProviderInitScript() {
  const orig = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = (keys) =>
    orig(keys).then((result) => {
      const wants = (k) =>
        keys === null || keys === undefined || keys === k ||
        (Array.isArray(keys) && keys.includes(k)) ||
        (typeof keys === 'object' && k in keys);
      if (wants('ai_provider')) result.ai_provider = 'built-in-ai';
      if (wants('cleansing_preset')) result.cleansing_preset = 'balanced';
      return result;
    });
}

async function capture(page, baseUrl, { panel, name, start, anchor }) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${baseUrl}/options.html`);
  await page.locator('#dashboardLayout').waitFor({ state: 'visible', timeout: 15000 });
  await dismissModals(page);

  await page.evaluate((id) => {
    const btn = document.querySelector(`#sidebar .sidebar-nav-btn[data-panel="${id}"]`);
    if (btn) btn.click();
  }, panel);
  await sleep(700);
  await dismissModals(page);

  const panelEl = page.locator(`#${panel}`);
  await panelEl.waitFor({ state: 'visible', timeout: 10000 });
  await sleep(400);

  // Scroll so the shot's start element sits near the top of the viewport, then
  // clip from there down to the bottom of the anchor.
  await page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : null;
    if (el) el.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, start);
  await sleep(300);

  const clip = await page.evaluate(({ panelId, startSel, anchorSel }) => {
    const p = document.getElementById(panelId);
    const pr = p.getBoundingClientRect();
    const s = startSel ? document.querySelector(startSel) : null;
    const a = document.querySelector(anchorSel);
    const ar = a ? a.getBoundingClientRect() : pr;
    const startTop = s ? s.getBoundingClientRect().top - 16 : pr.top;
    const top = Math.max(0, startTop);
    const bottom = Math.min(window.innerHeight, ar.bottom + 24);
    return {
      x: Math.max(0, pr.left - 8),
      y: top,
      width: Math.min(window.innerWidth, pr.width + 16),
      height: Math.max(80, bottom - top),
    };
  }, { panelId: panel, startSel: start, anchorSel: anchor });

  await page.screenshot({ path: path.join(OUTPUT_DIR, name), clip });
  console.log(`Captured ${name} (${Math.round(clip.height)}px)`);
}

// note's eyecatch area renders at 1280x670. deviceScaleFactor doubles that.
async function captureEyecatch(context) {
  const iconPath = path.join(DIST_PATH, 'icons', 'icon128.png');
  const iconDataUri = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 670 });
  await page.setContent(`
    <!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><style>
      * { box-sizing: border-box; margin: 0; }
      html, body { width: 1280px; height: 670px; overflow: hidden; }
      body {
        display: flex; flex-direction: column; justify-content: center;
        padding: 0 96px;
        font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
        background:
          radial-gradient(circle at 82% 18%, rgba(124,58,237,0.35) 0%, transparent 45%),
          radial-gradient(circle at 12% 92%, rgba(201,168,76,0.22) 0%, transparent 45%),
          #14141c;
        color: #f4f4f5;
      }
      .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; }
      .brand img { width: 48px; height: 48px; border-radius: 11px; }
      .brand span { font-size: 27px; font-weight: 600; letter-spacing: 0.02em; }
      .catch {
        font-size: 30px; font-weight: 600; color: #c9a84c;
        letter-spacing: 0.01em; margin-bottom: 18px;
      }
      h1 { font-size: 58px; font-weight: 800; line-height: 1.28; letter-spacing: 0.01em; }
      h1 em { color: #c9a84c; font-style: normal; }
      .sub { margin-top: 28px; font-size: 25px; color: #b9b9c3; font-weight: 500; }
      .ver {
        position: absolute; right: 96px; bottom: 60px;
        font-size: 21px; color: #7c3aed; font-weight: 700; letter-spacing: 0.06em;
      }
    </style></head><body>
      <div class="brand"><img src="${iconDataUri}" alt=""><span>Yasumaro</span></div>
      <div class="catch">読んだページを、AIが要約して自動で残す。</div>
      <h1>半年ぶりに触る人へ<br><em>v6.8</em> までに増えた4つの便利</h1>
      <div class="sub">APIキー不要のAI要約 / クレンジング強化 / アーカイブ / 接続テスト</div>
      <div class="ver">CHROME &amp; EDGE EXTENSION</div>
    </body></html>
  `);
  await sleep(300);
  await page.screenshot({ path: path.join(OUTPUT_DIR, '00-eyecatch.png') });
  console.log('Captured 00-eyecatch.png');
  await page.close();
}

async function main() {
  if (!fs.existsSync(DIST_PATH)) {
    throw new Error(`Extension not built: ${DIST_PATH}. Run npm run build first.`);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const messages = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf-8'));
  const server = await startStaticServer(DIST_PATH);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
    await context.addInitScript(mockChromeApisInitScript, { messages, baseUrl });
    await context.addInitScript(overrideProviderInitScript);
    // `--eyecatch-only` regenerates just the cover image.
    const eyecatchOnly = process.argv.includes('--eyecatch-only');
    if (!eyecatchOnly) {
      const page = await context.newPage();
      for (const shot of SHOTS) {
        await capture(page, baseUrl, shot);
      }
    }
    await captureEyecatch(context);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
