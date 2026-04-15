import { getMessage } from '../popup/i18n.js';
import { removePendingPages } from '../utils/pendingStorage.js';
import type { PendingPage } from '../utils/pendingStorage.js';
import { renderPendingReason } from './historyFilters.js';
import { showRecordError, checkServiceWorkerAlive, sendMessageWithTimeout, createPaginationControls } from './historyUtils.js';
import type { HistoryPanelState, HistoryElements } from './historyState.js';

const PENDING_PAGE_SIZE = 10;

function getRecordButtonText(skipAi: boolean): string {
  return skipAi
    ? (getMessage('recordWithoutAi') || '📝 AI要約なしで記録')
    : (getMessage('recordNow') || '📝 今すぐ記録');
}

type RecordResult = { success: boolean } | null;
type OnRecordSuccess = () => void;

async function executeRecord(
  page: PendingPage,
  skipAi: boolean,
  btn: HTMLButtonElement,
  info: HTMLElement,
  onSuccess: OnRecordSuccess,
): Promise<void> {
  btn.disabled = true;
  btn.textContent = getMessage('processing') || '処理中...';
  const errorEl = info.querySelector('.record-error-message') as HTMLElement | null;
  if (errorEl) errorEl.remove();

  try {
    const result = await sendMessageWithTimeout({ title: page.title, url: page.url, content: '', force: true, skipAi }) as RecordResult;
    if (result?.success) {
      await removePendingPages([page.url]);
      onSuccess();
    } else {
      showRecordError(info, result);
      btn.disabled = false;
      btn.textContent = getRecordButtonText(skipAi);
    }
  } catch (error) {
    const swAlive = await checkServiceWorkerAlive();
    if (!swAlive) {
      showRecordError(info, new Error(getMessage('serviceWorkerNotResponding') || 'Service Workerが応答しません。拡張機能を再読み込みしてください。'));
    } else {
      showRecordError(info, error);
    }
    btn.disabled = false;
    btn.textContent = getRecordButtonText(skipAi);
  }
}

export function renderSkippedMode(
  state: HistoryPanelState,
  elements: HistoryElements,
  searchText: string,
  onApplyFilters: () => void,
): void {
  if (!elements.historyList) return;

  const filtered = state.pendingPages.filter(p =>
    !searchText ||
    p.url.toLowerCase().includes(searchText) ||
    (p.title || '').toLowerCase().includes(searchText),
  );

  if (elements.historyStats) {
    elements.historyStats.textContent = `${filtered.length} / ${state.pendingPages.length}`;
  }

  if (filtered.length === 0) {
    elements.historyList.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
    return;
  }

  elements.historyList.innerHTML = '';
  for (const page of filtered) {
    const row = document.createElement('div');
    row.className = 'history-entry pending-entry-inline';

    const info = document.createElement('div');
    info.className = 'history-entry-info';

    const topRow = document.createElement('div');
    topRow.className = 'history-entry-top';

    const skipBadge = document.createElement('span');
    skipBadge.className = 'history-badge history-badge-skipped';
    skipBadge.textContent = getMessage('filterSkipped') || 'スキップ';
    topRow.appendChild(skipBadge);

    const urlEl = document.createElement('a');
    urlEl.className = 'history-entry-url';
    urlEl.href = page.url;
    urlEl.target = '_blank';
    urlEl.rel = 'noopener noreferrer';
    urlEl.textContent = page.title || page.url;
    topRow.appendChild(urlEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'history-entry-time';
    metaEl.textContent = `${new Date(page.timestamp).toLocaleString()} — ${renderPendingReason(page.reason)}`;

    info.appendChild(topRow);
    info.appendChild(metaEl);

    const recordBtn = document.createElement('button');
    recordBtn.className = 'secondary-btn pending-record-btn';
    recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
    recordBtn.addEventListener('click', () => {
      void executeRecord(page, false, recordBtn, info, async () => {
        const pIdx = state.pendingPages.findIndex(p => p.url === page.url);
        if (pIdx !== -1) state.pendingPages.splice(pIdx, 1);
        state.pendingUrlSet.delete(page.url);
        row.remove();
        if (elements.historyList!.children.length === 0) {
          elements.historyList!.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
        }
        if (elements.historyStats) {
          elements.historyStats.textContent = `${state.pendingPages.length} / ${state.pendingPages.length}`;
        }
      });
    });

    const recordNoAiBtn = document.createElement('button');
    recordNoAiBtn.className = 'secondary-btn pending-record-btn';
    recordNoAiBtn.textContent = getMessage('recordWithoutAi') || '📝 AI要約なしで記録';
    recordNoAiBtn.addEventListener('click', () => {
      void executeRecord(page, true, recordNoAiBtn, info, async () => {
        const pIdx = state.pendingPages.findIndex(p => p.url === page.url);
        if (pIdx !== -1) state.pendingPages.splice(pIdx, 1);
        state.pendingUrlSet.delete(page.url);
        row.remove();
        if (elements.historyList!.children.length === 0) {
          elements.historyList!.innerHTML = `<div class="history-empty">${getMessage('historyEmpty') || 'No history found.'}</div>`;
        }
        if (elements.historyStats) {
          elements.historyStats.textContent = `${state.pendingPages.length} / ${state.pendingPages.length}`;
        }
      });
    });

    const btnGroup = document.createElement('div');
    btnGroup.className = 'pending-btn-group';
    btnGroup.appendChild(recordBtn);
    btnGroup.appendChild(recordNoAiBtn);

    row.appendChild(info);
    row.appendChild(btnGroup);
    elements.historyList.appendChild(row);
  }
}

export function renderPendingPage(
  state: HistoryPanelState,
  elements: HistoryElements,
  pendingSection: HTMLElement,
  pendingList: HTMLElement,
  sortedPending: PendingPage[],
  pendingCurrentPageRef: { value: number },
  onApplyFilters: () => void,
): void {
  pendingList.innerHTML = '';

  const start = pendingCurrentPageRef.value * PENDING_PAGE_SIZE;
  const pageItems = sortedPending.slice(start, start + PENDING_PAGE_SIZE);

  for (const page of pageItems) {
    const row = document.createElement('div');
    row.className = 'pending-entry';

    const info = document.createElement('div');
    info.className = 'pending-entry-info';

    const urlEl = document.createElement('a');
    urlEl.className = 'history-entry-url';
    urlEl.href = page.url;
    urlEl.target = '_blank';
    urlEl.rel = 'noopener noreferrer';
    urlEl.textContent = page.title || page.url;

    const metaEl = document.createElement('div');
    metaEl.className = 'pending-entry-meta';
    metaEl.textContent = `${new Date(page.timestamp).toLocaleString()} — ${renderPendingReason(page.reason)}`;
    if (page.headerValue) {
      const headerEl = document.createElement('span');
      headerEl.className = 'pending-entry-header';
      headerEl.textContent = ` (${page.headerValue})`;
      metaEl.appendChild(headerEl);
    }

    info.appendChild(urlEl);
    info.appendChild(metaEl);

    const refresh = () => renderPendingPage(
      state, elements, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters,
    );

    const recordBtn = document.createElement('button');
    recordBtn.className = 'secondary-btn pending-record-btn';
    recordBtn.textContent = getMessage('recordNow') || '📝 今すぐ記録';
    recordBtn.addEventListener('click', () => {
      void executeRecord(page, false, recordBtn, info, async () => {
        const pIdx = state.pendingPages.findIndex(p => p.url === page.url);
        if (pIdx !== -1) state.pendingPages.splice(pIdx, 1);
        const sIdx = sortedPending.findIndex(p => p.url === page.url);
        if (sIdx !== -1) sortedPending.splice(sIdx, 1);
        state.pendingUrlSet.delete(page.url);
        if (pendingCurrentPageRef.value > 0 && pendingCurrentPageRef.value * PENDING_PAGE_SIZE >= sortedPending.length) {
          pendingCurrentPageRef.value--;
        }
        if (sortedPending.length === 0) {
          pendingSection.hidden = true;
        } else {
          refresh();
        }
        if (state.activeFilter === 'skipped') onApplyFilters();
      });
    });

    const recordNoAiBtn = document.createElement('button');
    recordNoAiBtn.className = 'secondary-btn pending-record-btn';
    recordNoAiBtn.textContent = getMessage('recordWithoutAi') || '📝 AI要約なしで記録';
    recordNoAiBtn.addEventListener('click', () => {
      void executeRecord(page, true, recordNoAiBtn, info, async () => {
        const pIdx = state.pendingPages.findIndex(p => p.url === page.url);
        if (pIdx !== -1) state.pendingPages.splice(pIdx, 1);
        const sIdx = sortedPending.findIndex(p => p.url === page.url);
        if (sIdx !== -1) sortedPending.splice(sIdx, 1);
        state.pendingUrlSet.delete(page.url);
        if (pendingCurrentPageRef.value > 0 && pendingCurrentPageRef.value * PENDING_PAGE_SIZE >= sortedPending.length) {
          pendingCurrentPageRef.value--;
        }
        if (sortedPending.length === 0) {
          pendingSection.hidden = true;
        } else {
          refresh();
        }
        if (state.activeFilter === 'skipped') onApplyFilters();
      });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger-btn pending-delete-btn';
    deleteBtn.textContent = getMessage('pendingDeleteForever') || '🗑 完全削除';
    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      try {
        await removePendingPages([page.url]);
        const pIdx = state.pendingPages.findIndex(p => p.url === page.url);
        if (pIdx !== -1) state.pendingPages.splice(pIdx, 1);
        const sIdx = sortedPending.findIndex(p => p.url === page.url);
        if (sIdx !== -1) sortedPending.splice(sIdx, 1);
        state.pendingUrlSet.delete(page.url);
        if (pendingCurrentPageRef.value > 0 && pendingCurrentPageRef.value * PENDING_PAGE_SIZE >= sortedPending.length) {
          pendingCurrentPageRef.value--;
        }
        if (sortedPending.length === 0) {
          pendingSection.hidden = true;
        } else {
          renderPendingPage(state, elements, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters);
        }
        if (state.activeFilter === 'skipped') onApplyFilters();
      } catch {
        deleteBtn.disabled = false;
      }
    });

    const btnGroup = document.createElement('div');
    btnGroup.className = 'pending-btn-group';
    btnGroup.appendChild(recordBtn);
    btnGroup.appendChild(recordNoAiBtn);
    btnGroup.appendChild(deleteBtn);
    row.appendChild(info);
    row.appendChild(btnGroup);
    pendingList.appendChild(row);
  }

  const totalPages = Math.ceil(sortedPending.length / PENDING_PAGE_SIZE);
  if (totalPages > 1) {
    const nav = createPaginationControls(
      pendingCurrentPageRef.value,
      totalPages,
      (newPage) => {
        pendingCurrentPageRef.value = newPage;
        renderPendingPage(state, elements, pendingSection, pendingList, sortedPending, pendingCurrentPageRef, onApplyFilters);
      },
    );
    pendingList.appendChild(nav);
  }
}
