import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
  buildConnectSrcDomains,
  buildLocalHostPermissions,
  buildLocalConnectSrc,
  validateCspDomains,
} from './src/utils/cspDomains.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

const localConnectSrc = buildLocalConnectSrc();
const aiConnectSrc = buildConnectSrcDomains();
validateCspDomains([...localConnectSrc, ...aiConnectSrc]);

export default defineConfig({
  outDir: 'dist',
  browser: 'chromium',
  manifestVersion: 3,

  // Chrome MV3 extension pages report modulepreload <link> tags as
  // "cross-world extension resource mismatch" warnings in the errors
  // console. The scripts still load fine via the entry's own <script
  // type="module">; disabling modulePreload only drops the (negligible,
  // same-origin) preload hint and removes the console noise.
  // WHY: wxt@0.21.4 + vite@8.1.5 reproduces the warning; re-verify by
  // removing `modulePreload: false`, running `npm run build`, loading the
  // extension in Chrome and checking chrome://extensions Errors + SW console
  // for "cross-world" messages. Re-check on wxt/vite major bumps.
  // TODO(re-verify): remove this flag and test when wxt or vite is bumped
  // (see PBI 2026-08-23-12, RICE 6.25 — no user impact, dev-only noise).
  vite: () => ({
    build: {
      modulePreload: false,
    },
  }),

  manifest: {
    manifest_version: 3,
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionShortName__',
    version: pkg.version,
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    homepage_url: 'https://github.com/armaniacs/yasumaro',
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      'offscreen',
      'notifications',
      'webRequest',
      'alarms',
      'favicon',
      'contextMenus',
      'downloads',
    ],
    optional_host_permissions: [...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS],
    host_permissions: [...buildLocalHostPermissions(), ...AI_PROVIDER_HOST_PERMISSIONS],
    content_security_policy: {
      // wasm-unsafe-eval is required by @subframe7536/sqlite-wasm (wa-sqlite)
      // used in the offscreen document for OPFS/IDB storage. Verified via
      // `grep -rn "sqlite-wasm\|WebAssembly" src/offscreen` — offscreen
      // sqliteEngine.ts + opfsWorker.ts. If WASM is removed, this token can
      // be dropped. Keep minimal otherwise.
      extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' ${localConnectSrc.join(' ')} ${aiConnectSrc.join(' ')}; style-src 'self'; img-src 'self' chrome-extension: data:; default-src 'none';`,
    },
    web_accessible_resources: [
      {
        // Only resources actually fetched from the Content Script's page
        // context (src/content/*.ts) belong here. content-scripts/content.js
        // itself is injected via manifest.json's content_scripts and needs
        // no separate web_accessible_resources entry. Everything else
        // (chunks/*.js, assets/*.js, data/models-dev-openai-compatible.json,
        // PRIVACY.md, permissions.html, assets/permissions-*.css) is only
        // ever fetched from extension pages (popup/dashboard/permissions),
        // which can already access chrome-extension:// resources without a
        // web_accessible_resources declaration.
        // icon48.png is required: src/content/extractor.ts injects
        // `<img src="${chrome.runtime.getURL('icons/icon48.png')}">` into
        // the page DOM, which needs WAR. matches is intentionally
        // http://*/* + https://*/* because the content script runs on all
        // http(s) pages per manifest content_scripts.
        resources: [
          'content-extractor.js',
          'icons/icon48.png',
        ],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
  },
});
