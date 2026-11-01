import { tOrKey as t } from '../../../utils/i18n.js';
import { escapeHtml } from '../../../utils/htmlEscape.js';
import { escapeCssSelector } from '../../../utils/cssUtils.js';
import { setElementHtml } from '../../../utils/htmlFragment.js';
import type { createClauseEditor } from './collectionClauseEditor.js';

export type ClauseEditor = ReturnType<typeof createClauseEditor>;
export type ClauseEditorChangeKind = 'draft' | 'structure' | 'refresh';

export interface ClauseEditorViewCallbacks {
  onDraftChange: (kind: ClauseEditorChangeKind) => void;
  onStructureChange: (kind: ClauseEditorChangeKind) => void;
}

function rowHtml(index: number, row: { search: string; tag: string | null; date: string | null }, countText: string): string {
  return `<div class="clause-row" data-clause-index="${index}">`
    + `<input type="text" class="clause-search" data-clause-field="search" value="${escapeHtml(row.search)}" aria-label="${escapeHtml(t('savedCollectionCondSearch'))}" />`
    + `<input type="text" class="clause-tag" data-clause-field="tag" value="${escapeHtml(row.tag ?? '')}" aria-label="${escapeHtml(t('savedCollectionCondTag'))}" />`
    + `<input type="date" class="clause-date" data-clause-field="date" value="${escapeHtml(row.date ?? '')}" aria-label="${escapeHtml(t('savedCollectionCondDate'))}" />`
    + `<span class="clause-count" role="status">${escapeHtml(countText)}</span>`
    + `<button type="button" class="secondary-btn" data-clause-action="remove" aria-label="${escapeHtml(t('collectionClauseRemoveRow'))}">${escapeHtml(t('collectionClauseRemoveRow'))}</button>`
    + `</div>`;
}

export function renderClauseEditorView(
  container: HTMLElement,
  editor: ClauseEditor,
  callbacks: ClauseEditorViewCallbacks,
  regionId: string,
): void {
  const region = container.querySelector(`#${escapeCssSelector(regionId)}`);
  if (!(region instanceof HTMLElement)) return;
  const op = editor.getOp();
  const rows = editor.getClauses().map((row, i) => rowHtml(i, row, '')).join('');
  setElementHtml(region, `<div class="clause-editor">`
    + `<div class="clause-op" role="radiogroup" aria-label="${escapeHtml(t('collectionClauseOpLabel'))}">`
    + `<label><input type="radio" name="clause-op" value="and"${op === 'and' ? ' checked' : ''} />AND</label>`
    + `<label><input type="radio" name="clause-op" value="or"${op === 'or' ? ' checked' : ''} />OR</label>`
    + `</div>`
    + `<div class="clause-rows">${rows}</div>`
    + `<button type="button" class="secondary-btn" data-clause-action="add">${escapeHtml(t('collectionClauseAddRow'))}</button>`
    + `<div class="clause-preview"><span class="clause-preview-text" role="status"></span>`
    + `<button type="button" class="secondary-btn" data-clause-action="refresh">${escapeHtml(t('collectionClausePreview'))}</button></div>`
    + `</div>`);

  region.querySelectorAll<HTMLInputElement>('.clause-row input').forEach((input) => {
    input.addEventListener('input', () => {
      const rowEl = input.closest('.clause-row');
      const index = Number(rowEl?.getAttribute('data-clause-index'));
      if (!Number.isInteger(index)) return;
      const field = input.getAttribute('data-clause-field');
      const value = input.value;
      if (field === 'search') editor.updateRow(index, { search: value });
      else if (field === 'tag') editor.updateRow(index, { tag: value === '' ? null : value });
      else if (field === 'date') editor.updateRow(index, { date: value === '' ? null : value });
      callbacks.onDraftChange('draft');
    });
  });
  region.querySelectorAll<HTMLInputElement>('input[name="clause-op"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      editor.setOp(radio.value === 'or' ? 'or' : 'and');
      callbacks.onStructureChange('structure');
    });
  });
  region.querySelectorAll<HTMLButtonElement>('[data-clause-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.getAttribute('data-clause-action');
      if (action === 'add') {
        editor.addRow();
        callbacks.onStructureChange('structure');
        (region.querySelector('.clause-row:last-child .clause-search') as HTMLInputElement | null)?.focus();
        return;
      }
      if (action === 'refresh') {
        callbacks.onStructureChange('refresh');
        return;
      }
      if (action === 'remove') {
        const rowEl = button.closest('.clause-row');
        const index = Number(rowEl?.getAttribute('data-clause-index'));
        if (!Number.isInteger(index)) return;
        editor.removeRow(index);
        callbacks.onStructureChange('structure');
      }
    });
  });
}
