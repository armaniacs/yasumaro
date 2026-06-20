/**
 * Capture Chrome Web Store screenshots for Yasumaro extension.
 *
 * Serves the built dist/chromium-mv3 directory over HTTP to avoid CORS issues
 * when opening popup/options pages directly, mocks the chrome.* APIs the UI
 * requires, and saves 1280x800 PNG screenshots.
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

const VIEWPORT = { width: 1280, height: 800 };

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

function mockChromeApisInitScript() {
  // This function is serialized and executed in the page before any other scripts.
  const noop = () => {};

  const storageListeners = [];
  const storageData = {
    privacyConsent: { accepted: true, timestamp: Date.now() },
    settings_migrated: true,
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
        response.entries = [];
      } else if (message?.type === 'GET_SQLITE_HISTORY') {
        response.success = true;
        response.entries = [];
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

  const i18nApi = {
    getMessage: (key, substitutions) => {
      // Return the key as a readable fallback so labels remain visible
      return key;
    },
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
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize(VIEWPORT);
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
  await page.screenshot({ path: path.join(OUTPUT_DIR, outputName), fullPage: false });
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

  await sleep(800);
  await page.screenshot({ path: path.join(OUTPUT_DIR, outputName), fullPage: false });
}

async function main() {
  if (!fs.existsSync(DIST_PATH)) {
    throw new Error(`Extension not built: ${DIST_PATH} does not exist. Run npm run build first.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const port = 9999;
  const server = await startStaticServer(DIST_PATH, port);
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.addInitScript(mockChromeApisInitScript);

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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
