/**
 * markdownTemplateUtils.ts
 * ローカル Markdown 書き出しテンプレート管理ユーティリティ
 */

import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from './types.js';

export type { MarkdownExportTemplate, MarkdownTemplateEntryData } from './types.js';

/** エントリテンプレートで使用可能なプレースホルダー */
const ENTRY_PLACEHOLDER_KEYS = ['timestamp', 'title', 'url', 'summary', 'tags', 'domain'] as const;

/**
 * デフォルトの Markdown 書き出しテンプレート
 * 現行のハードコード出力形式(# date 見出し + `- HH:MM [title](url)` 行)を再現する。
 * 固定 ID を持ち、削除・編集は不可。
 */
export const DEFAULT_MARKDOWN_TEMPLATE: MarkdownExportTemplate = {
  id: 'default',
  name: 'Default',
  fileTemplate: '# {{date}}\n\n{{entries}}',
  entryTemplate: '- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}} {{summary}}',
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

/**
 * エントリテンプレートのプレースホルダーを実データで置換する
 * @param template エントリテンプレート文字列
 * @param entry 置換に使う生データ
 * @returns 置換後の文字列
 */
export function renderEntryTemplate(template: string, entry: MarkdownTemplateEntryData): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if ((ENTRY_PLACEHOLDER_KEYS as readonly string[]).includes(key)) {
      return entry[key as keyof MarkdownTemplateEntryData];
    }
    return '';
  });
}

/**
 * ファイルテンプレートに複数エントリをレンダリングした結果を差し込み、ファイル全体を組み立てる
 * @param template 使用するテンプレート(file/entry の両方を含む)
 * @param entries その日のエントリ生データ配列
 * @param date YYYY-MM-DD 形式の日付文字列
 * @returns ファイル全体の Markdown 文字列
 */
export function renderFileTemplate(
  template: MarkdownExportTemplate,
  entries: MarkdownTemplateEntryData[],
  date: string
): string {
  const renderedEntries = entries.map(e => renderEntryTemplate(template.entryTemplate, e)).join('\n\n');

  return template.fileTemplate.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key === 'date') return date;
    if (key === 'entryCount') return String(entries.length);
    if (key === 'entries') return renderedEntries;
    return '';
  });
}
