import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AI_PROVIDER_HOST_PERMISSIONS,
  OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS,
  buildConnectSrcDomains,
  buildLocalHostPermissions,
  buildLocalConnectSrc,
  validateCspDomains,
} from './src/utils/cspDomains.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

// Chrome's manifest "version" only allows 1-4 dot-separated integers, while
// package.json carries a development marker on main (e.g. "6.9.0-dev").
// Strip the prerelease suffix so the shipped manifest stays loadable and
// Chrome Web Store-compatible; the -dev notation lives in package.json and
// docs/version.json only.
const manifestVersion = pkg.version.replace(/-[0-9A-Za-z.-]+$/, '');

const localConnectSrc = buildLocalConnectSrc();
const aiConnectSrc = buildConnectSrcDomains();
validateCspDomains([...localConnectSrc, ...aiConnectSrc]);

// Stable Gecko add-on ID (email-style, anchored to the org's GitHub Pages
// domain) — required for profile-based installs and reliable extension
// storage on Firefox. 'offscreen' / 'favicon' permissions are also dropped on
// Firefox (unknown-permission warnings; see the manifest fn below).
const GECKO_ADDON_ID = 'yasumaro@armaniacs.github.io';

// WHY: The unlisted opfs-worker entry and the Firefox background build as
// single-file lib bundles, which makes rolldown inline every `new URL()`
// asset fallback inside the emscripten glue as its own data: URI. The glue
// has ~7 fallback sites per glue, so each referenced binary is embedded up
// to 7 times (~20MB of base64 across firefox opfs-worker.js +
// background.js — most of the firefox zip's 10MB). Every runtime path
// passes locateFile (chromium: the bundled asset URL, firefox: the INIT
// override to the public wasm asset), and under the extension CSP
// (connect-src 'self') a data: wasm fetch always fails with NetworkError —
// so the inlined payloads are unreachable dead weight. Strip them at render
// time: a stripped fallback fails exactly like the CSP-blocked data: fetch
// it replaces. Chromium builds emit real asset files (assetsInlineLimit: 0
// above) and need no stripping.
function stripInlinedWasmPlugins(browser: string) {
  if (browser !== 'firefox') return [];
  return [
    {
      name: 'yasumaro-strip-inlined-wasm-data-uri',
      enforce: 'post' as const,
      renderChunk(code: string) {
        if (!code.includes('data:application/wasm;base64,')) return null;
        return code.replace(
          /data:application\/wasm;base64,[A-Za-z0-9+/=]{4096,}/g,
          'data:application/wasm;base64,',
        );
      },
    },
  ];
}

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
  vite: (env) => ({
    define: {
      __PROTOCOL_VERSION__: JSON.stringify(1),
      // Benchmark A/B flag for src/content/loader.ts. Only bench builds
      // (OW_BENCH=1) contain the page-controllable localStorage kill-switch;
      // production builds get `false` so the check is dead-code eliminated.
      // Untrusted page content must never control extension behavior.
      __OW_BENCH__: JSON.stringify(process.env.OW_BENCH === '1'),
    },
    plugins: stripInlinedWasmPlugins(env.browser),
    build: {
      modulePreload: false,
      // Never inline assets as data: URLs. The OPFS worker (used by both the
      // offscreen document and the Firefox event page) fetches its wasm
      // binary at runtime, and the extension CSP (connect-src 'self') blocks
      // data: fetches — an inlined wasm dies with NetworkError (verified on
      // Firefox, background event page console). Emitted files stay same-
      // origin fetchable and compress better in the store zip.
      assetsInlineLimit: 0,
    },
    // ESM workers: the OPFS worker is created with { type: 'module' } and the
    // Firefox background bundle includes the same worker graph via a dynamic
    // import — IIFE workers are rejected for code-splitting builds.
    worker: {
      format: 'es',
    },
  }),

  // The background builds as an IIFE library; the Firefox in-page offscreen
  // host (PBI 2026-09-14-09) pulls the storage engine's nested dynamic
  // imports into its graph, which makes rolldown demand code-splitting —
  // incompatible with IIFE. Inline every dynamic import into background.js
  // instead (existing lazy chunks were already inlined by lib-iife mode).
  hooks: {
    'vite:build:extendConfig'(entrypoints, config) {
      const group = Array.isArray(entrypoints) ? entrypoints : [entrypoints];
      const isBackground = group.some((e) => e.type === 'background');
      if (!isBackground) return;
      config.build ??= {};
      const rollup = (config.build.rollupOptions ??= {}) as {
        output?: { codeSplitting?: boolean; inlineDynamicImports?: boolean };
      };
      rollup.output ??= {};
      // rolldown option: single-file IIFE build with all dynamic imports inlined
      rollup.output.codeSplitting = false;
    },
    'build:publicAssets'(wxt, files) {
      // Firefox-only: copy the @subframe7536 async wasm to a stable public
      // path. This is the exact binary the production OPFS/IDB engines
      // fetch (dist asset wa-sqlite-async-ac_ajG-V.wasm). The unlisted
      // opfs-worker entry builds in lib mode, which inlines its `new URL()`
      // assets as data: URLs — unusable under the extension CSP
      // (connect-src 'self' blocks data: fetches with NetworkError). The
      // event page points the engine at this file via INIT (see
      // setSqliteWasmUrlOverride). Glue and wasm must come from the same
      // build family (a wa-sqlite-build binary aborts with "indirect call
      // to null" under this glue).
      if (wxt.config.browser === 'firefox') {
        files.push({
          absoluteSrc: resolve(wxt.config.root, 'node_modules/@subframe7536/sqlite-wasm/dist/wa-sqlite-async.wasm'),
          relativeDest: 'wasm/wa-sqlite-async.wasm',
        });
      }
      // Both browsers: copy the PII sanitizer and TextRank wasm binaries to
      // stable public paths. The background entrypoint builds as a
      // single-file IIFE bundle (codeSplitting: false below), which makes
      // Vite inline `new URL(..., import.meta.url)` wasm references as
      // `data:` URIs instead of emitting a separate fetchable asset — the
      // extension CSP blocks `data:` fetches, so the WASM modules failed to
      // initialize in every build (not just Firefox) until this was fixed.
      // See src/wasm/pii-sanitizer/index.ts's module doc for the full story.
      files.push({
        absoluteSrc: resolve(wxt.config.root, 'public/wasm/pii_sanitizer_bg.wasm'),
        relativeDest: 'wasm/pii_sanitizer_bg.wasm',
      });
      files.push({
        absoluteSrc: resolve(wxt.config.root, 'public/wasm/textrank_bg.wasm'),
        relativeDest: 'wasm/textrank_bg.wasm',
      });
    },
  },

  manifest: (env) => ({
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionShortName__',
    version: manifestVersion,
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    homepage_url: 'https://github.com/armaniacs/yasumaro',
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    // Firefox: gecko id + drop the Chromium-only permissions.
    ...(env.browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: GECKO_ADDON_ID } } }
      : {}),
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      ...(env.browser === 'firefox' ? [] : ['offscreen', 'favicon']),
      'notifications',
      'webRequest',
      'declarativeNetRequest',
      'alarms',
      'contextMenus',
      'downloads',
    ],
    // <all_urls> は optional_host_permissions に含めない（最小権限）。
    // ホスト単位の追加許可は実行時に chrome.permissions.request({ origins }) で
    // 対象オリジンのみを都度要求する。
    optional_host_permissions: [...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS],
    host_permissions: [...buildLocalHostPermissions(), ...AI_PROVIDER_HOST_PERMISSIONS],
    content_security_policy: {
      // wasm-unsafe-eval is required by:
      //   - @subframe7536/sqlite-wasm (wa-sqlite) in the offscreen document
      //     (OPFS/IDB storage) — offscreen sqliteEngine.ts + opfsWorker.ts
      //   - the PII sanitizer core (src/wasm/pii-sanitizer/) in the service
      //     worker, via src/background/pipeline/piiSanitizeHybrid.ts
      //   - the TextRank extraction core (src/wasm/textrank/) in the
      //     service worker, via src/utils/sentenceExtractorHybrid.ts
      // Verified via `grep -rn "sqlite-wasm\|WebAssembly\|pii-sanitizer\|textrank" src/`.
      // If all WASM usage is removed, this token can be dropped. Keep
      // minimal otherwise.
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
  }),
});
