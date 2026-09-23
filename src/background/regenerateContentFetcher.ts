/**
 * regenerateContentFetcher.ts — REGENERATE_SUMMARY's re-extraction seam
 * (PBI 2026-09-22-04).
 *
 * Opens the entry's URL in a background tab, waits for load, and asks the
 * content script for GET_CONTENT with a one-shot cleanseMode override — the
 * only path where cleanseMode is meaningful (the extraction pipeline runs,
 * unlike ManualContentFetcher's innerText shortcut).
 *
 * Decisions recorded in the PBI:
 * - **Every call creates a fresh tab** (no reuse): the manifest has no
 *   `tabs` permission, so `tab.url` is unreadable for most origins — reuse
 *   lookup would silently fail anyway (Why 連鎖D). Fresh tabs are
 *   `active: false` and always closed in `finally`.
 * - Deliberately NOT sharing ManualContentFetcher's wait/close internals:
 *   theirs resolves best-effort on timeout (a partial extract still wins),
 *   this one REJECTS on timeout (a regenerate must never UPDATE with
 *   half-loaded content) — same shape, opposite semantics.
 * - validateUrl with blockLocalhost mirrors ManualContentFetcher's position
 *   (Ask: localhost/内部IP 記録の再生成はエラー).
 * - GET_CONTENT delivery races injection on a fresh tab — retry
 *   "receiving end" errors (200ms × 10).
 *
 * All chrome access is dependency-injected (createTab/removeTab/sendMessage/
 * getTab/onUpdated) so unit tests never stub globals.
 */

import { validateUrl } from '../utils/ssrfGuard.js';
import type { ContentResponse } from '../messaging/types.js';
import type { RegenerateCleanseMode } from '../utils/aiSummaryCleaner/cleanseModeLadder.js';

export interface RegenerateContentFetcherDeps {
  createTab: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
  removeTab: (tabId: number) => Promise<void>;
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  getTab: (tabId: number) => Promise<{ status?: string | undefined }>;
  onUpdated: {
    addListener: (cb: (tabId: number, info: { status?: string }) => void) => void;
    removeListener: (cb: (tabId: number, info: { status?: string }) => void) => void;
  };
}

const COMPLETE_TIMEOUT_MS = 10_000;
const SEND_RETRY_DELAY_MS = 200;
const SEND_RETRY_ATTEMPTS = 10;

export class RegenerateContentFetcher {
  constructor(private readonly deps: RegenerateContentFetcherDeps) {}

  /**
   * Re-extract the URL with the requested cleanseMode and return the full
   * diagnostic reply (content + byte stats + fallback outcome).
   * Throws Error with a stable sentinel message on validation/load/send
   * failure — the handler maps these to `{ success:false, error }`.
   */
  async fetchExtracted(url: string, cleanseMode: RegenerateCleanseMode): Promise<ContentResponse> {
    validateUrl(url, { requireValidProtocol: true, blockLocalhost: true });

    const tab = await this.deps.createTab({ url, active: false });
    const tabId = tab.id;
    if (tabId === undefined) {
      throw new Error('tab_create_failed');
    }

    try {
      await this.waitForComplete(tabId, COMPLETE_TIMEOUT_MS);
      const reply = await this.sendWithRetry(tabId, { type: 'GET_CONTENT', payload: { cleanseMode } });
      if (!reply || typeof reply !== 'object' || typeof (reply as ContentResponse).content !== 'string') {
        throw new Error('get_content_invalid_reply');
      }
      return reply as ContentResponse;
    } finally {
      try {
        await this.deps.removeTab(tabId);
      } catch {
        // Tab may already be closed by the user or the browser — never fail
        // the regeneration because teardown raced.
      }
    }
  }

  private waitForComplete(tabId: number, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer); // no late-firing timer
        this.deps.onUpdated.removeListener(listener);
        if (err) reject(err);
        else resolve();
      };
      const listener = (updatedTabId: number, info: { status?: string }): void => {
        if (updatedTabId === tabId && info.status === 'complete') finish();
      };
      this.deps.onUpdated.addListener(listener);
      // The tab may already have finished loading before the listener ran.
      void (async () => {
        try {
          const tab = await this.deps.getTab(tabId);
          if (tab.status === 'complete') finish();
        } catch (e: unknown) {
          finish(new Error(`tab_get_failed: ${String(e)}`));
        }
      })();
      timer = setTimeout(() => finish(new Error('tab_load_timeout')), timeoutMs);
    });
  }

  private async sendWithRetry(tabId: number, message: unknown): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < SEND_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.deps.sendMessage(tabId, message);
      } catch (e: unknown) {
        lastError = e;
        const text = e instanceof Error ? e.message : String(e);
        const injectionRace =
          text.includes('receiving end does not exist') ||
          text.includes('Could not establish connection');
        if (injectionRace && attempt < SEND_RETRY_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS));
          continue;
        }
        break;
      }
    }
    throw new Error(`get_content_send_failed: ${String(lastError)}`);
  }
}
