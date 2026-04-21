import { showPreview, initializeModalEvents } from './sanitizePreview.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { isRecordable } from './tabUtils.js';
import { loadCurrentTab, recordCurrentPage, setRecordCurrentPageFn } from './recordCurrentPage.js';
import { initStatusPanel, initAllUrlsPermissionBanner, getCleansedReasonText, renderSpecialUrlStatus } from './statusPanel.js';

export { loadCurrentTab, recordCurrentPage, getCleansedReasonText, renderSpecialUrlStatus, isRecordable };

setRecordCurrentPageFn(recordCurrentPage);

async function loadCurrentTabAndInitStatus(): Promise<void> {
  await loadCurrentTab();
  await initStatusPanel();
}

document.addEventListener('DOMContentLoaded', () => {
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