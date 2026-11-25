/**
 * pageAdapter.mjs — Thin cross-driver page adapter shared by Playwright
 * (Chrome/Edge) and Puppeteer WebDriver BiDi (Firefox) so all 10 GA smoke
 * flows execute identical assertions across every browser.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Wrap a Playwright Page into the unified SmokePage interface. */
export function wrapPlaywrightPage(page) {
  return {
    raw: page,
    driver: 'playwright',
    async goto(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    },
    async reload() {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    },
    async title() {
      return page.title();
    },
    url() {
      return page.url();
    },
    async waitForSelector(selector, opts = {}) {
      const state = opts.hidden ? 'hidden' : opts.visible === false ? 'attached' : 'visible';
      await page.locator(selector).first().waitFor({
        state,
        timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
      });
    },
    async isVisible(selector) {
      try {
        return await page.locator(selector).first().isVisible();
      } catch {
        return false;
      }
    },
    async click(selector, opts = {}) {
      await page.locator(selector).first().click({ timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS });
    },
    async fill(selector, value) {
      await page.locator(selector).first().fill(String(value), { timeout: DEFAULT_TIMEOUT_MS });
    },
    async check(selector, checked = true) {
      const loc = page.locator(selector).first();
      if (checked) {
        await loc.check({ timeout: DEFAULT_TIMEOUT_MS });
      } else {
        await loc.uncheck({ timeout: DEFAULT_TIMEOUT_MS });
      }
    },
    async selectOption(selector, value) {
      await page.locator(selector).first().selectOption(value, { timeout: DEFAULT_TIMEOUT_MS });
    },
    async getValue(selector) {
      return page.locator(selector).first().inputValue({ timeout: DEFAULT_TIMEOUT_MS });
    },
    async getText(selector) {
      return (await page.locator(selector).first().textContent({ timeout: DEFAULT_TIMEOUT_MS })) ?? '';
    },
    async getAttribute(selector, attr) {
      return page.locator(selector).first().getAttribute(attr, { timeout: DEFAULT_TIMEOUT_MS });
    },
    async setInputFiles(selector, files) {
      await page.locator(selector).first().setInputFiles(files);
    },
    async evaluate(fn, ...args) {
      if (args.length === 0) return page.evaluate(fn);
      if (args.length === 1) return page.evaluate(fn, args[0]);
      // Playwright evaluate accepts a single serializable arg; pack tuples when >1.
      return page.evaluate(({ src, tuple }) => {
        const compiled = new Function(`return (${src});`)();
        return compiled(...tuple);
      }, { src: fn.toString(), tuple: args });
    },
    async screenshot(filePath) {
      await page.screenshot({ path: filePath, fullPage: false });
    },
    async close() {
      await page.close().catch(() => undefined);
    },
  };
}

/** Wrap a Puppeteer (Firefox WebDriver BiDi) Page into the unified SmokePage interface. */
export function wrapPuppeteerPage(page) {
  let currentUrl = '';

  async function waitForExtensionReady(expectedPrefix, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const ready = await page.evaluate((prefix) => {
          return (
            location.href.startsWith(prefix) &&
            document.readyState !== 'loading' &&
            typeof chrome !== 'undefined' &&
            typeof chrome.runtime !== 'undefined'
          );
        }, expectedPrefix);
        if (ready) return;
      } catch {
        // Execution context destroyed during cross-process navigation — retry.
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for Firefox extension page ${expectedPrefix}`);
  }

  return {
    raw: page,
    driver: 'puppeteer',
    async goto(url) {
      currentUrl = url;
      if (url.startsWith('moz-extension://')) {
        // Firefox WebDriver BiDi performs a cross-process transition to the
        // WebExtension process, so Puppeteer's waitUntil listener can miss the
        // load event even though navigation completes in <500ms. Fire goto with
        // a short timeout and await DOM + chrome.runtime readiness directly.
        await page.goto(url, { waitUntil: 'load', timeout: 2500 }).catch(() => undefined);
        const prefix = url.split('?')[0];
        await waitForExtensionReady(prefix, 20_000);
        return;
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    },
    async reload() {
      const href = await page.evaluate(() => location.href).catch(() => currentUrl);
      if (href.startsWith('moz-extension://')) {
        await page.evaluate(() => location.reload()).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 400));
        await waitForExtensionReady(href.split('?')[0], 20_000);
        return;
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    },
    async title() {
      return page.title();
    },
    url() {
      return page.url();
    },
    async waitForSelector(selector, opts = {}) {
      const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
      if (opts.hidden) {
        await page.waitForSelector(selector, { hidden: true, timeout });
      } else {
        await page.waitForSelector(selector, { visible: opts.visible !== false, timeout });
      }
    },
    async isVisible(selector) {
      try {
        return await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 0 || rect.height > 0;
        }, selector);
      } catch {
        return false;
      }
    },
    async click(selector, opts = {}) {
      await page.waitForSelector(selector, { visible: true, timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS });
      await page.click(selector);
    },
    async fill(selector, value) {
      await page.waitForSelector(selector, { visible: true, timeout: DEFAULT_TIMEOUT_MS });
      await page.evaluate(
        (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`Element not found: ${sel}`);
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        selector,
        String(value),
      );
    },
    async check(selector, checked = true) {
      await page.waitForSelector(selector, { visible: true, timeout: DEFAULT_TIMEOUT_MS });
      await page.evaluate(
        (sel, desired) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`Checkbox not found: ${sel}`);
          if (Boolean(el.checked) !== Boolean(desired)) {
            el.click();
          }
        },
        selector,
        Boolean(checked),
      );
    },
    async selectOption(selector, value) {
      await page.waitForSelector(selector, { visible: true, timeout: DEFAULT_TIMEOUT_MS });
      await page.select(selector, String(value));
    },
    async getValue(selector) {
      await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? String(el.value ?? '') : '';
      }, selector);
    },
    async getText(selector) {
      await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el?.textContent ?? '';
      }, selector);
    },
    async getAttribute(selector, attr) {
      await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
      return page.evaluate(
        (sel, a) => {
          const el = document.querySelector(sel);
          return el ? el.getAttribute(a) : null;
        },
        selector,
        attr,
      );
    },
    async setInputFiles(selector, files) {
      const handle = await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT_MS });
      const fileList = Array.isArray(files) ? files : [files];
      try {
        await handle.uploadFile(...fileList);
      } catch (err) {
        // Firefox 153+ WebDriver BiDi blocks input.setFiles on privileged
        // moz-extension:// pages. Construct real File objects via DataTransfer
        // inside the extension page and dispatch the native change event.
        if (!String(err?.message || '').includes('privileged scope')) {
          throw err;
        }
        const serialized = fileList.map((filePath) => ({
          name: path.basename(filePath),
          content: readFileSync(filePath, 'utf-8'),
          type: filePath.endsWith('.json') ? 'application/json' : 'text/plain',
        }));
        await page.evaluate(
          (sel, items) => {
            const input = document.querySelector(sel);
            if (!input) throw new Error(`File input not found: ${sel}`);
            const dt = new DataTransfer();
            for (const item of items) {
              dt.items.add(new File([item.content], item.name, { type: item.type }));
            }
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          },
          selector,
          serialized,
        );
      }
    },
    async evaluate(fn, ...args) {
      return page.evaluate(fn, ...args);
    },
    async screenshot(filePath) {
      await page.screenshot({ path: filePath, fullPage: false });
    },
    async close() {
      await page.close().catch(() => undefined);
    },
  };
}
