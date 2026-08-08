import { defineConfig } from 'wxt';
import { AI_PROVIDER_HOST_PERMISSIONS, OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS, buildConnectSrcDomains } from './src/utils/cspDomains.js';

export default defineConfig({
  outDir: 'dist',
  browser: 'chromium',
  manifestVersion: 3,

  // Chrome MV3 extension pages report modulepreload <link> tags as
  // "cross-world extension resource mismatch" warnings in the errors
  // console. The scripts still load fine via the entry's own <script
  // type="module">; disabling modulePreload only drops the (negligible,
  // same-origin) preload hint and removes the console noise.
  vite: () => ({
    build: {
      modulePreload: false,
    },
  }),

  manifest: {
    manifest_version: 3,
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionShortName__',
    version: '6.7.23',
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
    host_permissions: [
      'http://127.0.0.1:27123/*',
      'https://127.0.0.1:27123/*',
      'http://localhost:27123/*',
      'https://localhost:27123/*',
      'http://127.0.0.1:27124/*',
      'https://127.0.0.1:27124/*',
      'http://localhost:27124/*',
      'https://localhost:27124/*',
      'http://127.0.0.1:11434/*',
      'https://127.0.0.1:11434/*',
      'http://localhost:11434/*',
      'https://localhost:11434/*',
      'http://127.0.0.1:1234/*',
      'https://127.0.0.1:1234/*',
      'http://localhost:1234/*',
      'https://localhost:1234/*',
      ...AI_PROVIDER_HOST_PERMISSIONS,
    ],
    content_security_policy: {
      extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:* ${buildConnectSrcDomains().join(' ')}; style-src 'self'; img-src 'self' chrome-extension: data:; default-src 'none';`,
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
        resources: [
          'content-extractor.js',
          'icons/icon48.png',
        ],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
  },
});
