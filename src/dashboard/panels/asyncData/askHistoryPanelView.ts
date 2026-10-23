/**
 * askHistoryPanelView.ts
 *
 * Ask-history region of the SQLite history panel (PBI 2026-10-23-08).
 * 履歴に聞く: a question, a target collection, and the answer with citation
 * links back to the original records. Region-scoped render entry — same
 * contract as renderSavedCollectionsRegion: the shell placeholder
 * `<div id="sqlite-ask-history">` is owned by buildPanelShellHtml (its id
 * lives in SQLITE_HISTORY_IDS, the sole owner of every panel DOM id); this
 * module fills it. The Panel owns the gateway call; this module owns markup,
 * labels and the answer paint.
 */

import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import { SQLITE_HISTORY_IDS } from './sqliteHistoryPanelView.js';
import type { SavedCollection } from '../../../utils/storage/savedCollections.js';

/** One citation the answer links back to (BDD: 元記録に飛べる). */
export interface AskCitation {
  id: number;
  title: string;
  url: string;
  snippet: string;
}

/** Outcome of one ask run, as the Panel normalizes it from the wire. */
export interface AskRunResult {
  ok: boolean;
  error?: string;
  status?: 'answered' | 'no_evidence';
  answer?: string;
  suggestion?: string;
  citations?: AskCitation[];
}

/** Event bundle the Panel builds once and hands to the region renderer. */
export interface AskHistoryRegionActions {
  /** Ask one question; the Panel owns the gateway call and timeout mapping. */
  onAsk: (question: string, collectionId: string | null) => Promise<AskRunResult>;
}

function buildRegionInnerHtml(collections: Record<string, SavedCollection>): string {
  const entries = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt);
  const options = [`<option value="">${escapeHtml(t('askHistoryTargetAll'))}</option>`]
    .concat(entries.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`))
    .join('');
  return `<div class="ask-history-section">
    <h4 data-i18n="askHistoryLabel">${escapeHtml(t('askHistoryLabel'))}</h4>
    <p class="ask-history-help" data-i18n="askHistoryHelp">${escapeHtml(t('askHistoryHelp'))}</p>
    <div class="ask-history-input">
      <select class="ask-history-target" aria-label="${escapeHtml(t('askHistoryTargetLabel'))}">${options}</select>
      <input type="text" class="ask-history-question"
        placeholder="${escapeHtml(t('askHistoryQuestionPlaceholder'))}"
        aria-label="${escapeHtml(t('askHistoryQuestionPlaceholder'))}" />
      <button type="button" class="secondary-btn" data-ask-action="ask">${escapeHtml(t('askHistoryAskBtn'))}</button>
    </div>
    <div class="ask-history-status" role="status" aria-live="polite"></div>
    <div class="ask-history-answer" role="region" aria-live="polite"></div>
  </div>`;
}

/**
 * Region-scoped render entry for the ask-history region. The shell
 * placeholder is owned by buildPanelShellHtml; this function fills it and
 * wires the ask control. Answer/status are painted by the show/hide helpers
 * below and survive until the next wholesale re-render.
 */
export function renderAskHistoryRegion(
  container: HTMLElement,
  collections: Record<string, SavedCollection>,
  actions: AskHistoryRegionActions,
): void {
  const region = container.querySelector(`#${SQLITE_HISTORY_IDS.askHistory}`);
  if (!(region instanceof HTMLElement)) return;

  setElementHtml(region, buildRegionInnerHtml(collections));

  const askButton = region.querySelector<HTMLButtonElement>('[data-ask-action="ask"]');
  const questionInput = region.querySelector<HTMLInputElement>('.ask-history-question');
  const targetSelect = region.querySelector<HTMLSelectElement>('.ask-history-target');
  if (!askButton || !questionInput) return;

  askButton.addEventListener('click', () => {
    void (async () => {
      const question = questionInput.value.trim();
      if (question === '') return;
      const collectionId = targetSelect?.value ?? '';
      const label = askButton.textContent;
      askButton.disabled = true;
      askButton.textContent = t('processing') || '処理中...';
      clearAskAnswer(region);
      showAskStatus(region, t('askHistoryBusy'));
      try {
        const result = await actions.onAsk(question, collectionId === '' ? null : collectionId);
        if (!result.ok) {
          clearAskAnswer(region);
          showAskStatus(region, result.error ?? t('askHistoryFailed'));
          return;
        }
        if (result.status === 'no_evidence') {
          clearAskAnswer(region);
          showAskStatus(region, result.suggestion ?? t('askHistoryNoEvidence'));
          return;
        }
        clearAskStatus(region);
        showAskAnswer(region, result.answer ?? '', result.citations ?? []);
      } catch (error) {
        clearAskAnswer(region);
        showAskStatus(region, error instanceof Error ? error.message : t('askHistoryFailed'));
      } finally {
        askButton.disabled = false;
        askButton.textContent = label;
      }
    })();
  });
}

function statusEl(region: ParentNode): HTMLElement | null {
  return region.querySelector<HTMLElement>('.ask-history-status');
}

function answerEl(region: ParentNode): HTMLElement | null {
  return region.querySelector<HTMLElement>('.ask-history-answer');
}

/** Paints the busy / failure / suggestion line (縮退の理由表示). */
export function showAskStatus(region: ParentNode, message: string): void {
  const el = statusEl(region);
  if (el) el.textContent = message;
}

export function clearAskStatus(region: ParentNode): void {
  const el = statusEl(region);
  if (el) el.textContent = '';
}

/**
 * Paints the answer with its citations. Each citation links back to the
 * original record (元記録に飛べる) — the snippet is the cleansed text, shown
 * as the quote the answer was built from.
 */
export function showAskAnswer(region: ParentNode, answer: string, citations: AskCitation[]): void {
  const el = answerEl(region);
  if (!el) return;
  const links = citations
    .map(
      (c) =>
        `<div class="ask-citation-row">
          <a href="${escapeHtml(c.url)}" class="ask-citation-link" data-entry-id="${c.id}"
            target="_blank" rel="noopener noreferrer">${escapeHtml(c.title)}</a>
          <div class="ask-citation-snippet">${escapeHtml(c.snippet)}</div>
        </div>`,
    )
    .join('');
  setElementHtml(el, `
    <div class="ask-answer-text">${escapeHtml(answer)}</div>
    <div class="ask-citations">${links}</div>`);
}

export function clearAskAnswer(region: ParentNode): void {
  const el = answerEl(region);
  if (el) setElementHtml(el, '');
}
