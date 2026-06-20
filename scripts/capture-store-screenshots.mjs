/**
 * Capture Chrome Web Store screenshots for Yasumaro extension.
 *
 * Serves the built dist/chromium-mv3 directory over HTTP to avoid CORS issues
 * when opening popup/options pages directly, mocks the chrome.* APIs the UI
 * requires using real English i18n messages, and saves 1280x800 PNG screenshots.
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist', 'chromium-mv3');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'store-assets', 'screenshots');
const MESSAGES_PATH = path.join(PROJECT_ROOT, 'public', '_locales', 'en', 'messages.json');

const VIEWPORT = { width: 1280, height: 800 };

function loadI18nMessages() {
  const raw = fs.readFileSync(MESSAGES_PATH, 'utf-8');
  return JSON.parse(raw);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.ico': 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}

function startStaticServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/popup.html';
      const filePath = path.join(root, urlPath);

      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': getContentType(filePath) });
        res.end(data);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`Static server running at http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mockChromeApisInitScript(messages) {
  // This function is serialized and executed in the page before any other scripts.
  const noop = () => {};

  const storageListeners = [];
  const storageData = {
    privacyConsent: { accepted: true, timestamp: Date.now() },
    settings_migrated: true,
    obsidian_api_key: 'yasumaro-example-key-0000',
    obsidian_protocol: 'https',
    obsidian_port: '27124',
    obsidian_enabled: true,
    obsidian_daily_path: '092.Daily',
    ai_provider: 'gemini',
    gemini_api_key: 'fake-gemini-api-key-for-screenshot',
    gemini_model: 'gemini-1.5-flash',
  };

  const storageArea = {
    get: (keys) => {
      if (keys === null || keys === undefined) {
        return Promise.resolve({ ...storageData });
      }
      let result = {};
      if (typeof keys === 'string') {
        result[keys] = storageData[keys];
      } else if (Array.isArray(keys)) {
        for (const key of keys) {
          if (key in storageData) result[key] = storageData[key];
        }
      } else if (typeof keys === 'object') {
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = key in storageData ? storageData[key] : defaultValue;
        }
      }
      return Promise.resolve(result);
    },
    set: (items) => {
      Object.assign(storageData, items);
      return Promise.resolve();
    },
    remove: (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) delete storageData[key];
      return Promise.resolve();
    },
    clear: () => {
      for (const key of Object.keys(storageData)) delete storageData[key];
      return Promise.resolve();
    },
    getBytesInUse: () => Promise.resolve(0),
    onChanged: {
      addListener: (fn) => storageListeners.push(fn),
      removeListener: (fn) => {
        const idx = storageListeners.indexOf(fn);
        if (idx >= 0) storageListeners.splice(idx, 1);
      },
    },
  };

  const sessionStorageArea = {
    data: {},
    get: (keys) => {
      if (keys === null || keys === undefined) return Promise.resolve({ ...sessionStorageArea.data });
      const result = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) {
        if (key in sessionStorageArea.data) result[key] = sessionStorageArea.data[key];
      }
      return Promise.resolve(result);
    },
    set: (items) => {
      Object.assign(sessionStorageArea.data, items);
      return Promise.resolve();
    },
    remove: (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) delete sessionStorageArea.data[key];
      return Promise.resolve();
    },
    clear: () => {
      sessionStorageArea.data = {};
      return Promise.resolve();
    },
  };

  const tabsApi = {
    query: () => Promise.resolve([{ id: 1, url: 'https://example.com/article', title: 'Example Article' }]),
    create: (props, callback) => {
      if (callback) callback({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false });
      return Promise.resolve({ id: 999, index: 0, highlighted: false, active: false, pinned: false, incognito: false });
    },
    get: () => Promise.resolve({ id: 1, url: 'https://example.com/article', title: 'Example Article' }),
    update: () => Promise.resolve({}),
    onActivated: { addListener: noop, removeListener: noop },
    onUpdated: { addListener: noop, removeListener: noop },
  };

  // Sample browsing history records for the SQLite history screenshot.
  const sampleHistoryEntries = [
    {
      id: 1,
      url: 'https://example.com/sqlite-fts5',
      title: 'Getting Started with SQLite FTS5',
      summary: 'A guide to full-text search in SQLite.',
      tags: 'sqlite,search',
      created_at: Date.now() - 86400000,
      domain: 'example.com',
      visit_duration: 125,
      scroll_ratio: 0.78,
      is_starred: 1,
      obsidian_synced: 1,
    },
    {
      id: 2,
      url: 'https://developer.chrome.com/docs/extensions/develop/concepts/service-workers',
      title: 'Service Workers - Chrome for Developers',
      summary: 'Architecture summary of Chrome Extension service workers.',
      tags: 'chrome,extension',
      created_at: Date.now() - 172800000,
      domain: 'developer.chrome.com',
      visit_duration: 210,
      scroll_ratio: 0.62,
      is_starred: 0,
      obsidian_synced: 0,
    },
    {
      id: 3,
      url: 'https://obsidian.md/publish',
      title: 'Obsidian Publish',
      summary: 'Turn your notes into a personal knowledge base website.',
      tags: 'obsidian,notes',
      created_at: Date.now() - 259200000,
      domain: 'obsidian.md',
      visit_duration: 95,
      scroll_ratio: 0.48,
      is_starred: 0,
      obsidian_synced: 1,
    },
  ];

  const runtimeApi = {
    id: 'yasumaro-screenshot-mock',
    getURL: (p) => `http://127.0.0.1:9999${p}`,
    getManifest: () => ({
      name: 'Yasumaro',
      version: '6.1.0',
      manifest_version: 3,
      permissions: ['storage', 'activeTab'],
    }),
    sendMessage: (message, callback) => {
      const response = { success: true, message: 'Mock response' };
      if (message?.type === 'TEST_CONNECTION') {
        response.success = true;
        response.message = 'Test connection successful';
      } else if (message?.type === 'TEST_OBSIDIAN') {
        response.success = true;
        response.message = 'Obsidian connection successful';
      } else if (message?.type === 'TEST_AI') {
        response.success = true;
        response.message = 'AI connection successful';
      } else if (message?.type === 'DASHBOARD_SQLITE') {
        response.success = true;
        const payload = message?.payload || {};
        if (payload.subtype === 'query' || payload.subtype === 'search') {
          response.rows = sampleHistoryEntries;
          response.total = sampleHistoryEntries.length;
        } else if (payload.subtype === 'get_count') {
          response.count = sampleHistoryEntries.length;
        } else if (payload.subtype === 'status') {
          response.initialized = true;
          response.path = ':memory:';
          response.fallback = false;
          response.fts5 = true;
        } else if (payload.subtype === 'confirm_token') {
          response.confirmToken = 'screenshot-mock-token';
        }
      } else if (message?.type === 'GET_SQLITE_HISTORY') {
        response.success = true;
        response.entries = sampleHistoryEntries;
      } else if (message?.type === 'PING') {
        response.success = true;
      }
      if (callback) callback(response);
      return Promise.resolve(response);
    },
    onMessage: { addListener: noop, removeListener: noop },
    lastError: null,
  };

  const permissionsApi = {
    request: () => Promise.resolve(true),
    contains: () => Promise.resolve(true),
    remove: () => Promise.resolve(true),
  };

  const notificationsApi = {
    create: (opts, callback) => {
      if (callback) callback('notification-id');
      return 'notification-id';
    },
  };

  // Implement chrome.i18n.getMessage using real English messages.
  function getMessage(key, substitutions) {
    const entry = messages[key];
    if (!entry || !entry.message) {
      return key;
    }

    let message = entry.message;
    const subs = Array.isArray(substitutions) ? substitutions : [];
    const placeholders = entry.placeholders || {};

    // Replace named placeholders ($NAME$) with their content definitions.
    for (const [name, def] of Object.entries(placeholders)) {
      let content = typeof def === 'string' ? def : (def?.content ?? `$${name.toUpperCase()}$`);
      // Substitute $1, $2, etc. inside the placeholder content.
      content = content.replace(/\$(\d+)\$/g, (m, n) => subs[parseInt(n, 10) - 1] ?? m);
      content = content.replace(/\$(\d+)/g, (m, n) => subs[parseInt(n, 10) - 1] ?? m);
      const pattern = new RegExp(`\\$${name.toUpperCase()}\\$`, 'g');
      message = message.replace(pattern, content);
    }

    // Replace any remaining $1, $2, ... placeholders in the message text.
    message = message.replace(/\$(\d+)\$/g, (m, n) => subs[parseInt(n, 10) - 1] ?? m);
    message = message.replace(/\$(\d+)/g, (m, n) => subs[parseInt(n, 10) - 1] ?? m);

    return message;
  }

  const i18nApi = {
    getMessage,
    getUILanguage: () => 'en',
    getAcceptLanguages: () => Promise.resolve(['en']),
  };

  window.chrome = {
    ...(window.chrome || {}),
    storage: {
      local: storageArea,
      session: sessionStorageArea,
      sync: storageArea,
      onChanged: storageArea.onChanged,
      managed: storageArea,
    },
    tabs: tabsApi,
    runtime: runtimeApi,
    permissions: permissionsApi,
    notifications: notificationsApi,
    i18n: i18nApi,
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve(),
      setIcon: () => Promise.resolve(),
    },
  };

  // Prevent popup from closing in this context
  window.close = noop;
}

async function capturePopup(page, baseUrl, colorScheme, outputName) {
  // Capture the popup at a higher device scale for a crisp presentation image.
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await page.goto(`${baseUrl}/popup.html`);

  // Wait for the main screen to be visible
  await page.locator('#mainScreen').waitFor({ state: 'visible', timeout: 15000 });

  // Try to dismiss the privacy consent modal if shown
  const consentModal = page.locator('#privacyConsentModal');
  if (await consentModal.isVisible().catch(() => false)) {
    await page.locator('#consentCheckbox').check();
    await page.locator('#acceptConsentBtn').click();
    await consentModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  await sleep(800);

  // Screenshot the popup body element (360px wide) so we can present it centered.
  const popupBuffer = await page.locator('body').screenshot();
  const popupDataUrl = `data:image/png;base64,${popupBuffer.toString('base64')}`;

  // Create a 1280x800 presentation page that centers the popup with a branded background.
  const presentationPage = await page.context().newPage();
  await presentationPage.setViewportSize(VIEWPORT);

  const isDark = colorScheme === 'dark';
  const bgGradient = isDark
    ? 'radial-gradient(circle at 50% 30%, #1a1a24 0%, #0e0e12 70%)'
    : 'radial-gradient(circle at 50% 30%, #ede7d9 0%, #f5f0e8 70%)';
  const frameShadow = isDark
    ? '0 32px 64px -12px rgba(0,0,0,0.6)'
    : '0 32px 64px -12px rgba(0,0,0,0.18)';

  await presentationPage.setContent(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            width: ${VIEWPORT.width}px;
            height: ${VIEWPORT.height}px;
            overflow: hidden;
          }
          body {
            display: flex;
            align-items: center;
            justify-content: center;
            background: ${bgGradient};
          }
          .popup-frame {
            max-width: 720px;
            max-height: 720px;
            width: auto;
            height: auto;
            border-radius: 16px;
            box-shadow: ${frameShadow};
            overflow: hidden;
          }
          .popup-frame img {
            display: block;
            max-width: 100%;
            max-height: 720px;
            width: auto;
            height: auto;
          }
        </style>
      </head>
      <body>
        <div class="popup-frame">
          <img src="${popupDataUrl}" alt="Yasumaro popup">
        </div>
      </body>
    </html>
  `);

  await sleep(300);
  await presentationPage.screenshot({ path: path.join(OUTPUT_DIR, outputName) });
  await presentationPage.close();
}

async function dismissModals(page) {
  const modalSelectors = [
    '#breakingChangesModal .modal-close',
    '#breakingChangesModal #breakingChangesAcknowledgeBtn',
    '#breakingChangesModal #breakingChangesConfirmBtn',
    '#breakingChangesModal button[data-i18n="close"]',
    '#breakingChangesModal button:last-child',
    '#onboardingWizard .wizard-finish',
    '#privacyConsentModal #acceptConsentBtn',
  ];
  for (const selector of modalSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      await sleep(300);
    }
  }
}

async function captureDashboardPanel(page, baseUrl, panelId, outputName, colorScheme = 'light') {
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${baseUrl}/options.html`);

  await page.locator('#dashboardLayout').waitFor({ state: 'visible', timeout: 15000 });
  await dismissModals(page);

  // Click the sidebar button for the requested panel (use JS click to bypass modals)
  const navButton = page.locator(`#sidebar .sidebar-nav-btn[data-panel="${panelId}"]`);
  if (await navButton.isVisible().catch(() => false)) {
    await page.evaluate((id) => {
      const btn = document.querySelector(`#sidebar .sidebar-nav-btn[data-panel="${id}"]`);
      if (btn) btn.click();
    }, panelId);
    await sleep(500);
  }

  await dismissModals(page);

  // Ensure requested panel is active and visible
  const panel = page.locator(`#${panelId}`);
  await panel.waitFor({ state: 'visible', timeout: 10000 });

  // For the settings screenshot, ensure sensitive fields display a clean masked
  // indicator and realistic values are visible.
  if (outputName === 'dashboard-settings.png') {
    await page.evaluate(() => {
      const apiKey = document.getElementById('apiKey');
      if (apiKey) {
        apiKey.value = 'yasumaro-example-key-0000';
      }
    });
  }

  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, outputName), fullPage: false });
}

async function main() {
  if (!fs.existsSync(DIST_PATH)) {
    throw new Error(`Extension not built: ${DIST_PATH} does not exist. Run npm run build first.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const messages = loadI18nMessages();

  const port = 9999;
  const server = await startStaticServer(DIST_PATH, port);
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.addInitScript(mockChromeApisInitScript, messages);

    const page = await context.newPage();

    // Popup light mode
    await capturePopup(page, baseUrl, 'light', 'popup-light.png');
    console.log('Captured popup-light.png');

    // Popup dark mode
    await capturePopup(page, baseUrl, 'dark', 'popup-dark.png');
    console.log('Captured popup-dark.png');

    // Dashboard history panel (SQLite History)
    await captureDashboardPanel(page, baseUrl, 'panel-sqlite-history', 'dashboard-history.png', 'light');
    console.log('Captured dashboard-history.png');

    // Dashboard settings panel (General)
    await captureDashboardPanel(page, baseUrl, 'panel-general', 'dashboard-settings.png', 'light');
    console.log('Captured dashboard-settings.png');

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

export { mockChromeApisInitScript, dismissModals };

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
