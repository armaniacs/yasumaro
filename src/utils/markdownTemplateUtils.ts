/**
 * markdownTemplateUtils.ts
 * ローカル Markdown 書き出しテンプレート管理ユーティリティ
 */

import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from './types.js';

export type { MarkdownExportTemplate, MarkdownTemplateEntryData } from './types.js';

/** エントリテンプレートで使用可能なプレースホルダー */
const ENTRY_PLACEHOLDER_KEYS: ReadonlySet<string> = new Set([
  'timestamp',
  'title',
  'url',
  'summary',
  'tags',
  'domain',
]);

/** ファイルテンプレートで使用可能なプレースホルダー(entries は別扱い) */
const FILE_PLACEHOLDER_KEYS: ReadonlySet<string> = new Set(['date', 'entryCount']);

/**
 * デフォルトの Markdown 書き出しテンプレート
 * 現行のハードコード出力形式(# date 見出し + `- HH:MM [title](url)` 行)を再現する。
 * 固定 ID を持ち、削除・編集は不可。
 */
export const DEFAULT_MARKDOWN_TEMPLATE: MarkdownExportTemplate = {
  id: 'default',
  name: 'Default',
  fileTemplate: '# {{date}}\n\n{{entries}}',
  entryTemplate: '- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}}{{summary}}',
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
    if (ENTRY_PLACEHOLDER_KEYS.has(key)) {
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
  return Array.from(matches, m => m[1]).filter((v): v is string => v !== undefined);
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
  for (const key of fileKeys) {
    if (!FILE_PLACEHOLDER_KEYS.has(key) && key !== 'entries') {
      errors.push(`Unknown placeholder in fileTemplate: {{${key}}}`);
    }
  }

  const entryKeys = extractPlaceholderKeys(template.entryTemplate);
  for (const key of entryKeys) {
    if (!ENTRY_PLACEHOLDER_KEYS.has(key)) {
      errors.push(`Unknown placeholder in entryTemplate: {{${key}}}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 一意のテンプレートIDを生成する
 */
function generateTemplateId(): string {
  return `mdtpl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 新しい Markdown 書き出しテンプレートを作成する
 * @param data id/createdAt/updatedAt/isDefault を除くテンプレートデータ
 * @returns 作成されたテンプレート(isDefault: false 固定)
 */
export function createTemplate(
  data: Omit<MarkdownExportTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isDefault'>
): MarkdownExportTemplate {
  const now = Date.now();
  return {
    ...data,
    id: generateTemplateId(),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * テンプレートを更新する。isDefault: true のテンプレートは更新を拒否する。
 * @param templates テンプレート配列
 * @param id 更新対象のID
 * @param updates 更新内容
 * @returns 更新後のテンプレート配列
 */
export function updateTemplate(
  templates: MarkdownExportTemplate[],
  id: string,
  updates: Partial<MarkdownExportTemplate>
): MarkdownExportTemplate[] {
  return templates.map(t => {
    if (t.id === id && !t.isDefault) {
      return { ...t, ...updates, updatedAt: Date.now() };
    }
    return t;
  });
}

/**
 * テンプレートを削除する。isDefault: true のテンプレートは削除を拒否する。
 * @param templates テンプレート配列
 * @param id 削除対象のID
 * @returns 削除後のテンプレート配列
 */
export function deleteTemplate(templates: MarkdownExportTemplate[], id: string): MarkdownExportTemplate[] {
  return templates.filter(t => !(t.id === id && !t.isDefault));
}

/**
 * アクティブなテンプレートを取得する。該当がなければデフォルトテンプレートを返す。
 * @param templates テンプレート配列
 * @param activeId アクティブなテンプレートID(未設定なら undefined)
 * @returns アクティブなテンプレート、またはデフォルトテンプレート
 */
export function getActiveTemplate(
  templates: MarkdownExportTemplate[],
  activeId: string | undefined
): MarkdownExportTemplate {
  if (activeId) {
    const found = templates.find(t => t.id === activeId);
    if (found) return found;
  }
  return DEFAULT_MARKDOWN_TEMPLATE;
}

/**
 * URLからホスト名を抽出する。無効なURLは空文字を返す。
 * @param url 対象のURL文字列
 * @returns ホスト名、または空文字
 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
