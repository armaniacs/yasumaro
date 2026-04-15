import { getMessage } from '../popup/i18n.js';
import { TIMEOUTS } from '../constants/appConstants.js';

export function createPaginationControls(
  currentPage: number,
  totalPages: number,
  onPageChange: (page: number) => void,
): HTMLElement {
  const nav = document.createElement('div');
  nav.className = 'pending-pagination';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'secondary-btn';
  prevBtn.textContent = '←';
  prevBtn.disabled = currentPage === 0;
  prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));

  const pageInfo = document.createElement('span');
  pageInfo.className = 'pending-page-info';
  pageInfo.textContent = `${currentPage + 1} / ${totalPages}`;

  const nextBtn = document.createElement('button');
  nextBtn.className = 'secondary-btn';
  nextBtn.textContent = '→';
  nextBtn.disabled = currentPage >= totalPages - 1;
  nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));

  nav.appendChild(prevBtn);
  nav.appendChild(pageInfo);
  nav.appendChild(nextBtn);

  return nav;
}

export async function sendMessageWithTimeout(payload: {
  title: string;
  url: string;
  content: string;
  force: boolean;
  skipAi: boolean;
}): Promise<unknown> {
  const timeoutMs = 20000;
  const messagePromise = chrome.runtime.sendMessage({
    type: 'MANUAL_RECORD',
    payload,
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('Request timed out after 20 seconds. The page may be taking too long to load or process.')),
      timeoutMs,
    );
  });
  return Promise.race([messagePromise, timeoutPromise]);
}

export function showRecordError(info: HTMLElement, error: unknown): void {
  const errorMsg = error instanceof Error
    ? error.message
    : (error as { error?: string })?.error
    || getMessage('recordError')
    || '記録に失敗しました';
  console.error('[Dashboard] Manual record error:', error);
  const errorEl = document.createElement('div');
  errorEl.className = 'record-error-message';
  errorEl.textContent = errorMsg;
  info.appendChild(errorEl);
  setTimeout(() => { errorEl.remove(); }, TIMEOUTS.ERROR_MESSAGE_DISPLAY);
}

export async function checkServiceWorkerAlive(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PING' });
    return response?.success === true;
  } catch (error) {
    console.error('[Dashboard] Service Worker not responding:', error);
    return false;
  }
}
