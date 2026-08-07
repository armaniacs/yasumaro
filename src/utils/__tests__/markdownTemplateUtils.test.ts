/**
 * markdownTemplateUtils.test.ts
 * markdownTemplateUtils.ts の単体テスト
 */

import {
  DEFAULT_MARKDOWN_TEMPLATE,
  renderEntryTemplate,
  renderFileTemplate,
} from '../markdownTemplateUtils.js';
import type { MarkdownTemplateEntryData } from '../types.js';

describe('markdownTemplateUtils', () => {
  describe('DEFAULT_MARKDOWN_TEMPLATE', () => {
    it('固定IDを持ち isDefault が true である', () => {
      expect(DEFAULT_MARKDOWN_TEMPLATE.id).toBe('default');
      expect(DEFAULT_MARKDOWN_TEMPLATE.isDefault).toBe(true);
    });

    it('現行のハードコード形式を再現するテンプレート文字列を持つ', () => {
      expect(DEFAULT_MARKDOWN_TEMPLATE.fileTemplate).toBe('# {{date}}\n\n{{entries}}');
      expect(DEFAULT_MARKDOWN_TEMPLATE.entryTemplate).toBe(
        '- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}} {{summary}}'
      );
    });
  });

  describe('renderEntryTemplate', () => {
    const entry: MarkdownTemplateEntryData = {
      timestamp: '10:30',
      title: 'Example Title',
      url: 'https://example.com',
      summary: 'This is a summary.',
      tags: '#tech',
      domain: 'example.com',
    };

    it('すべてのプレースホルダーを対応する値に置換する', () => {
      const result = renderEntryTemplate(DEFAULT_MARKDOWN_TEMPLATE.entryTemplate, entry);
      expect(result).toBe('- 10:30 [Example Title](https://example.com)\n    - #tech This is a summary.');
    });

    it('domain プレースホルダーを置換できる', () => {
      const result = renderEntryTemplate('{{domain}}', entry);
      expect(result).toBe('example.com');
    });

    it('未定義のプレースホルダーは空文字列に置換される', () => {
      const result = renderEntryTemplate('{{unknown}}', entry);
      expect(result).toBe('');
    });
  });

  describe('renderFileTemplate', () => {
    const entries: MarkdownTemplateEntryData[] = [
      {
        timestamp: '09:00',
        title: 'First',
        url: 'https://a.example.com',
        summary: 'Summary A',
        tags: '',
        domain: 'a.example.com',
      },
      {
        timestamp: '10:00',
        title: 'Second',
        url: 'https://b.example.com',
        summary: 'Summary B',
        tags: '#tag',
        domain: 'b.example.com',
      },
    ];

    it('date と entryCount と entries を展開してファイル全体を組み立てる', () => {
      const result = renderFileTemplate(DEFAULT_MARKDOWN_TEMPLATE, entries, '2026-08-07');
      expect(result).toBe(
        '# 2026-08-07\n\n' +
        '- 09:00 [First](https://a.example.com)\n    -  Summary A\n\n' +
        '- 10:00 [Second](https://b.example.com)\n    - #tag Summary B'
      );
    });

    it('entryCount プレースホルダーを件数に置換する', () => {
      const template = { ...DEFAULT_MARKDOWN_TEMPLATE, fileTemplate: '{{entryCount}} entries\n{{entries}}' };
      const result = renderFileTemplate(template, entries, '2026-08-07');
      expect(result.startsWith('2 entries\n')).toBe(true);
    });

    it('エントリが0件でも空文字列を entries に展開する', () => {
      const result = renderFileTemplate(DEFAULT_MARKDOWN_TEMPLATE, [], '2026-08-07');
      expect(result).toBe('# 2026-08-07\n\n');
    });
  });
});
