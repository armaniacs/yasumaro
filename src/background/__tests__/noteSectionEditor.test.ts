// src/background/__tests__/noteSectionEditor.test.js
import { NoteSectionEditor } from '../noteSectionEditor.js';

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

    it('should add newline before section when content does not end with newline', () => {
      const result = NoteSectionEditor.insertIntoSection(
        'Existing content', // no trailing newline
        '# 🌐 ブラウザ閲覧履歴',
        'New entry'
      );

      // The function should ensure content ends with newline
      expect(result).toBe('Existing content\n# 🌐 ブラウザ閲覧履歴\nNew entry\n');
    });

    // PBI 2026-09-25-13: dedupe is opt-in and only the offline replay path
    // sets it — the default keeps the historical "always insert" behavior.
    describe('dedupe option (offline replay idempotency)', () => {
      it('skips insertion when the section already contains the identical block', () => {
        const existing = '# 🌐 ブラウザ閲覧履歴\n- [Page](https://example.com)\n- Old entry';
        const entry = '- [Page](https://example.com)';

        const result = NoteSectionEditor.insertIntoSection(existing, '# 🌐 ブラウザ閲覧履歴', entry, { dedupe: true });

        expect(result).toBe(existing);
        expect(result.split('- [Page](https://example.com)').length - 1).toBe(1);
      });

      it('still inserts when dedupe is not set (historical behavior)', () => {
        const existing = '# 🌐 ブラウザ閲覧履歴\n- [Page](https://example.com)';

        const result = NoteSectionEditor.insertIntoSection(existing, '# 🌐 ブラウザ閲覧履歴', '- [Page](https://example.com)');

        expect(result).not.toBe(existing);
        expect(result.split('- [Page](https://example.com)').length - 1).toBe(2);
      });

      it('inserts when the section contains a different block', () => {
        const existing = '# 🌐 ブラウザ閲覧履歴\n- [Other page](https://other.example)';

        const result = NoteSectionEditor.insertIntoSection(existing, '# 🌐 ブラウザ閲覧履歴', '- [Page](https://example.com)', { dedupe: true });

        expect(result).toContain('- [Page](https://example.com)');
        expect(result).toContain('- [Other page](https://other.example)');
      });

      it('inserts when only a partial line match exists', () => {
        const existing = '# 🌐 ブラウザ閲覧履歴\n- [Page](https://example.com) with extra';

        const result = NoteSectionEditor.insertIntoSection(existing, '# 🌐 ブラウザ閲覧履歴', '- [Page](https://example.com)', { dedupe: true });

        expect(result.split('- [Page](https://example.com)').length - 1).toBe(2);
      });

      it('does not match a block that spans across the section boundary', () => {
        const existing = '# 🌐 ブラウザ閲覧履歴\n- entry\n## Next\n- [Page](https://example.com)';

        const result = NoteSectionEditor.insertIntoSection(existing, '# 🌐 ブラウザ閲覧履歴', '- [Page](https://example.com)', { dedupe: true });

        expect(result).toContain('- [Page](https://example.com)');
      });

      it('creates the section normally when the header is missing, even with dedupe', () => {
        const result = NoteSectionEditor.insertIntoSection('', '# 🌐 ブラウザ閲覧履歴', '- Entry', { dedupe: true });

        expect(result).toBe('# 🌐 ブラウザ閲覧履歴\n- Entry\n');
      });
    });
  });
});