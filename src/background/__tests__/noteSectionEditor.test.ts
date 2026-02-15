// src/background/__tests__/noteSectionEditor.test.js
import { NoteSectionEditor } from '../noteSectionEditor.ts';

describe('NoteSectionEditor', () => {
  describe('insertIntoSection', () => {
    it('should create new section when header does not exist', () => {
      const result = NoteSectionEditor.insertIntoSection(
        'Existing content\n',
        '# 🌐 ブラウザ閲覧履歴',
        'New entry'
      );

      expect(result).toContain('# 🌐 ブラウザ閲覧履歴');
      expect(result).toContain('New entry');
    });

    it('should insert content under existing section header', () => {
      const existing = '# 🌐 ブラウザ閲覧履歴\n- Old entry\n\n## Other Section';
      const result = NoteSectionEditor.insertIntoSection(
        existing,
        '# 🌐 ブラウザ閲覧履歴',
        '- New entry'
      );

      const lines = result.split('\n');
      const historyIndex = lines.findIndex(l => l.includes('ブラウザ閲覧履歴'));
      const newIndex = lines.findIndex(l => l === '- New entry');
      const otherIndex = lines.findIndex(l => l === '## Other Section');

      expect(historyIndex).toBeLessThan(newIndex);
      expect(newIndex).toBeLessThan(otherIndex);
    });

    it('should handle empty content with new section', () => {
      const result = NoteSectionEditor.insertIntoSection(
        '',
        '# 🌐 ブラウザ閲覧履歴',
        'First entry'
      );

      expect(result).toContain('# 🌐 ブラウザ閲覧履歴');
      expect(result).toContain('First entry');
    });
  });
});