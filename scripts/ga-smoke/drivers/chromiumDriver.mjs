/**
 * chromiumDriver.mjs — Real Google Chrome & Microsoft Edge driver for GA Smoke.
 *
 * - Branded Chrome 137+ removed `--load-extension`, so Chrome uses
 *   `ignoreDefaultArgs: ['--disable-extensions']`, `--enable-unsafe-extension-debugging`,
 *   and browser-level CDP `Extensions.loadUnpacked` (verified on Chrome 158).
 * - Branded Edge supports `--load-extension` directly on `channel: 'msedge'`
 *   (verified on Edge 158), with automatic fallback to CDP `Extensions.loadUnpacked`.
 * - Every session launches a brand-new empty `userDataDir` (never seeded) and
 *   routes downloads into an isolated temp directory via `Browser.setDownloadBehavior`.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wrapPlaywrightPage } from './pageAdapter.mjs';

const SW_WAIT_TIMEOUT_MS = 15_000;

async function waitForServiceWorker(context, timeoutMs = SW_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sws = context.serviceWorkers();
    if (sws.length > 0) return sws[0];
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/**
 * Launch a fresh Chrome or Edge profile with the unpacked distribution ZIP loaded.
 */
export async function launchChromiumSmokeSession({
  browserName,
  unpackedDir,
  locale,
  ignoreTlsErrors = false,
  profileDir: existingProfileDir,
}) {
  const channel = browserName === 'edge' ? 'msedge' : 'chrome';
  const ownsProfile = !existingProfileDir;
  const profileDir =
    existingProfileDir ??
    path.join(os.tmpdir(), `yasumaro-ga-smoke-${browserName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const downloadsDir = path.join(profileDir, 'smoke-downloads');
  mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });

  // Pre-configure browser download folder into our isolated temp directory so
  // chrome.downloads writes deterministic, inspectable files without touching ~/Downloads.
  writeFileSync(
    path.join(profileDir, 'Default', 'Preferences'),
    JSON.stringify({
      download: {
        default_directory: downloadsDir,
        prompt_for_download: false,
        directory_upgrade: true,
      },
      savefile: { default_directory: downloadsDir },
    }),
  );

  const useCdpLoad = browserName === 'chrome';
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    ...(useCdpLoad
      ? ['--enable-unsafe-extension-debugging']
      : [`--disable-extensions-except=${unpackedDir}`, `--load-extension=${unpackedDir}`]),
    ...(ignoreTlsErrors ? ['--ignore-certificate-errors'] : []),
    ...(locale ? [`--lang=${locale}`] : []),
  ];

  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless: false,
    ...(useCdpLoad ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}),
    ...(locale ? { locale } : {}),
    args,
    serviceWorkers: 'allow',
    acceptDownloads: true,
    downloadsPath: downloadsDir,
  });

  const consoleWarnings = [];
  const trackPage = (pwPage) => {
    pwPage.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(`[page ${msg.type()}] ${msg.text()}`);
      }
    });
    pwPage.on('pageerror', (err) => {
      consoleWarnings.push(`[pageerror] ${err.message}`);
    });
  };
  for (const p of context.pages()) trackPage(p);
  context.on('page', trackPage);

  const browser = context.browser();
  const browserVersion = browser?.version() ?? 'unknown';
  let extensionId = '';

  const cdp = browser ? await browser.newBrowserCDPSession() : null;
  if (cdp) {
    try {
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadsDir,
        eventsEnabled: true,
      });
    } catch {
      // Preferences fallback already covers download path.
    }
  }

  if (useCdpLoad) {
    if (!cdp) {
      await context.close().catch(() => undefined);
      throw new Error('Browser CDP session unavailable for Chrome Extensions.loadUnpacked');
    }
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: unpackedDir });
    extensionId = loaded?.id ?? '';
    if (!extensionId) {
      await context.close().catch(() => undefined);
      throw new Error('Extensions.loadUnpacked did not return an extension ID');
    }
    // Wake the MV3 service worker by navigating a throwaway tab to options or checking SWs.
    const sw = await waitForServiceWorker(context, 4000);
    if (!sw) {
      const wakePage = await context.newPage();
      await wakePage.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
      await waitForServiceWorker(context, SW_WAIT_TIMEOUT_MS);
      await wakePage.close();
    }
  } else {
    const sw = await waitForServiceWorker(context, SW_WAIT_TIMEOUT_MS);
    if (!sw) {
      await context.close().catch(() => undefined);
      throw new Error(`${browserName} extension service worker did not register within ${SW_WAIT_TIMEOUT_MS}ms`);
    }
    extensionId = sw.url().split('/')[2] ?? '';
  }

  // Attach SW console listener if available
  for (const sw of context.serviceWorkers()) {
    sw.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(`[sw ${msg.type()}] ${msg.text()}`);
      }
    });
  }
  context.on('serviceworker', (sw) => {
    sw.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleWarnings.push(`[sw ${msg.type()}] ${msg.text()}`);
      }
    });
  });

  const extensionOrigin = `chrome-extension://${extensionId}`;

  return {
    browserName,
    browserVersion,
    extensionId,
    extensionOrigin,
    profileDir,
    downloadsDir,
    consoleWarnings,
    context,
    async openExtensionPage(relativePath) {
      const pwPage = await context.newPage();
      const page = wrapPlaywrightPage(pwPage);
      await page.goto(`${extensionOrigin}/${relativePath.replace(/^\//, '')}`);
      await pwPage.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined', {
        timeout: 15_000,
      });
      return page;
    },
    async openPage(url) {
      const pwPage = await context.newPage();
      const page = wrapPlaywrightPage(pwPage);
      await page.goto(url);
      return page;
    },
    async close({ keepProfile = false } = {}) {
      await context.close().catch(() => undefined);
      if (ownsProfile && !keepProfile) {
        rmSync(profileDir, { recursive: true, force: true });
      }
    },
  };
}
