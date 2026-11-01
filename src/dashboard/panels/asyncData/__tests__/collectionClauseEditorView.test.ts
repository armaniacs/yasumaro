// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClauseEditor } from '../collectionClauseEditor.js';
import { renderClauseEditorView } from '../collectionClauseEditorView.js';

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
});
