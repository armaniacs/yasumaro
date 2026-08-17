import { RecordOrchestrator } from './recordCurrentPage/recordOrchestrator.js';

export { TabContentFetcher } from './recordCurrentPage/tabContentFetcher.js';
export { PreviewFlow } from './recordCurrentPage/previewFlow.js';
export { ForceRecordFlow } from './recordCurrentPage/forceRecordFlow.js';
export { SpinnerManager } from './recordCurrentPage/spinnerManager.js';
export { ErrorPresenter } from './recordCurrentPage/errorPresenter.js';
export { RecordOrchestrator } from './recordCurrentPage/recordOrchestrator.js';

let _recordCurrentPageFn: ((force: boolean) => Promise<void>) | null = null;

export function setRecordCurrentPageFn(fn: (force: boolean) => Promise<void>): void {
  _recordCurrentPageFn = fn;
}

const defaultRecordOrchestrator = new RecordOrchestrator();

export async function loadCurrentTab(): Promise<void> {
  return defaultRecordOrchestrator.loadCurrentTab();
}

export async function recordCurrentPage(force: boolean = false): Promise<void> {
  return defaultRecordOrchestrator.recordCurrentPage(force);
}

export async function handleRecordNowClick(
  force: boolean = false,
  tab?: chrome.tabs.Tab,
  content?: string
): Promise<void> {
  return defaultRecordOrchestrator.handleRecordNowClick(force, tab, content);
}
