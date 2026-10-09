import { getFeedbackQueue, clearFeedbackQueue, removeFeedbackEntry } from '../utils/aiSummaryCleaner/feedbackQueue.js';
import { clearElement } from '../utils/domClear.js';
import { getMessageOr } from '../utils/i18n.js';
import { readRemovedCounts } from '../utils/commonTypes.js';
import type { AiSummaryRemovedStats } from '../utils/commonTypes.js';
import { ruleLabelFallback, ruleMessageKey } from '../utils/aiSummaryCleaner/ruleLabels.js';
import { formatBytes } from './byteFormat.js';

/** Reason label for a cleansing rule key, falling back to the raw key. */
function reasonLabel(reason: string): string {
  return getMessageOr(ruleMessageKey(reason), ruleLabelFallback(reason));
}

function appendAiSummaryDetail(group: HTMLElement, text: string): void {
  const detail = document.createElement('div');
  detail.className = 'cleansing-feedback-ai-summary-detail';
  detail.textContent = text;
  group.appendChild(detail);
}

/**
 * Render the AI-summary stats under their own label.
 *
 * WHY separate lines: the wire field is a single Record<string, number>, so
 * these byte totals and reason labels used to be printed as `key:count` pairs
 * next to the real removal counts. Each item is rendered explicitly so the
 * reason array never collapses into a comma-only string.
 */
function appendAiSummaryGroup(td: HTMLElement, stats: AiSummaryRemovedStats): void {
  const group = document.createElement('div');
  group.className = 'cleansing-feedback-ai-summary';
  const label = document.createElement('div');
  label.className = 'cleansing-feedback-ai-summary-label';
  label.textContent = getMessageOr('historyAiSummaryCleansing', 'AI Summary Cleansing');
  group.appendChild(label);

  appendAiSummaryDetail(
    group,
    `${getMessageOr('historyBytes', 'Bytes')}: ${formatBytes(stats.originalBytes)} → ${formatBytes(stats.cleansedBytes)}`,
  );
  appendAiSummaryDetail(group, `${getMessageOr('cleansingCount', 'Count')}: ${stats.elements}`);
  appendAiSummaryDetail(
    group,
    `${getMessageOr('cleansingFeedbackReason', 'Reason')}: ${reasonLabel(stats.reason)}`,
  );
  if (stats.reasons && stats.reasons.length > 0) {
    appendAiSummaryDetail(
      group,
      `${getMessageOr('cleansingFeedbackReasons', 'Reasons')}: ${stats.reasons.map(reasonLabel).join(', ')}`,
    );
  }
  td.appendChild(group);
}

/**
 * @param aiSummary stats persisted on the entry itself. `readRemovedCounts`
 * stays the fallback for entries written before the split, whose `aiSummary*`
 * keys live inside the count map. The persisted field wins when both exist:
 * the count map is the contaminated shape, so it is the less trustworthy
 * source of the two.
 */
function renderReasonCell(
  td: HTMLElement,
  removedByReason: Record<string, number>,
  aiSummary?: AiSummaryRemovedStats,
): void {
  const counts = readRemovedCounts(removedByReason);
  const pairs = Object.entries(counts.byReason);
  if (pairs.length > 0) {
    td.textContent = pairs.map(([k, v]) => `${k}:${v}`).join(', ');
  }
  const stats = aiSummary ?? counts.aiSummary;
  if (stats) appendAiSummaryGroup(td, stats);
}

export async function renderCleansingFeedback(container: HTMLElement): Promise<void> {
  const entries = await getFeedbackQueue();
  clearElement(container);
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
  const headerRow = document.createElement('tr');
  const headers: Array<[string, string]> = [
    ['cleansingFeedbackDomain', 'Domain'],
    ['cleansingFeedbackSnippet', 'Snippet'],
    ['cleansingFeedbackReason', 'Reason'],
    ['cleansingFeedbackDate', 'Date'],
    ['cleansingFeedbackAction', 'Action'],
  ];
  for (const [key, fallback] of headers) {
    const th = document.createElement('th');
    th.textContent = getMessageOr(key, fallback);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
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
    renderReasonCell(tdReason, e.removedByReason, e.aiSummary);
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
