/**
 * markdownTemplateUtils.test.ts
 * markdownTemplateUtils.ts の単体テスト
 */

import {
  DEFAULT_MARKDOWN_TEMPLATE,
  renderEntryTemplate,
  renderFileTemplate,
  validateTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setActiveTemplate,
  getActiveTemplate,
} from '../markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../types.js';

describe('markdownTemplateUtils', () => {
  describe('DEFAULT_MARKDOWN_TEMPLATE', () => {
    it('固定IDを持ち isDefault が true である', () => {
      expect(DEFAULT_MARKDOWN_TEMPLATE.id).toBe('default');
      expect(DEFAULT_MARKDOWN_TEMPLATE.isDefault).toBe(true);
    });

    it('現行のハードコード形式を再現するテンプレート文字列を持つ', () => {
      expect(DEFAULT_MARKDOWN_TEMPLATE.fileTemplate).toBe('# {{date}}\n\n{{entries}}');
      expect(DEFAULT_MARKDOWN_TEMPLATE.entryTemplate).toBe(
        '- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}}{{summary}}'
      );
    });
  });

  describe('renderEntryTemplate', () => {
    const entry: MarkdownTemplateEntryData = {
      timestamp: '10:30',
      title: 'Example Title',
      url: 'https://example.com',
      summary: 'This is a summary.',
      tags: '#tech ',
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
        tags: '#tag ',
        domain: 'b.example.com',
      },
    ];

    it('date と entryCount と entries を展開してファイル全体を組み立てる', () => {
      const result = renderFileTemplate(DEFAULT_MARKDOWN_TEMPLATE, entries, '2026-08-07');
      expect(result).toBe(
        '# 2026-08-07\n\n' +
        '- 09:00 [First](https://a.example.com)\n    - Summary A\n\n' +
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

    it('最終レビュー Fix 3: タグなしエントリでは summary の前にスペースが1つだけになる(旧形式の二重スペース回帰防止)', () => {
      const entryWithEmptyTags: MarkdownTemplateEntryData = {
        timestamp: '09:00',
        title: 'No Tags',
        url: 'https://example.com',
        summary: 'summary text',
        tags: '',
        domain: 'example.com',
      };
      const result = renderFileTemplate(DEFAULT_MARKDOWN_TEMPLATE, [entryWithEmptyTags], '2026-08-07');
      expect(result).toBe('# 2026-08-07\n\n- 09:00 [No Tags](https://example.com)\n    - summary text');
      // Historical pre-branch format: "    - summary" (single space), not "    -  summary" (double space)
      expect(result).toContain('    - summary text');
      expect(result).not.toContain('    -  summary text');
    });
  });

  describe('validateTemplate', () => {
    it('デフォルトテンプレートは有効と判定される', () => {
      const result = validateTemplate(DEFAULT_MARKDOWN_TEMPLATE);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('fileTemplate に {{entries}} が含まれない場合は無効', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        fileTemplate: '# {{date}}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('fileTemplate must include {{entries}}');
    });

    it('fileTemplate に未知のプレースホルダーが含まれる場合は無効', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        fileTemplate: '# {{date}}\n{{unknown}}\n{{entries}}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown placeholder in fileTemplate: {{unknown}}');
    });

    it('entryTemplate に未知のプレースホルダーが含まれる場合は無効', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        entryTemplate: '{{unknown}} {{title}}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown placeholder in entryTemplate: {{unknown}}');
    });

    it('複数のエラーがある場合はすべて返す', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        fileTemplate: '{{bad1}}',
        entryTemplate: '{{bad2}}',
      });
      expect(result.errors).toHaveLength(3); // entries欠如 + fileTemplate未知 + entryTemplate未知
    });
  });

  describe('createTemplate', () => {
    it('id・createdAt・updatedAt を自動採番して isDefault: false で作成する', () => {
      const result = createTemplate({ name: 'My Template', fileTemplate: '{{entries}}', entryTemplate: '{{title}}' });
      expect(result.id).toBeTruthy();
      expect(result.name).toBe('My Template');
      expect(result.isDefault).toBe(false);
      expect(typeof result.createdAt).toBe('number');
      expect(typeof result.updatedAt).toBe('number');
    });
  });

  describe('updateTemplate', () => {
    const custom: MarkdownExportTemplate = {
      id: 'custom-1',
      name: 'Custom',
      fileTemplate: '{{entries}}',
      entryTemplate: '{{title}}',
      isDefault: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    it('指定IDのテンプレートを更新する', () => {
      const result = updateTemplate([custom], 'custom-1', { name: 'Renamed' });
      expect(result[0].name).toBe('Renamed');
      expect(result[0].updatedAt).toBeGreaterThanOrEqual(custom.updatedAt);
    });

    it('デフォルトテンプレート(isDefault: true)は更新を拒否し変更なしで返す', () => {
      const result = updateTemplate([DEFAULT_MARKDOWN_TEMPLATE], 'default', { name: 'Hacked' });
      expect(result[0].name).toBe(DEFAULT_MARKDOWN_TEMPLATE.name);
    });
  });

  describe('deleteTemplate', () => {
    it('指定IDのテンプレートを削除する', () => {
      const custom: MarkdownExportTemplate = { ...DEFAULT_MARKDOWN_TEMPLATE, id: 'custom-1', isDefault: false };
      const result = deleteTemplate([custom], 'custom-1');
      expect(result).toHaveLength(0);
    });

    it('デフォルトテンプレート(isDefault: true)は削除を拒否する', () => {
      const result = deleteTemplate([DEFAULT_MARKDOWN_TEMPLATE], 'default');
      expect(result).toHaveLength(1);
    });
  });

  describe('setActiveTemplate / getActiveTemplate', () => {
    it('アクティブなテンプレートIDが設定されていればそれを返す', () => {
      const templates = [DEFAULT_MARKDOWN_TEMPLATE, { ...DEFAULT_MARKDOWN_TEMPLATE, id: 'custom-1', isDefault: false }];
      const active = getActiveTemplate(templates, 'custom-1');
      expect(active?.id).toBe('custom-1');
    });

    it('アクティブIDが未指定、または一致するテンプレートがない場合はデフォルトを返す', () => {
      const templates = [DEFAULT_MARKDOWN_TEMPLATE];
      expect(getActiveTemplate(templates, undefined).id).toBe('default');
      expect(getActiveTemplate(templates, 'not-exist').id).toBe('default');
    });

    it('テンプレート一覧が空でもデフォルトを返す', () => {
      expect(getActiveTemplate([], undefined).id).toBe('default');
    });
  });
});
