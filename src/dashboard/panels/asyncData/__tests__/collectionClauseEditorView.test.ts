// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClauseEditor } from '../collectionClauseEditor.js';
import { renderClauseEditorView } from '../collectionClauseEditorView.js';
import { formatLocalDate } from '../../../../utils/localDate.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(editor: ReturnType<typeof createClauseEditor>, onChange = vi.fn()): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = '<div id="test-editor-region"></div>';
  document.body.appendChild(container);
  renderClauseEditorView(container, editor, { onDraftChange: onChange, onStructureChange: onChange }, 'test-editor-region');
  return container;
}

describe('renderClauseEditorView', () => {
  describe('rendering', () => {
    it('paints one row per clause with search, tag and date inputs', () => {
      const editor = createClauseEditor();
      const container = mount(editor);
      expect(container.querySelectorAll('.clause-row')).toHaveLength(1);
      expect(container.querySelector('.clause-search')).not.toBeNull();
      expect(container.querySelector('.clause-tag')).not.toBeNull();
      expect(container.querySelector('.clause-date')).not.toBeNull();
    });
    it('shows a non-empty placeholder on each clause input', () => {
      const editor = createClauseEditor();
      const container = mount(editor);
      const search = container.querySelector('.clause-search') as HTMLInputElement;
      const tag = container.querySelector('.clause-tag') as HTMLInputElement;
      const date = container.querySelector('.clause-date') as HTMLInputElement;
      expect(search.getAttribute('placeholder')).toBeTruthy();
      expect(tag.getAttribute('placeholder')).toBeTruthy();
      expect(date.getAttribute('placeholder')).toBeTruthy();
    });
  });
  describe('editing', () => {
    it('typing in the search box updates the editor without rerender', () => {
      const editor = createClauseEditor();
      const onChange = vi.fn();
      const container = mount(editor, onChange);
      const input = container.querySelector('.clause-search') as HTMLInputElement;
      input.value = 'AI';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(editor.getClauses()[0]?.search).toBe('AI');
      expect(onChange).toHaveBeenCalledWith('draft');
      expect(container.querySelector('.clause-search')).toBe(input);
    });
    it('removing the only row resets to an empty row', () => {
      const editor = createClauseEditor();
      const container = mount(editor);
      (container.querySelector('[data-clause-action="remove"]') as HTMLButtonElement).click();
      expect(editor.getClauses()).toHaveLength(1);
      expect(container.querySelectorAll('.clause-row')).toHaveLength(1);
    });
    it('moves focus into a search box after adding a row', () => {
      const editor = createClauseEditor();
      const container = mount(editor);
      (container.querySelector('[data-clause-action="add"]') as HTMLButtonElement).click();
      expect(document.activeElement).toBe(container.querySelector('.clause-row:last-child .clause-search'));
    });
  });
  describe('focus preservation', () => {
    function mountWithRerender(editor: ReturnType<typeof createClauseEditor>): HTMLElement {
      const container = document.createElement('div');
      container.innerHTML = '<div id="test-editor-region"></div>';
      document.body.appendChild(container);
      const callbacks = {
        onDraftChange: vi.fn(),
        onStructureChange: (): void => {
          renderClauseEditorView(container, editor, callbacks, 'test-editor-region');
        },
      };
      renderClauseEditorView(container, editor, callbacks, 'test-editor-region');
      return container;
    }
    it('keeps focus on the same row+field across an op-change rerender', () => {
      const editor = createClauseEditor();
      editor.addRow();
      const container = mountWithRerender(editor);
      const search = container.querySelector(
        '.clause-row[data-clause-index="0"] [data-clause-field="search"]',
      ) as HTMLInputElement;
      search.focus();
      const opOr = container.querySelector('input[name="clause-op"][value="or"]') as HTMLInputElement;
      opOr.dispatchEvent(new Event('change', { bubbles: true }));
      const next = container.querySelector(
        '.clause-row[data-clause-index="0"] [data-clause-field="search"]',
      ) as HTMLInputElement;
      expect(next).not.toBe(search);
      expect(document.activeElement).toBe(next);
    });
    it('falls back to a visible control after the focused remove button is gone', () => {
      const editor = createClauseEditor();
      editor.addRow();
      const container = mountWithRerender(editor);
      const remove = container.querySelector(
        '.clause-row[data-clause-index="1"] [data-clause-action="remove"]',
      ) as HTMLButtonElement;
      remove.focus();
      remove.click();
      expect(editor.getClauses()).toHaveLength(1);
      expect(document.activeElement).toBe(container.querySelector('[data-clause-action="add"]'));
    });
  });
  describe('today preset', () => {
    it('renders the today preset button at the top of the editor', () => {
      const editor = createClauseEditor();
      const container = mount(editor);
      const preset = container.querySelector('[data-clause-action="preset-today"]') as HTMLButtonElement;
      expect(preset).not.toBeNull();
      expect(preset.textContent).toBeTruthy();
      const editorEl = container.querySelector('.clause-editor');
      expect(editorEl?.firstElementChild?.querySelector('[data-clause-action="preset-today"]')).not.toBeNull();
    });
    it('injects a single today clause into an empty editor', () => {
      const editor = createClauseEditor();
      const onChange = vi.fn();
      const container = mount(editor, onChange);
      (container.querySelector('[data-clause-action="preset-today"]') as HTMLButtonElement).click();
      expect(editor.getClauses()).toEqual([{ search: '', tag: null, date: formatLocalDate(new Date()) }]);
      expect(editor.getOp()).toBe('and');
      expect(onChange).toHaveBeenCalledWith('structure');
    });
    it('replaces existing conditions instead of appending', () => {
      const editor = createClauseEditor();
      editor.updateRow(0, { search: 'AI' });
      editor.addRow();
      const container = mount(editor);
      (container.querySelector('[data-clause-action="preset-today"]') as HTMLButtonElement).click();
      expect(editor.getClauses()).toHaveLength(1);
      expect(editor.getClauses()[0]).toEqual({ search: '', tag: null, date: formatLocalDate(new Date()) });
    });
  });
});
