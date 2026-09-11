import { initializeModalEvents } from './sanitizePreview.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { loadCurrentTab, recordCurrentPage } from './recordCurrentPage.js';
import { initStatusPanel, initAllUrlsPermissionBanner, getCleansedReasonText, renderSpecialUrlStatus } from './statusPanel.js';

export { loadCurrentTab, recordCurrentPage, getCleansedReasonText, renderSpecialUrlStatus };

async function loadCurrentTabAndInitStatus(): Promise<void> {
  await loadCurrentTab();
  await initStatusPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  // PBI 2026-09-11-09 (round 6): recordBtn wiring is RecordSession's
  // (onclick sole-writer — PBI 2026-09-07-24). The addEventListener here
  // double-fired alongside it; the session's resetRecordButton wires the
  // initial state on load.
  initializeModalEvents();
  loadCurrentTabAndInitStatus().catch((error) => {
    logError('[Initialize] Failed to load current tab or init status panel', { cause: error }, ErrorCode.INTERNAL_ERROR);
  });
  initAllUrlsPermissionBanner().catch((error) => {
    logError('[Initialize] Failed to init all-urls permission banner', { cause: error }, ErrorCode.INTERNAL_ERROR);
  });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId !== undefined) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  });
});