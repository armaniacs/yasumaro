import { getFeedbackQueue, clearFeedbackQueue, removeFeedbackEntry } from '../utils/aiSummaryCleaner/feedbackQueue.js';
import type { CleansingFeedbackEntry } from '../utils/storage/types.js';

export async function renderCleansingFeedback(container: HTMLElement): Promise<void> {
  const entries = await getFeedbackQueue();
  container.innerHTML = '';
  container.className = 'cleansing-feedback-view';

  const header = document.createElement('div');
  header.className = 'cleansing-feedback-header';
  const title = document.createElement('h3');
  title.textContent = `Cleansing Feedback (${entries.length})`;
  header.appendChild(title);
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '全削除';
  clearBtn.className = 'btn-secondary btn-sm';
  clearBtn.id = 'cleansingFeedbackClearAll';
  clearBtn.disabled = entries.length === 0;
  clearBtn.addEventListener('click', async () => {
    await clearFeedbackQueue();
    await renderCleansingFeedback(container);
  });
  header.appendChild(clearBtn);
  container.appendChild(header);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '報告はありません';
    empty.className = 'cleansing-feedback-empty';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'cleansing-feedback-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Domain</th><th>Snippet</th><th>Reason</th><th>Date</th><th>Action</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const e of entries) {
    const tr = document.createElement('tr');
    const tdDomain = document.createElement('td');
    tdDomain.textContent = e.domain || e.url;
    tdDomain.title = e.url;
    const tdSnippet = document.createElement('td');
    tdSnippet.textContent = e.htmlSnippet.slice(0, 100);
    tdSnippet.title = e.htmlSnippet;
    const tdReason = document.createElement('td');
    tdReason.textContent = Object.entries(e.removedByReason).map(([k, v]) => `${k}:${v}`).join(', ');
    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(e.createdAt).toLocaleString();
    const tdAction = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.className = 'btn-secondary btn-sm';
    delBtn.dataset.feedbackId = e.id;
    delBtn.addEventListener('click', async () => {
      await removeFeedbackEntry(e.id);
      await renderCleansingFeedback(container);
    });
    tdAction.appendChild(delBtn);
    tr.appendChild(tdDomain);
    tr.appendChild(tdSnippet);
    tr.appendChild(tdReason);
    tr.appendChild(tdDate);
    tr.appendChild(tdAction);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

export { getFeedbackQueue, clearFeedbackQueue, removeFeedbackEntry };
