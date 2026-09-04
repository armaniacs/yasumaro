import { RecordSession } from './recordCurrentPage/recordSession.js';

export { TabContentFetcher } from './recordCurrentPage/tabContentFetcher.js';
export { PreviewFlow } from './recordCurrentPage/previewFlow.js';
export { SpinnerManager } from './recordCurrentPage/spinnerManager.js';
export { ErrorPresenter } from './recordCurrentPage/errorPresenter.js';
export { RecordSession, type RecordSessionState } from './recordCurrentPage/recordSession.js';

const defaultRecordSession = new RecordSession();

export async function loadCurrentTab(): Promise<void> {
  return defaultRecordSession.loadCurrentTab();
}

export async function recordCurrentPage(force: boolean = false): Promise<void> {
  return defaultRecordSession.recordCurrentPage(force);
}

export async function handleRecordNowClick(
  force: boolean = false,
  tab?: chrome.tabs.Tab,
  content?: string
): Promise<void> {
  return defaultRecordSession.handleRecordNowClick(force, tab, content);
}
