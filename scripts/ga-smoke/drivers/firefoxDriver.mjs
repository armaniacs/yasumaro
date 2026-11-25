/**
 * firefoxDriver.mjs — Real Firefox Developer Edition driver via WebDriver BiDi
 * (`puppeteer-core` + `browser.installExtension`).
 *
 * Unlike Playwright's Juggler Firefox (which locks release-channel signature
 * enforcement — see PBI 2026-09-14-10), official WebDriver BiDi supports
 * `webExtension.install` directly against real Firefox Developer Edition,
 * loading the exact unpacked `dist/yasumaro-<ver>-firefox.zip` artifact into a
 * brand-new empty profile.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { resolveBrowserExecutable } from '../buildAndVerifyArtifacts.mjs';
import { wrapPuppeteerPage } from './pageAdapter.mjs';

const GECKO_ADDON_ID = 'yasumaro@armaniacs.github.io';

/** Read the assigned moz-extension UUID from Firefox's prefs.js if rewritten. */
function readExtensionUuidFromPrefs(profileDir, addonId = GECKO_ADDON_ID) {
  const prefsPath = path.join(profileDir, 'prefs.js');
  if (!existsSync(prefsPath)) return null;
  const content = readFileSync(prefsPath, 'utf-8');
  const escapedId = addonId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${escapedId}\\\\"\\s*:\\s*\\\\"([0-9a-f-]+)\\\\"`, 'i'));
  return match?.[1] ?? null;
}

/**
 * Launch a fresh Firefox Developer Edition profile via WebDriver BiDi with the
 * unpacked distribution ZIP installed as an add-on.
 */
export async function launchFirefoxSmokeSession({
  unpackedDir,
  locale,
  ignoreTlsErrors = false,
  profileDir: existingProfileDir,
}) {
  const executablePath = resolveBrowserExecutable('firefox');
  if (!executablePath) {
    throw new Error(
      'Firefox Developer Edition / Firefox executable not found. Install Firefox Developer Edition or set GA_SMOKE_FIREFOX_BIN.',
    );
  }

  const ownsProfile = !existingProfileDir;
  const profileDir =
    existingProfileDir ??
    path.join(os.tmpdir(), `yasumaro-ga-smoke-firefox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const downloadsDir = path.join(profileDir, 'smoke-downloads');
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });

  const seededUuid = randomUUID();
  const mozAppData = path.join(
    os.tmpdir(),
    `yasumaro-ga-smoke-firefox-appdata-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(mozAppData, { recursive: true });

  const extraPrefsFirefox = {
    'xpinstall.signatures.required': false,
    'extensions.autoDisableScopes': 0,
    'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ADDON_ID]: seededUuid }),
    'browser.shell.checkDefaultBrowser': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'browser.download.folderList': 2,
    'browser.download.dir': downloadsDir,
    'browser.download.useDownloadDir': true,
    'browser.helperApps.neverAsk.saveToDisk': 'text/markdown,text/plain,application/json,application/octet-stream',
    ...(locale ? { 'intl.locale.requested': locale } : {}),
  };

  const browser = await puppeteer.launch({
    browser: 'firefox',
    protocol: 'webDriverBiDi',
    executablePath,
    userDataDir: profileDir,
    headless: false,
    acceptInsecureCerts: ignoreTlsErrors,
    extraPrefsFirefox,
    env: {
      ...process.env,
      MOZ_APP_DATA: mozAppData,
      // Firefox 153+ WebDriver BiDi gates moz-extension:// navigation on
      // RemoteAgent.allowSystemAccess (MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1).
      MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1',
    },
  });

  const consoleWarnings = [];
  const trackPage = (p) => {
    p.on('console', (msg) => {
      const t = msg.type();
      if (t === 'warn' || t === 'warning' || t === 'error') {
        consoleWarnings.push(`[page ${t}] ${msg.text()}`);
      }
    });
    p.on('pageerror', (err) => {
      consoleWarnings.push(`[pageerror] ${err.message}`);
    });
  };

  try {
    await browser.installExtension(unpackedDir);
  } catch (err) {
    await browser.close().catch(() => undefined);
    if (ownsProfile) rmSync(profileDir, { recursive: true, force: true });
    throw new Error(`Firefox WebDriver BiDi installExtension failed: ${err.message}`);
  }

  // Wait briefly for prefs.js / extension startup, then determine effective UUID.
  await new Promise((r) => setTimeout(r, 800));
  const resolvedUuid = readExtensionUuidFromPrefs(profileDir) ?? seededUuid;
  const extensionOrigin = `moz-extension://${resolvedUuid}`;
  const browserVersion = await browser.version().catch(() => 'unknown');

  return {
    browserName: 'firefox',
    browserVersion,
    extensionId: resolvedUuid,
    extensionOrigin,
    profileDir,
    downloadsDir,
    consoleWarnings,
    browser,
    async openExtensionPage(relativePath) {
      const p = await browser.newPage();
      trackPage(p);
      const page = wrapPuppeteerPage(p);
      await page.goto(`${extensionOrigin}/${relativePath.replace(/^\//, '')}`);
      return page;
    },
    async openPage(url) {
      const p = await browser.newPage();
      trackPage(p);
      const page = wrapPuppeteerPage(p);
      await page.goto(url);
      return page;
    },
    async close({ keepProfile = false } = {}) {
      await browser.close().catch(() => undefined);
      rmSync(mozAppData, { recursive: true, force: true });
      if (ownsProfile && !keepProfile) {
        rmSync(profileDir, { recursive: true, force: true });
      }
    },
  };
}
