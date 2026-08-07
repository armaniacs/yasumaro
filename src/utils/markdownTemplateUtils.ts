/**
 * markdownTemplateUtils.ts
 * ローカル Markdown 書き出しテンプレート管理ユーティリティ
 */

import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from './types.js';

export type { MarkdownExportTemplate, MarkdownTemplateEntryData } from './types.js';

/** エントリテンプレートで使用可能なプレースホルダー */
const ENTRY_PLACEHOLDER_KEYS = ['timestamp', 'title', 'url', 'summary', 'tags', 'domain'] as const;

/** ファイルテンプレートで使用可能なプレースホルダー(entries は別扱い) */
const FILE_PLACEHOLDER_KEYS = ['date', 'entryCount'] as const;

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

/**
 * テンプレートのバリデーション結果
 */
export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
}

/** テンプレート文字列に含まれる {{xxx}} プレースホルダーのキー一覧を抽出する */
function extractPlaceholderKeys(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return Array.from(matches, m => m[1]);
}

/**
 * テンプレートが有効かどうかを検証する
 * - fileTemplate に {{entries}} が含まれているか(必須)
 * - fileTemplate / entryTemplate に定義済み以外のプレースホルダーが含まれていないか
 * @param template 検証対象のテンプレート
 * @returns 検証結果とエラーメッセージ一覧
 */
export function validateTemplate(template: MarkdownExportTemplate): TemplateValidationResult {
  const errors: string[] = [];

  if (!template.fileTemplate.includes('{{entries}}')) {
    errors.push('fileTemplate must include {{entries}}');
  }

  const fileKeys = extractPlaceholderKeys(template.fileTemplate);
  const allowedFileKeys = [...FILE_PLACEHOLDER_KEYS, 'entries'] as string[];
  for (const key of fileKeys) {
    if (!allowedFileKeys.includes(key)) {
      errors.push(`Unknown placeholder in fileTemplate: {{${key}}}`);
    }
  }

  const entryKeys = extractPlaceholderKeys(template.entryTemplate);
  for (const key of entryKeys) {
    if (!(ENTRY_PLACEHOLDER_KEYS as readonly string[]).includes(key)) {
      errors.push(`Unknown placeholder in entryTemplate: {{${key}}}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
