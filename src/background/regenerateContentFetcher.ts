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
 * - Tab lifecycle (open/wait/close) is shared with ManualContentFetcher via
 *   tabLifecycle.ts since PBI 2026-10-24-06; only the timeout policy differs
 *   (this path REJECTS on timeout so a regenerate never UPDATEs with
 *   half-loaded content, while manual resolves best-effort). The earlier
 *   non-sharing shape is kept above as the reason for the policy value.
 * - validateUrl with blockLocalhost mirrors ManualContentFetcher's position
 *   (regenerating records of localhost/internal IPs is an error).
 * - GET_CONTENT delivery races injection on a fresh tab — retry
 *   "receiving end" errors (200ms × 10).
 *
 * All chrome access is dependency-injected (createTab/removeTab/sendMessage/
 * getTab/onUpdated) so unit tests never stub globals.
 */

import { validateUrl } from '../utils/ssrfGuard.js';
import { errorMessage } from '../utils/errorUtils.js';
import { isDisconnectMessage } from '../messaging/disconnectPhrase.js';
import type { ContentResponse } from '../messaging/types.js';
import type { RegenerateCleanseMode } from '../utils/aiSummaryCleaner/cleanseModeLadder.js';
import type { TabLifecyclePorts } from './tabLifecycle.js';
import { closeHelperTab, openHelperTab, waitForTabComplete } from './tabLifecycle.js';

export interface RegenerateContentFetcherDeps
  extends Pick<TabLifecyclePorts, 'createTab' | 'getTab' | 'removeTab' | 'onUpdated'> {
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
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

    const tabId = await openHelperTab(this.deps, url);

    try {
      // Reject wait (shared lifecycle): a regenerate must never UPDATE with
      // half-loaded content.
      await waitForTabComplete(this.deps, tabId, COMPLETE_TIMEOUT_MS, 'reject');
      const reply = await this.sendWithRetry(tabId, { type: 'GET_CONTENT', payload: { cleanseMode } });
      if (!reply || typeof reply !== 'object' || typeof (reply as ContentResponse).content !== 'string') {
        throw new Error('get_content_invalid_reply');
      }
      return reply as ContentResponse;
    } finally {
      // Tab may already be closed by the user or the browser — never fail
      // the regeneration because teardown raced.
      await closeHelperTab(this.deps, tabId);
    }
  }

  private async sendWithRetry(tabId: number, message: unknown): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < SEND_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.deps.sendMessage(tabId, message);
      } catch (e: unknown) {
        lastError = e;
        const text = errorMessage(e);
        const injectionRace = isDisconnectMessage(text);
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
