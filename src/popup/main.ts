import { initializeModalEvents } from './sanitizePreview.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError } from '../utils/logger/api.js';
import { loadCurrentTab, recordCurrentPage } from './recordCurrentPage.js';
import { initStatusPanel, initAllUrlsPermissionBanner, getCleansedReasonText, renderSpecialUrlStatus } from './statusPanel.js';
import { getCurrentTab } from './tabUtils.js';

export { loadCurrentTab, recordCurrentPage, getCleansedReasonText, renderSpecialUrlStatus };

async function loadCurrentTabAndInitStatus(): Promise<void> {
  await loadCurrentTab();
  await initStatusPanel();
}

async function clearActionBadge(): Promise<void> {
  try {
    const tab = await getCurrentTab();
    if (tab?.id !== undefined) {
      chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
  } catch {
    // Best-effort: the badge is a leftover from a previous recording, so a
    // failed read must not break the rest of popup startup.
  }
}

/**
 * PBI 2026-10-05-31: single entry point — the entrypoint
 * (entrypoints/popup/main.ts) calls this once under its readyState guard
 * instead of this module self-registering DOMContentLoaded.
 */
export async function initMainScreen(): Promise<void> {
  // PBI 2026-09-11-09 (round 6): recordBtn wiring is RecordSession's
  // (onclick sole-writer — PBI 2026-09-07-24). The addEventListener here
  // double-fired alongside it; the session's resetRecordButton wires the
  // initial state on load.
  initializeModalEvents();
  try {
    await loadCurrentTabAndInitStatus();
  } catch (error) {
    logError('[Initialize] Failed to load current tab or init status panel', { cause: error }, ErrorCode.INTERNAL_ERROR);
  }
  try {
    await initAllUrlsPermissionBanner();
  } catch (error) {
    logError('[Initialize] Failed to init all-urls permission banner', { cause: error }, ErrorCode.INTERNAL_ERROR);
  }
  await clearActionBadge();
}