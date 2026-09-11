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
  getActiveTemplate,
} from '../markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../types.js';

describe('markdownTemplateUtils', () => {
  describe('DEFAULT_MARKDOWN_TEMPLATE', () => {
    it('has a fixed id with isDefault true', () => {
      expect(DEFAULT_MARKDOWN_TEMPLATE.id).toBe('default');
      expect(DEFAULT_MARKDOWN_TEMPLATE.isDefault).toBe(true);
    });

    it('holds template strings reproducing the current hardcoded format', () => {
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

    it('replaces every placeholder with its value', () => {
      const result = renderEntryTemplate(DEFAULT_MARKDOWN_TEMPLATE.entryTemplate, entry);
      expect(result).toBe('- 10:30 [Example Title](https://example.com)\n    - #tech This is a summary.');
    });

    it('replaces the domain placeholder', () => {
      const result = renderEntryTemplate('{{domain}}', entry);
      expect(result).toBe('example.com');
    });

    it('replaces unknown placeholders with an empty string', () => {
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

    it('expands date, entryCount and entries to build the whole file', () => {
      const result = renderFileTemplate(DEFAULT_MARKDOWN_TEMPLATE, entries, '2026-08-07');
      expect(result).toBe(
        '# 2026-08-07\n\n' +
        '- 09:00 [First](https://a.example.com)\n    - Summary A\n\n' +
        '- 10:00 [Second](https://b.example.com)\n    - #tag Summary B'
      );
    });

    it('replaces the entryCount placeholder with the entry count', () => {
      const template = { ...DEFAULT_MARKDOWN_TEMPLATE, fileTemplate: '{{entryCount}} entries\n{{entries}}' };
      const result = renderFileTemplate(template, entries, '2026-08-07');
      expect(result.startsWith('2 entries\n')).toBe(true);
    });

    it('expands entries to an empty string when there are zero entries', () => {
      const result = renderFileTemplate(DEFAULT_MARKDOWN_TEMPLATE, [], '2026-08-07');
      expect(result).toBe('# 2026-08-07\n\n');
    });

    it('Fix 3: renders exactly one space before summary for entries without tags (prevents double-space regression)', () => {
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
    it('judges the default template as valid', () => {
      const result = validateTemplate(DEFAULT_MARKDOWN_TEMPLATE);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('judges fileTemplate without {{entries}} as invalid', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        fileTemplate: '# {{date}}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('fileTemplate must include {{entries}}');
    });

    it('judges fileTemplate with an unknown placeholder as invalid', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        fileTemplate: '# {{date}}\n{{unknown}}\n{{entries}}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown placeholder in fileTemplate: {{unknown}}');
    });

    it('judges entryTemplate with an unknown placeholder as invalid', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        entryTemplate: '{{unknown}} {{title}}',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown placeholder in entryTemplate: {{unknown}}');
    });

    it('returns all errors when there are multiple', () => {
      const result = validateTemplate({
        ...DEFAULT_MARKDOWN_TEMPLATE,
        fileTemplate: '{{bad1}}',
        entryTemplate: '{{bad2}}',
      });
      expect(result.errors).toHaveLength(3); // entries欠如 + fileTemplate未知 + entryTemplate未知
    });
  });

  describe('createTemplate', () => {
    it('auto-assigns id, createdAt and updatedAt with isDefault false', () => {
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

    it('updates the template with the given id', () => {
      const result = updateTemplate([custom], 'custom-1', { name: 'Renamed' });
      expect(result[0]!.name).toBe('Renamed');
      expect(result[0]!.updatedAt).toBeGreaterThanOrEqual(custom.updatedAt);
    });

    it('refuses to update the default template (isDefault: true) and returns it unchanged', () => {
      const result = updateTemplate([DEFAULT_MARKDOWN_TEMPLATE], 'default', { name: 'Hacked' });
      expect(result[0]!.name).toBe(DEFAULT_MARKDOWN_TEMPLATE.name);
    });
  });

  describe('deleteTemplate', () => {
    it('deletes the template with the given id', () => {
      const custom: MarkdownExportTemplate = { ...DEFAULT_MARKDOWN_TEMPLATE, id: 'custom-1', isDefault: false };
      const result = deleteTemplate([custom], 'custom-1');
      expect(result).toHaveLength(0);
    });

    it('refuses to delete the default template (isDefault: true)', () => {
      const result = deleteTemplate([DEFAULT_MARKDOWN_TEMPLATE], 'default');
      expect(result).toHaveLength(1);
    });
  });

  describe('getActiveTemplate', () => {
    it('returns the active template id when one is set', () => {
      const templates = [DEFAULT_MARKDOWN_TEMPLATE, { ...DEFAULT_MARKDOWN_TEMPLATE, id: 'custom-1', isDefault: false }];
      const active = getActiveTemplate(templates, 'custom-1');
      expect(active?.id).toBe('custom-1');
    });

    it('returns the default template when the active id is unset or unmatched', () => {
      const templates = [DEFAULT_MARKDOWN_TEMPLATE];
      expect(getActiveTemplate(templates, undefined).id).toBe('default');
      expect(getActiveTemplate(templates, 'not-exist').id).toBe('default');
    });

    it('returns the default template when the template list is empty', () => {
      expect(getActiveTemplate([], undefined).id).toBe('default');
    });
  });
});
