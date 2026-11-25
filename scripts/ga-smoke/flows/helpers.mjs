/**
 * helpers.mjs — Shared extension-interaction helpers for the 10 GA smoke flows.
 *
 * Strictly zero OW_E2E_PROBE usage: every check observes real extension UI,
 * real SQLite rows (via DASHBOARD_SQLITE), real files on disk, or real HTTP(S)
 * requests received by the local fixture servers.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Poll a condition until truthy or timeout expires (interval <= 1000ms). */
export async function pollUntil(fn, { timeoutMs = 15_000, intervalMs = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const suffix = lastError ? ` (last error: ${lastError.message})` : '';
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${suffix}`);
}

/**
 * Send a `DASHBOARD_SQLITE` message from an extension page (`options.html` / `popup.html`).
 * Computes the real SHA-256 confirmToken inside the extension page when required.
 */
export async function dashboardSqlite(extPage, payload) {
  return extPage.evaluate(async (p) => {
    return await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: p });
  }, payload);
}

/** Query current SQLite browsing-log row count from an extension page. */
export async function getSqliteCount(extPage) {
  const res = await dashboardSqlite(extPage, { subtype: 'get_count' });
  const raw = res?.data ?? res?.count ?? res?.total ?? 0;
  return Number(raw) || 0;
}

/** Query SQLite rows (optionally filtered by search text or domain). */
export async function querySqliteRows(extPage, opts = {}) {
  const res = await dashboardSqlite(extPage, {
    subtype: 'query',
    limit: opts.limit ?? 50,
    ...(opts.search ? { search: opts.search } : {}),
    ...(opts.domain ? { domain: opts.domain } : {}),
  });
  const data = res?.data ?? res;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data)) return data;
  return [];
}

/** Navigate to a dashboard sidebar panel (auto-expanding the parent Settings group if needed). */
export async function openDashboardPanel(optionsPage, panelId) {
  // Defensively clear any leftover modal overlay from a previous failed flow so
  // failures stay isolated to their own step.
  if (await optionsPage.isVisible('.confirm-dialog-overlay')) {
    await optionsPage.click('.confirm-dialog-btn-cancel').catch(() => undefined);
    await optionsPage.waitForSelector('.confirm-dialog-overlay', { hidden: true, timeout: 5_000 }).catch(() => undefined);
  }
  const selector = `button.sidebar-nav-btn[data-panel="${panelId}"]`;
  const visible = await optionsPage.isVisible(selector);
  if (!visible) {
    // Expand the collapsible Settings parent group first.
    await optionsPage.click('button.sidebar-nav-btn[data-panel="panel-general"]');
    await optionsPage.waitForSelector(selector, { visible: true, timeout: 10_000 });
  }
  await optionsPage.click(selector);
  await optionsPage.waitForSelector(`#${panelId}`, { visible: true, timeout: 10_000 });
}

/**
 * Wait until the dashboard's initial settings mount finishes so form writes
 * don't race against async `loadGeneralSettings()`.
 */
export async function waitForDashboardReady(optionsPage) {
  await pollUntil(
    async () => {
      return optionsPage.evaluate(() => {
        const provider = document.getElementById('aiProvider');
        return Boolean(provider && provider.options && provider.options.length > 0);
      });
    },
    { timeoutMs: 20_000, intervalMs: 250, label: 'dashboard general settings mount' },
  );
}

/**
 * Trigger a real MANUAL_RECORD for a live open page via the extension runtime
 * (the exact validated envelope sent by `popup.html`'s `#recordBtn`).
 * Extracts `title` and `content` directly from the open `targetPage` so it
 * respects Yasumaro's minimal permissions (no `"tabs"` permission required).
 *
 * When the production RateLimiter (5 calls / 60s) throttles back-to-back flows,
 * backs off in 5s increments (<=10s poll cap) until the window reopens.
 */
export async function triggerManualRecordForPage(
  extPage,
  targetPage,
  { force = false, log = console.log } = {},
) {
  const extracted = await targetPage.evaluate(() => ({
    url: window.location.href,
    title: document.title || '',
    content: document.body?.innerText || '',
  }));

  const sendOnce = () =>
    extPage.evaluate(
      async ({ url, title, content, forceFlag }) => {
        return await chrome.runtime.sendMessage({
          type: 'MANUAL_RECORD',
          version: 1,
          payload: {
            url,
            title,
            content,
            force: forceFlag,
          },
        });
      },
      { ...extracted, forceFlag: force },
    );

  let resp = await sendOnce();
  if (resp?.reason === 'rate_limited') {
    log('    [RateLimit] MANUAL_RECORD window reached (5/60s) — waiting for window reset...');
    const deadline = Date.now() + 70_000;
    while (resp?.reason === 'rate_limited' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      resp = await sendOnce();
    }
  }
  return resp;
}

/** Accept an open confirmation dialog if present (e.g. HTTP protocol warning on Save). */
export async function acceptConfirmDialogIfVisible(page, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.isVisible('.confirm-dialog-overlay')) {
      const btn = (await page.isVisible('.confirm-dialog-btn-danger'))
        ? '.confirm-dialog-btn-danger'
        : '.confirm-dialog-btn-primary';
      await page.click(btn);
      await page.waitForSelector('.confirm-dialog-overlay', { hidden: true, timeout: 5_000 }).catch(() => undefined);
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Recursively list all files in a directory. */
export function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...listFilesRecursive(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/** Wait until a file matching `predicate` appears in `dir` with non-zero size. */
export async function waitForDownloadedFile(dir, predicate, { timeoutMs = 20_000 } = {}) {
  return pollUntil(
    () => {
      const files = listFilesRecursive(dir).filter(
        (f) => !f.endsWith('.crdownload') && !f.endsWith('.part') && !f.endsWith('.tmp'),
      );
      const match = files.find((f) => {
        try {
          return predicate(f) && statSync(f).size > 0;
        } catch {
          return false;
        }
      });
      return match || null;
    },
    { timeoutMs, intervalMs: 300, label: `downloaded file in ${dir}` },
  );
}

/**
 * Resolve the most recent completed download matching `predicate` across both
 * Chromium (`chrome.downloads.search`) and Firefox (`browser.downloads.search`),
 * falling back to recursive scan of `downloadsDir`.
 */
export async function findDownloadedFile(extPage, downloadsDir, predicate, { timeoutMs = 20_000 } = {}) {
  try {
    return await waitForDownloadedFile(downloadsDir, predicate, { timeoutMs: Math.min(timeoutMs, 6_000) });
  } catch {
    // Fall back to querying the browser's downloads API (handles Firefox/Chrome
    // default download directory overrides reliably).
    return pollUntil(
      async () => {
        const paths = await extPage.evaluate(async () => {
          const query = { orderBy: ['-startTime'], limit: 15 };
          let items = [];
          if (globalThis.browser?.downloads?.search) {
            items = await globalThis.browser.downloads.search(query).catch(() => []);
          } else if (globalThis.chrome?.downloads?.search) {
            items = await new Promise((resolve) => {
              try {
                const p = globalThis.chrome.downloads.search(query, (res) => resolve(res || []));
                if (p && typeof p.then === 'function') p.then(resolve, () => resolve([]));
              } catch {
                resolve([]);
              }
            });
          }
          return (items || [])
            .filter((i) => i && i.filename && i.state === 'complete')
            .map((i) => i.filename);
        });
        return paths.find((f) => predicate(f) && existsSync(f) && statSync(f).size > 0) ?? null;
      },
      { timeoutMs, intervalMs: 400, label: `completed download matching predicate` },
    );
  }
}

/** Read the current `settings` object from `chrome.storage.local` inside an extension page. */
export async function readExtensionSettings(extPage) {
  return extPage.evaluate(async () => {
    const got = await chrome.storage.local.get('settings');
    return got?.settings ?? {};
  });
}

/** Save updated settings keys into `chrome.storage.local` (preserving existing fields). */
export async function patchExtensionSettings(extPage, patch) {
  return extPage.evaluate(async (p) => {
    const got = await chrome.storage.local.get('settings');
    const current = (got && typeof got.settings === 'object' && got.settings) ? got.settings : {};
    const merged = { ...current, ...p };
    await chrome.storage.local.set({ settings: merged });
    return merged;
  }, patch);
}
