import { describe, it, expect } from 'vitest';
import { createClauseEditor } from '../collectionClauseEditor.js';

describe('collectionClauseEditor', () => {
  describe('createClauseEditor', () => {
    it('starts with one empty row and and-op', () => {
      const editor = createClauseEditor();
      expect(editor.getClauses()).toEqual([{ search: '', tag: null, date: null }]);
      expect(editor.getOp()).toBe('and');
    });
    it('adds and removes rows without touching the others', () => {
      const editor = createClauseEditor();
      editor.addRow();
      editor.updateRow(0, { search: 'AI' });
      expect(editor.getClauses()).toHaveLength(2);
      editor.removeRow(1);
      expect(editor.getClauses()).toEqual([{ search: 'AI', tag: null, date: null }]);
    });
    it('drops empty rows when serializing', () => {
      const editor = createClauseEditor();
      editor.addRow();
      editor.updateRow(1, { search: '要約' });
      const saved = editor.toSavedQuery();
      expect(saved).toEqual({ search: '要約' });
    });
  });
});
