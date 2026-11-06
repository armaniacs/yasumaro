import { describe, it, expect } from 'vitest';
import { buildTodayPresetQuery, createClauseEditor } from '../collectionClauseEditor.js';

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
  describe('buildTodayPresetQuery', () => {
    it('builds a single-day date clause for the given local day', () => {
      expect(buildTodayPresetQuery(new Date(2026, 10, 2, 12, 0, 0))).toEqual({
        version: 2,
        op: 'and',
        clauses: [{ search: '', tag: null, date: '2026-11-02' }],
      });
    });
    it('replaces existing clauses instead of appending', () => {
      const editor = createClauseEditor();
      editor.updateRow(0, { search: 'AI', tag: 'rust' });
      editor.addRow();
      editor.updateRow(1, { search: '要約' });
      editor.loadSaved(buildTodayPresetQuery(new Date(2026, 10, 2, 12, 0, 0)));
      expect(editor.getClauses()).toEqual([{ search: '', tag: null, date: '2026-11-02' }]);
      expect(editor.getOp()).toBe('and');
    });
  });
});
