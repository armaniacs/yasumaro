# ローカル Markdown 書き出しテンプレート機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカル Markdown 書き出し(自動エクスポート・ダッシュボード手動エクスポート)の出力フォーマットを、ユーザーが定義できる「ファイルテンプレート + エントリテンプレート」の2層構造でカスタマイズ可能にする。

**Architecture:** `src/utils/markdownTemplateUtils.ts` を新設し、`customPromptUtils.ts` と同じ CRUD + プレースホルダー置換パターンで `MarkdownExportTemplate` を管理する。既存の重複整形ロジック(自動エクスポート `saveLocalMarkdownStep.ts` / 手動エクスポート `dashboard.ts`)をこのユーティリティに置き換える。エントリ単位の生データ(timestamp/title/url/summary/tags/domain)は `MarkdownEntry` に保持させ、`RecordingContext` 経由で `formatMarkdownStep` → `saveLocalMarkdownStep` へ伝播させる。Obsidian送信経路(`formatMarkdownStep.ts` の `markdown` 文字列出力、`obsidianFormatter.ts`)は変更しない。

**Tech Stack:** TypeScript (ESM, `.js` import), Jest + jsdom, chrome.storage.local, chrome.downloads API

**Spec:** `docs/superpowers/specs/2026-08-07-markdown-export-template-design.md`

---

## 設計上の補足(spec からの実装詳細の具体化)

spec には「エントリテンプレートは timestamp/title/url/summary/tags/domain を使う」とあるが、現状の `saveLocalMarkdownStep.ts` はレンダリング済みの `markdown` 文字列しか受け取らない(`MarkdownEntry.markdown: string`)。テンプレート化のためには生データが必要なので、以下の変更を行う:

1. `MarkdownEntry`(`MarkdownBufferManager.ts`)に生データフィールドを追加し、レンダリング済み `markdown` の代わりに生データを保持する。
2. `RecordingContext`(`pipeline/types.ts`)に `markdownEntryData` フィールドを追加。
3. `formatMarkdownStep.ts` は Obsidian 用の `markdown` 文字列生成ロジックはそのまま維持しつつ、生データも `context.markdownEntryData` にセットする(追記のみ、既存の `markdown` 出力は変更しない)。
4. `saveLocalMarkdownStep.ts` は `context.markdown` ではなく `context.markdownEntryData` を使って `MarkdownEntry` を構築する。

この変更は Obsidian 送信の出力(`context.markdown`)には一切影響しない。

---

### Task 1: 型定義とデフォルトテンプレート定数

**Files:**
- Modify: `src/utils/types.ts`
- Test: `src/utils/__tests__/markdownTemplateUtils.test.ts`(このタスクでは型のみなのでテストは Task 2 で書く。ここでは型定義のみ行う)

- [ ] **Step 1: `MarkdownExportTemplate` 型を追加**

`src/utils/types.ts` の `CustomPrompt` インターフェースの直後に追加:

```typescript
/**
 * ローカル Markdown 書き出しテンプレートのデータ構造
 */
export interface MarkdownExportTemplate {
    id: string;
    name: string;
    fileTemplate: string;   // {{date}} {{entryCount}} {{entries}} を使用
    entryTemplate: string;  // {{timestamp}} {{title}} {{url}} {{summary}} {{tags}} {{domain}} を使用
    isDefault?: boolean;    // true の場合、編集・削除不可(組み込みデフォルト)
    createdAt: number;
    updatedAt: number;
}

/**
 * Markdown テンプレートのエントリ1件分の生データ
 */
export interface MarkdownTemplateEntryData {
    timestamp: string;
    title: string;
    url: string;
    summary: string;
    tags: string;
    domain: string;
}
```

- [ ] **Step 2: 型チェックを実行して構文エラーがないことを確認**

Run: `npm run type-check`
Expected: エラーなし(既存のエラーがあれば無視して、新規エラーが増えていないことを確認)

- [ ] **Step 3: Commit**

```bash
git add src/utils/types.ts
git commit -m "feat: MarkdownExportTemplate型を追加"
```

---

### Task 2: StorageKeys にテンプレート関連キーを追加

**Files:**
- Modify: `src/utils/storage/types.ts`

- [ ] **Step 1: `StorageKeys` に新規キーを追加**

`src/utils/storage/types.ts` の `CUSTOM_PROMPTS: 'custom_prompts', // カスタムプロンプト設定` の直後(100行目付近)に追加:

```typescript
    // Markdown export templates
    MARKDOWN_EXPORT_TEMPLATES: 'markdown_export_templates', // ローカルMarkdown書き出しテンプレート一覧
    ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID: 'active_markdown_export_template_id', // 選択中テンプレートID
```

- [ ] **Step 2: `StorageKeyValues` に対応する値型を追加**

`src/utils/storage/types.ts` の `[StorageKeys.CUSTOM_PROMPTS]: CustomPrompt[];`(318行目付近)の直後に追加:

```typescript
    [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: MarkdownExportTemplate[];
    [StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID]: string;
```

ファイル冒頭の import 文に `MarkdownExportTemplate` を追加(既存の `CustomPrompt` import と同じ場所から):

```typescript
import type { CustomPrompt, MarkdownExportTemplate } from '../types.js';
```

(既存の import 文がどう書かれているか確認し、`CustomPrompt` が import されている行に `MarkdownExportTemplate` を追加すること)

- [ ] **Step 3: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add src/utils/storage/types.ts
git commit -m "feat: MarkdownテンプレートのStorageKeysを追加"
```

---

### Task 3: `markdownTemplateUtils.ts` — デフォルトテンプレートとレンダリング関数(TDD)

**Files:**
- Create: `src/utils/markdownTemplateUtils.ts`
- Test: `src/utils/__tests__/markdownTemplateUtils.test.ts`

- [ ] **Step 1: テストファイルを作成し、デフォルトテンプレートとレンダリング関数の失敗するテストを書く**

`src/utils/__tests__/markdownTemplateUtils.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';
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
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `npx jest src/utils/__tests__/markdownTemplateUtils.test.ts`
Expected: FAIL — `Cannot find module '../markdownTemplateUtils.js'`

- [ ] **Step 3: `markdownTemplateUtils.ts` を実装(デフォルトテンプレート・レンダリング関数のみ)**

`src/utils/markdownTemplateUtils.ts`:

```typescript
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
```

- [ ] **Step 4: テストを実行して成功することを確認**

Run: `npx jest src/utils/__tests__/markdownTemplateUtils.test.ts`
Expected: PASS (全テストケース)

- [ ] **Step 5: Commit**

```bash
git add src/utils/markdownTemplateUtils.ts src/utils/__tests__/markdownTemplateUtils.test.ts
git commit -m "feat: Markdownテンプレートのレンダリング関数を追加"
```

---

### Task 4: `markdownTemplateUtils.ts` — バリデーション(TDD)

**Files:**
- Modify: `src/utils/markdownTemplateUtils.ts`
- Test: `src/utils/__tests__/markdownTemplateUtils.test.ts`

- [ ] **Step 1: バリデーションの失敗するテストを追加**

`src/utils/__tests__/markdownTemplateUtils.test.ts` の import に `validateTemplate` を追加:

```typescript
import {
  DEFAULT_MARKDOWN_TEMPLATE,
  renderEntryTemplate,
  renderFileTemplate,
  validateTemplate,
} from '../markdownTemplateUtils.js';
```

ファイル末尾の `describe('markdownTemplateUtils', ...)` ブロック内に追加:

```typescript
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
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `npx jest src/utils/__tests__/markdownTemplateUtils.test.ts`
Expected: FAIL — `validateTemplate is not a function`

- [ ] **Step 3: `validateTemplate` を実装**

`src/utils/markdownTemplateUtils.ts` の末尾に追加:

```typescript
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
```

- [ ] **Step 4: テストを実行して成功することを確認**

Run: `npx jest src/utils/__tests__/markdownTemplateUtils.test.ts`
Expected: PASS (全テストケース)

- [ ] **Step 5: Commit**

```bash
git add src/utils/markdownTemplateUtils.ts src/utils/__tests__/markdownTemplateUtils.test.ts
git commit -m "feat: Markdownテンプレートのバリデーションを追加"
```

---

### Task 5: `markdownTemplateUtils.ts` — CRUD 関数(TDD)

**Files:**
- Modify: `src/utils/markdownTemplateUtils.ts`
- Test: `src/utils/__tests__/markdownTemplateUtils.test.ts`

- [ ] **Step 1: CRUD の失敗するテストを追加**

`src/utils/__tests__/markdownTemplateUtils.test.ts` の import に追加:

```typescript
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
```

`describe('markdownTemplateUtils', ...)` ブロック内に追加:

```typescript
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
```

- [ ] **Step 2: テストを実行して失敗することを確認**

Run: `npx jest src/utils/__tests__/markdownTemplateUtils.test.ts`
Expected: FAIL — `createTemplate is not a function`(他も同様に未定義)

- [ ] **Step 3: CRUD 関数を実装**

`src/utils/markdownTemplateUtils.ts` の末尾に追加:

```typescript
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
 * アクティブなテンプレートIDを設定する(切り替えのみ。永続化は呼び出し側の責務)
 * @param _templates テンプレート配列(将来の拡張のために引数として保持)
 * @param id アクティブにするテンプレートのID
 * @returns アクティブにするテンプレートID
 */
export function setActiveTemplate(_templates: MarkdownExportTemplate[], id: string): string {
  return id;
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
```

- [ ] **Step 4: テストを実行して成功することを確認**

Run: `npx jest src/utils/__tests__/markdownTemplateUtils.test.ts`
Expected: PASS (全テストケース)

- [ ] **Step 5: Commit**

```bash
git add src/utils/markdownTemplateUtils.ts src/utils/__tests__/markdownTemplateUtils.test.ts
git commit -m "feat: MarkdownテンプレートのCRUD関数を追加"
```

---

### Task 6: `MarkdownEntry` に生データフィールドを追加し、`RecordingContext` に伝播

**Files:**
- Modify: `src/background/pipeline/buffers/MarkdownBufferManager.ts`
- Modify: `src/background/pipeline/types.ts`
- Modify: `src/background/pipeline/steps/formatMarkdownStep.ts`
- Test: `src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts`(既存テストファイルがあれば追記。なければこのタスク内で確認して対応する)

- [ ] **Step 1: 既存の `formatMarkdownStep.test.ts` の有無を確認**

Run: `find src/background/pipeline/steps -iname "*formatMarkdownStep*test*"`

既存テストファイルが見つかった場合はそのファイルに追記し、見つからなかった場合は Step 2 でテストファイルを新規作成する。

- [ ] **Step 2: `context.markdownEntryData` がセットされることを検証する失敗するテストを書く**

既存テストファイルがあればそこに追加、なければ `src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts` を新規作成:

```typescript
import { describe, it, expect } from '@jest/globals';
import { formatMarkdownStep } from '../formatMarkdownStep.js';
import type { RecordingContext } from '../../types.js';

describe('formatMarkdownStep', () => {
  it('context.markdownEntryData に生データをセットする', async () => {
    const context: RecordingContext = {
      data: { url: 'https://example.com/page', title: 'Example Page' } as never,
      settings: {} as never,
      force: false,
      privacyResult: { summary: 'A summary.', tags: ['tech', 'news'] } as never,
      errors: [],
    };

    const result = await formatMarkdownStep(context);

    expect(result.markdownEntryData).toBeDefined();
    expect(result.markdownEntryData?.title).toBe('Example Page');
    expect(result.markdownEntryData?.url).toBe('https://example.com/page');
    expect(result.markdownEntryData?.summary).toBe('A summary.');
    expect(result.markdownEntryData?.tags).toBe('#tech #news');
    expect(result.markdownEntryData?.domain).toBe('example.com');
    expect(typeof result.markdownEntryData?.timestamp).toBe('string');
  });

  it('既存の context.markdown 出力は変更されない(Obsidian用フォーマットの後方互換性)', async () => {
    const context: RecordingContext = {
      data: { url: 'https://example.com/page', title: 'Example Page' } as never,
      settings: {} as never,
      force: false,
      privacyResult: { summary: 'A summary.', tags: [] } as never,
      errors: [],
    };

    const result = await formatMarkdownStep(context);

    expect(result.markdown).toMatch(/^- \d{2}:\d{2} \[Example Page\]\(https:\/\/example\.com\/page\)\n {4}- A summary\.$/);
  });
});
```

- [ ] **Step 3: テストを実行して失敗することを確認**

Run: `npx jest src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts`
Expected: FAIL — `result.markdownEntryData` が `undefined`

- [ ] **Step 4: `RecordingContext` に `markdownEntryData` フィールドを追加**

`src/background/pipeline/types.ts` の `sanitizedSummary?: string;` の直後(82行目付近)に追加。まずファイル冒頭の import に型を追加:

```typescript
import type { MarkdownTemplateEntryData } from '../../utils/types.js';
```

そして `RecordingContext` インターフェース内、`markdown?: string;` の直後に追加:

```typescript
  markdownEntryData?: MarkdownTemplateEntryData;
```

- [ ] **Step 5: `formatMarkdownStep.ts` で `context.markdownEntryData` をセットする**

`src/background/pipeline/steps/formatMarkdownStep.ts` の `return` 文を以下のように変更:

```typescript
  // Extract domain for template placeholder
  let domain = '';
  try {
    domain = new URL(sanitizedUrl).hostname;
  } catch {
    domain = '';
  }

  return {
    ...context,
    sanitizedSummary: finalSanitizedSummary,
    markdown,
    markdownEntryData: {
      timestamp,
      title: sanitizedTitle,
      url: sanitizedUrl,
      summary: finalSanitizedSummary,
      tags: tagPrefix.trim(),
      domain,
    },
  };
```

- [ ] **Step 6: テストを実行して成功することを確認**

Run: `npx jest src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts`
Expected: PASS (全テストケース)

- [ ] **Step 7: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 8: Commit**

```bash
git add src/background/pipeline/types.ts src/background/pipeline/steps/formatMarkdownStep.ts src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts
git commit -m "feat: formatMarkdownStepでMarkdownテンプレート用の生データを伝播"
```

---

### Task 7: `MarkdownEntry` を生データベースに変更し、`saveLocalMarkdownStep.ts` を統合

**Files:**
- Modify: `src/background/pipeline/buffers/MarkdownBufferManager.ts`
- Modify: `src/background/pipeline/steps/saveLocalMarkdownStep.ts`
- Test: `src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts`(既存があれば確認)

- [ ] **Step 1: 既存テストファイルの有無を確認**

Run: `find src/background/pipeline/steps -iname "*saveLocalMarkdownStep*test*"`

- [ ] **Step 2: `buildDailyMarkdown` がテンプレートを使ってレンダリングすることを検証する失敗するテストを書く**

既存テストファイルがあれば `buildDailyMarkdown` に関するテストケースを以下の内容で追記・更新、なければ `src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts` を新規作成:

```typescript
import { describe, it, expect } from '@jest/globals';
import { buildDailyMarkdown } from '../saveLocalMarkdownStep.js';
import { DEFAULT_MARKDOWN_TEMPLATE } from '../../../../utils/markdownTemplateUtils.js';
import type { MarkdownEntry } from '../buffers/MarkdownBufferManager.js';

describe('buildDailyMarkdown', () => {
  const entries: MarkdownEntry[] = [
    {
      url: 'https://a.example.com',
      title: 'First',
      visitedAt: 1000,
      entryData: { timestamp: '09:00', title: 'First', url: 'https://a.example.com', summary: 'Summary A', tags: '', domain: 'a.example.com' },
    },
    {
      url: 'https://b.example.com',
      title: 'Second',
      visitedAt: 2000,
      entryData: { timestamp: '10:00', title: 'Second', url: 'https://b.example.com', summary: 'Summary B', tags: '#tag', domain: 'b.example.com' },
    },
  ];

  it('デフォルトテンプレートで現行と同じ出力形式を生成する', () => {
    const result = buildDailyMarkdown('2026-08-07', entries, DEFAULT_MARKDOWN_TEMPLATE);
    expect(result).toBe(
      '# 2026-08-07\n\n' +
      '- 09:00 [First](https://a.example.com)\n    -  Summary A\n\n' +
      '- 10:00 [Second](https://b.example.com)\n    - #tag Summary B'
    );
  });

  it('カスタムテンプレートで異なる出力形式を生成する', () => {
    const customTemplate = {
      ...DEFAULT_MARKDOWN_TEMPLATE,
      id: 'custom',
      isDefault: false,
      fileTemplate: '## {{date}} ({{entryCount}})\n{{entries}}',
      entryTemplate: '* {{title}} - {{domain}}',
    };
    const result = buildDailyMarkdown('2026-08-07', entries, customTemplate);
    expect(result).toBe('## 2026-08-07 (2)\n* First - a.example.com\n\n* Second - b.example.com');
  });
});
```

- [ ] **Step 3: テストを実行して失敗することを確認**

Run: `npx jest src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts`
Expected: FAIL — `buildDailyMarkdown` の引数不一致、または `entryData` プロパティが `MarkdownEntry` に存在しない

- [ ] **Step 4: `MarkdownEntry` に `entryData` フィールドを追加**

`src/background/pipeline/buffers/MarkdownBufferManager.ts` の `MarkdownEntry` インターフェースを変更:

```typescript
import type { MarkdownTemplateEntryData } from '../../../utils/types.js';

export interface MarkdownEntry {
  url: string;
  title: string;
  visitedAt: number;
  entryData: MarkdownTemplateEntryData;
}
```

(`markdown: string;` フィールドを `entryData: MarkdownTemplateEntryData;` に置き換える)

- [ ] **Step 5: `buildDailyMarkdown` をテンプレート対応に変更**

`src/background/pipeline/steps/saveLocalMarkdownStep.ts` の `buildDailyMarkdown` 関数と import を変更:

```typescript
import { renderFileTemplate } from '../../../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate } from '../../../utils/types.js';

/**
 * Build complete daily markdown from accumulated entries using the given template
 */
export function buildDailyMarkdown(
  date: string,
  entries: MarkdownEntry[],
  template: MarkdownExportTemplate
): string {
  return renderFileTemplate(template, entries.map(e => e.entryData), date);
}
```

- [ ] **Step 6: `saveLocalMarkdownStep` 本体を `markdownEntryData` を使うように変更**

`src/background/pipeline/steps/saveLocalMarkdownStep.ts` の `markdownBuffer.add({...})` 呼び出し箇所を変更:

```typescript
      const markdownBuffer = new MarkdownBufferManager();

      if (!context.markdownEntryData) {
        addLog(LogType.WARN, '[LocalMD] No markdownEntryData to save locally', { url, traceId: context.traceId });
        return context;
      }

      markdownBuffer.add({
        url,
        title: title || '',
        visitedAt: Date.now(),
        entryData: context.markdownEntryData,
      });
```

- [ ] **Step 7: `flushBufferedExports` にテンプレート取得を追加**

`src/background/localMarkdownExportCore.ts` を変更。テンプレート取得ロジックを追加し、`buildDailyMarkdown` 呼び出しにテンプレートを渡す:

```typescript
import { getActiveTemplate } from '../utils/markdownTemplateUtils.js';

// ... 既存の import に上記を追加

export async function flushBufferedExports(
  filter?: (date: string) => boolean
): Promise<void> {
  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';
    const templates = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];
    const activeTemplateId = settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] as string | undefined;
    const activeTemplate = getActiveTemplate(templates, activeTemplateId);

    const all = await chrome.storage.local.get(Object.keys(StorageKeys));

    for (const key of Object.keys(all)) {
      if (!key.startsWith(DAILY_BUFFER_PREFIX)) continue;

      const date = key.slice(DAILY_BUFFER_PREFIX.length);
      if (filter && !filter(date)) continue;

      const entries = all[key];
      if (!Array.isArray(entries) || entries.length === 0) continue;

      const content = buildDailyMarkdown(date, entries, activeTemplate);
```

(`content` 以降の `dataUrl` 生成・`chrome.downloads.download` 呼び出しは変更なし)

`MarkdownExportTemplate` 型の import をファイル冒頭に追加:

```typescript
import type { MarkdownExportTemplate } from '../utils/types.js';
```

- [ ] **Step 8: テストを実行して成功することを確認**

Run: `npx jest src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts`
Expected: PASS (全テストケース)

- [ ] **Step 9: 影響範囲の既存テストを実行**

Run: `npx jest src/background/pipeline`
Expected: PASS(既存テストが `MarkdownEntry.markdown` フィールドを参照していた場合は `entryData` に修正が必要。エラーが出た場合は該当テストファイルを修正する)

- [ ] **Step 10: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 11: Commit**

```bash
git add src/background/pipeline/buffers/MarkdownBufferManager.ts src/background/pipeline/steps/saveLocalMarkdownStep.ts src/background/localMarkdownExportCore.ts src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts
git commit -m "feat: 自動ローカルエクスポートをMarkdownテンプレート対応に統合"
```

---

### Task 8: ダッシュボード手動エクスポートをテンプレート対応に統合

**Files:**
- Modify: `src/dashboard/dashboard.ts`
- Test: 既存の dashboard 関連テストがあれば確認して追記

- [ ] **Step 1: 既存テストファイルの有無を確認**

Run: `find src/dashboard -iname "*dashboard*test*" | grep -i export`

見つからない場合、`formatEntryToMarkdown` / `downloadDateMarkdown` は現状ブラウザ API(`chrome.downloads`, `Blob`, `URL.createObjectURL`)に依存しテスト困難な構造の可能性がある。その場合は Step 2 のロジック変更を直接行い、Step 8 の手動確認で動作検証する。テスト可能な純粋関数として抽出できる場合は抽出してテストを書く。

- [ ] **Step 2: `formatEntryToMarkdown` を `renderEntryTemplate` ベースに置き換え**

`src/dashboard/dashboard.ts` の `formatEntryToMarkdown` 関数(700-711行目)を変更:

```typescript
import { renderEntryTemplate, renderFileTemplate, getActiveTemplate } from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../utils/types.js';

// ... 既存の import 群に上記を追加

/**
 * Convert a single browsing log entry into template entry data
 * VULN-020 fix: sanitize title and URL to prevent Markdown injection
 */
function toMarkdownTemplateEntryData(entry: { title?: string | null; url: string; summary?: string | null; tags?: string | null; created_at: number }): MarkdownTemplateEntryData {
  const timestamp = new Date(entry.created_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const title = sanitizeForMarkdownLinkText(entry.title || entry.url || 'Untitled');
  const url = sanitizeUrlForMarkdownTarget(entry.url);
  const summary = sanitizeForObsidian((entry.summary || 'Summary not available.').replace(/\n+/g, ' ').replace(/  +/g, ' ').trim());
  const tags = entry.tags ? sanitizeForObsidian(entry.tags) : '';
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    domain = '';
  }
  return { timestamp, title, url, summary, tags, domain };
}
```

`formatEntryToMarkdown` という関数名・シグネチャは、後方互換のため他の呼び出し元がないことを Task 8 Step 1 の grep 結果で確認した上で削除し、上記 `toMarkdownTemplateEntryData` に置き換える。

- [ ] **Step 3: `downloadDateMarkdown` をテンプレート対応に変更**

`src/dashboard/dashboard.ts` の `downloadDateMarkdown` 関数(756-771行目)を変更:

```typescript
async function downloadDateMarkdown(
  exportPath: string,
  date: string,
  entries: BrowsingLogEntry[],
  template: MarkdownExportTemplate
): Promise<void> {
  const entryData = entries.map(toMarkdownTemplateEntryData);
  const content = renderFileTemplate(template, entryData, date);

  const blob = new Blob([content], { type: 'text/markdown' });
  const blobUrl = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: blobUrl,
    filename: `${exportPath}/${date}.md`,
    saveAs: false,
    conflictAction: 'overwrite'
  });

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
```

- [ ] **Step 4: `downloadDateMarkdown` の呼び出し元にテンプレート引数を渡す**

`exportFullHistoryInBatches`(795行目・809行目付近)と `exportLocalMarkdownCore`(879行目付近)内の `downloadDateMarkdown(...)` 呼び出しに、アクティブテンプレートを取得して渡す。各関数の冒頭(エントリ取得より前)でテンプレートを一度だけ取得する:

```typescript
  const settings = await getSettings();
  const templates = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];
  const activeTemplateId = settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] as string | undefined;
  const activeTemplate = getActiveTemplate(templates, activeTemplateId);
```

(`getSettings` が既に呼ばれている関数であれば重複呼び出しを避け、既存の `settings` 変数から取得する。`exportFullHistoryInBatches` と `exportLocalMarkdownCore` それぞれの既存実装を確認し、`downloadDateMarkdown(exportPath, date, entries)` の呼び出し3箇所すべてに `activeTemplate` を追加の第4引数として渡す)

- [ ] **Step 5: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: 既存テストを実行**

Run: `npx jest src/dashboard`
Expected: PASS(`formatEntryToMarkdown` を直接テストしていたケースがあれば `toMarkdownTemplateEntryData` + `renderEntryTemplate` の組み合わせに修正)

- [ ] **Step 7: ビルドを実行して構文エラーがないことを確認**

Run: `npm run build`
Expected: ビルド成功

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/dashboard.ts
git commit -m "feat: ダッシュボード手動エクスポートをMarkdownテンプレート対応に統合"
```

---

### Task 9: `getSettings` / `saveSettings` のデフォルト値対応

**Files:**
- Modify: `src/utils/storage/defaults.ts`(`DEFAULT_SETTINGS` 定数、60行目付近に `[StorageKeys.CUSTOM_PROMPTS]: [],` がある)
- Test: 既存の `storage` 関連テスト(`src/utils/__tests__/storage*.test.ts`)があれば追記

- [ ] **Step 1: 既存テストファイルの構成を確認**

Run: `find src/utils/__tests__ -iname "*storage*"`

`CUSTOM_PROMPTS` のデフォルト値をテストしている既存ケースがあるか `grep -rn "CUSTOM_PROMPTS" src/utils/__tests__/` で確認する。

- [ ] **Step 2: 既存テストパターンを確認して失敗するテストを書く**

`CUSTOM_PROMPTS` のデフォルト値をテストしている既存テストケースを探し(`grep -rn "CUSTOM_PROMPTS" src/utils/__tests__/`)、同じパターンで `MARKDOWN_EXPORT_TEMPLATES` のデフォルト値をテストするケースを該当テストファイルに追加:

```typescript
  it('MARKDOWN_EXPORT_TEMPLATES のデフォルト値は空配列である', async () => {
    const settings = await getSettings();
    expect(settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES]).toEqual([]);
  });
```

(既存の `getSettings` テストの構造・モックパターンに合わせて記述すること。周辺の既存テストを読んでから追加する)

- [ ] **Step 3: テストを実行して失敗することを確認**

Run: `npx jest src/utils/__tests__/storage`
Expected: FAIL — デフォルト値が `undefined`

- [ ] **Step 4: `DEFAULT_SETTINGS` に追加**

`src/utils/storage/defaults.ts` の `[StorageKeys.CUSTOM_PROMPTS]: [],`(60行目付近)の直後に追加:

```typescript
    [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: [],
```

(`ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID` はデフォルト未設定=`undefined`のままでよい。`getActiveTemplate` 側で `undefined` を許容する設計のため、`DEFAULT_SETTINGS` には追加しない)

- [ ] **Step 5: テストを実行して成功することを確認**

Run: `npx jest src/utils/__tests__/storage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/storage/defaults.ts
git commit -m "feat: MARKDOWN_EXPORT_TEMPLATESのデフォルト値を追加"
```

---

### Task 10: 管理パネル UI — テンプレート一覧・CRUD 操作

**Files:**
- Create: `src/dashboard/panels/staticForm/markdownTemplatePanel.ts`
- Create: `src/dashboard/markdownTemplateManager.ts`
- Modify: `entrypoints/options/index.html`
- Modify: `src/dashboard/main.ts`

- [ ] **Step 1: `promptSettingsPanel.ts` と `customPromptManager.ts` を読み、UI実装パターンを把握する**

Run: `cat src/dashboard/panels/staticForm/promptSettingsPanel.ts src/popup/customPromptManager.ts`

このタスクは UI 実装であり、既存の `customPromptManager.ts` の DOM 操作パターン(一覧描画・作成/編集フォームの表示切替・保存ボタンのイベントリスナー)を踏襲する。`customPromptManager.ts` の内容を読んでから以下のファイルを実装すること。

- [ ] **Step 2: `entrypoints/options/index.html` にサイドバーnavボタンとパネルセクションを追加**

サイドバーの `data-panel="panel-prompt"` ボタンの直後(40-45行目付近)に追加:

```html
<button class="sidebar-nav-btn" role="tab" aria-controls="panel-markdown-template" aria-selected="false" data-panel="panel-markdown-template">
  <span data-i18n="markdownTemplatePanelTitle">Markdown テンプレート</span>
</button>
```

(既存の `panel-prompt` ボタンの SVG アイコン・属性構成を確認し、同じ形式で追加すること)

パネルセクション(751行目付近、`panel-prompt` の `<section>` の後)に追加:

```html
<section id="panel-markdown-template" class="panel" role="tabpanel">
  <h2 data-i18n="markdownTemplatePanelHeading">ローカル Markdown 書き出しテンプレート</h2>
  <div id="markdownTemplateList"></div>
  <button id="markdownTemplateCreateBtn" data-i18n="markdownTemplateCreateBtn">新規テンプレート作成</button>
  <div id="markdownTemplateEditor" style="display: none;">
    <label for="markdownTemplateName" data-i18n="markdownTemplateNameLabel">テンプレート名</label>
    <input type="text" id="markdownTemplateName" />

    <label for="markdownTemplateFileInput" data-i18n="markdownTemplateFileLabel">ファイルテンプレート</label>
    <textarea id="markdownTemplateFileInput" rows="6"></textarea>

    <label for="markdownTemplateEntryInput" data-i18n="markdownTemplateEntryLabel">エントリテンプレート</label>
    <textarea id="markdownTemplateEntryInput" rows="4"></textarea>

    <div id="markdownTemplatePlaceholderHelp">
      <p data-i18n="markdownTemplateFilePlaceholders">利用可能: {{date}} {{entryCount}} {{entries}}</p>
      <p data-i18n="markdownTemplateEntryPlaceholders">利用可能: {{timestamp}} {{title}} {{url}} {{summary}} {{tags}} {{domain}}</p>
    </div>

    <div id="markdownTemplatePreview"></div>

    <button id="markdownTemplateSaveBtn" data-i18n="markdownTemplateSaveBtn">保存</button>
    <button id="markdownTemplateCancelBtn" data-i18n="markdownTemplateCancelBtn">キャンセル</button>
  </div>
</section>
```

- [ ] **Step 3: `markdownTemplateManager.ts` を実装**

`src/dashboard/markdownTemplateManager.ts` を新規作成。`customPromptManager.ts` の構造(一覧描画関数・エディタ表示切替関数・保存ハンドラ・削除ハンドラ)を踏襲し、以下の関数を実装する:

```typescript
/**
 * markdownTemplateManager.ts
 * Markdown 書き出しテンプレート管理パネルの UI ロジック
 */

import { getSettings, saveSettings, StorageKeys } from '../utils/storage.js';
import {
  DEFAULT_MARKDOWN_TEMPLATE,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderFileTemplate,
  validateTemplate,
} from '../utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate, MarkdownTemplateEntryData } from '../utils/types.js';
import type { Settings } from '../utils/storage.js';

const SAMPLE_ENTRIES: MarkdownTemplateEntryData[] = [
  { timestamp: '09:15', title: 'Sample Article', url: 'https://example.com/article', summary: 'This is a sample summary for preview.', tags: '#sample', domain: 'example.com' },
  { timestamp: '14:30', title: 'Another Page', url: 'https://example.org/page', summary: 'Another preview summary.', tags: '', domain: 'example.org' },
];

let editingTemplateId: string | null = null;

export async function initMarkdownTemplateManager(settings: Settings): Promise<void> {
  await renderTemplateList(settings);
  wireCreateButton();
  wireSaveButton();
  wireCancelButton();
}

async function getTemplates(settings: Settings): Promise<MarkdownExportTemplate[]> {
  const stored = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];
  return [DEFAULT_MARKDOWN_TEMPLATE, ...stored];
}

async function renderTemplateList(settings: Settings): Promise<void> {
  const listEl = document.getElementById('markdownTemplateList');
  if (!listEl) return;

  const templates = await getTemplates(settings);
  const activeId = (settings[StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID] as string) || DEFAULT_MARKDOWN_TEMPLATE.id;

  listEl.innerHTML = '';
  for (const template of templates) {
    const row = document.createElement('div');
    row.className = 'markdown-template-row';

    const label = document.createElement('span');
    label.textContent = template.name + (template.id === activeId ? ' (active)' : '');
    row.appendChild(label);

    const activateBtn = document.createElement('button');
    activateBtn.textContent = 'Activate';
    activateBtn.addEventListener('click', () => activateTemplate(template.id));
    row.appendChild(activateBtn);

    if (!template.isDefault) {
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditor(template));
      row.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => removeTemplate(template.id));
      row.appendChild(deleteBtn);
    }

    const duplicateBtn = document.createElement('button');
    duplicateBtn.textContent = 'Duplicate';
    duplicateBtn.addEventListener('click', () => openEditor({ ...template, name: `${template.name} Copy` }));
    row.appendChild(duplicateBtn);

    listEl.appendChild(row);
  }
}

async function activateTemplate(id: string): Promise<void> {
  await saveSettings({ [StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID]: id } as Partial<Settings>);
  const settings = await getSettings();
  await renderTemplateList(settings);
}

async function removeTemplate(id: string): Promise<void> {
  const settings = await getSettings();
  const stored = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];
  const updated = deleteTemplate(stored, id);
  await saveSettings({ [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: updated } as Partial<Settings>);
  const refreshed = await getSettings();
  await renderTemplateList(refreshed);
}

function openEditor(template: Omit<MarkdownExportTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): void {
  editingTemplateId = template.id && !template.isDefault ? template.id : null;

  const editorEl = document.getElementById('markdownTemplateEditor');
  const nameInput = document.getElementById('markdownTemplateName') as HTMLInputElement;
  const fileInput = document.getElementById('markdownTemplateFileInput') as HTMLTextAreaElement;
  const entryInput = document.getElementById('markdownTemplateEntryInput') as HTMLTextAreaElement;
  if (!editorEl || !nameInput || !fileInput || !entryInput) return;

  nameInput.value = template.name;
  fileInput.value = template.fileTemplate;
  entryInput.value = template.entryTemplate;
  editorEl.style.display = 'block';

  updatePreview();
  fileInput.addEventListener('input', updatePreview);
  entryInput.addEventListener('input', updatePreview);
}

function updatePreview(): void {
  const fileInput = document.getElementById('markdownTemplateFileInput') as HTMLTextAreaElement;
  const entryInput = document.getElementById('markdownTemplateEntryInput') as HTMLTextAreaElement;
  const previewEl = document.getElementById('markdownTemplatePreview');
  if (!fileInput || !entryInput || !previewEl) return;

  const draft: MarkdownExportTemplate = {
    id: 'preview',
    name: 'preview',
    fileTemplate: fileInput.value,
    entryTemplate: entryInput.value,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  };

  const validation = validateTemplate(draft);
  if (!validation.valid) {
    previewEl.textContent = `Invalid template: ${validation.errors.join(', ')}`;
    return;
  }

  previewEl.textContent = renderFileTemplate(draft, SAMPLE_ENTRIES, '2026-08-07');
}

function wireCreateButton(): void {
  const btn = document.getElementById('markdownTemplateCreateBtn');
  btn?.addEventListener('click', () => {
    openEditor({ ...DEFAULT_MARKDOWN_TEMPLATE, name: 'New Template', isDefault: false });
  });
}

function wireSaveButton(): void {
  const btn = document.getElementById('markdownTemplateSaveBtn');
  btn?.addEventListener('click', async () => {
    const nameInput = document.getElementById('markdownTemplateName') as HTMLInputElement;
    const fileInput = document.getElementById('markdownTemplateFileInput') as HTMLTextAreaElement;
    const entryInput = document.getElementById('markdownTemplateEntryInput') as HTMLTextAreaElement;
    if (!nameInput || !fileInput || !entryInput) return;

    const draft: MarkdownExportTemplate = {
      id: editingTemplateId ?? 'draft',
      name: nameInput.value,
      fileTemplate: fileInput.value,
      entryTemplate: entryInput.value,
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
    };

    const validation = validateTemplate(draft);
    if (!validation.valid) {
      alert(`Invalid template: ${validation.errors.join(', ')}`);
      return;
    }

    const settings = await getSettings();
    const stored = (settings[StorageKeys.MARKDOWN_EXPORT_TEMPLATES] as MarkdownExportTemplate[]) || [];

    const updated = editingTemplateId
      ? updateTemplate(stored, editingTemplateId, { name: draft.name, fileTemplate: draft.fileTemplate, entryTemplate: draft.entryTemplate })
      : [...stored, createTemplate({ name: draft.name, fileTemplate: draft.fileTemplate, entryTemplate: draft.entryTemplate })];

    await saveSettings({ [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: updated } as Partial<Settings>);
    closeEditor();
    const refreshed = await getSettings();
    await renderTemplateList(refreshed);
  });
}

function wireCancelButton(): void {
  const btn = document.getElementById('markdownTemplateCancelBtn');
  btn?.addEventListener('click', closeEditor);
}

function closeEditor(): void {
  editingTemplateId = null;
  const editorEl = document.getElementById('markdownTemplateEditor');
  if (editorEl) editorEl.style.display = 'none';
}
```

- [ ] **Step 4: パネルファクトリを実装**

`src/dashboard/panels/staticForm/markdownTemplatePanel.ts`:

```typescript
import { type StaticFormPanel } from '../types.js';
import { getSettings } from '../../../utils/storage.js';
import { initMarkdownTemplateManager } from '../../markdownTemplateManager.js';

export function createMarkdownTemplatePanel(): StaticFormPanel {
  return {
    id: 'panel-markdown-template',
    category: 'static-form',
    async mount(_container) {
      const settings = await getSettings();
      await initMarkdownTemplateManager(settings);
    },
    async refresh() {},
  };
}
```

- [ ] **Step 5: `main.ts` にパネルを登録**

`src/dashboard/main.ts` の `panel-prompt` の import・登録箇所(11行目・36行目付近)に倣って追加:

```typescript
import { createMarkdownTemplatePanel } from './panels/staticForm/markdownTemplatePanel.js';
```

`bootstrapper.registerPanels([...])` 配列に追加:

```typescript
  createMarkdownTemplatePanel(),
```

- [ ] **Step 6: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 7: ビルドを実行**

Run: `npm run build`
Expected: ビルド成功

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/panels/staticForm/markdownTemplatePanel.ts src/dashboard/markdownTemplateManager.ts entrypoints/options/index.html src/dashboard/main.ts
git commit -m "feat: Markdownテンプレート管理パネルUIを追加"
```

---

### Task 11: 手動ブラウザ検証(既存出力の互換性確認)

**Files:** なし(手動検証のみ)

- [ ] **Step 1: 拡張機能をビルドして Chrome にロード**

Run: `npm run build`

Chrome で `chrome://extensions` を開き、Developer mode を有効化して `dist/chromium-mv3` を Load unpacked。

- [ ] **Step 2: ローカルエクスポート設定を有効化し、デフォルトテンプレートで自動エクスポートが現行と同じ出力になることを確認**

ダッシュボードの Local Markdown Export 設定で `enabled: true`, `timing: immediate` を設定。適当なページを記録し、ダウンロードされた `.md` ファイルを開いて `# YYYY-MM-DD` 見出し + `- HH:MM [title](url)` 行が現行通り出力されることを確認する。

- [ ] **Step 3: 新設の「Markdown テンプレート」パネルでカスタムテンプレートを作成し、アクティブ化**

サイドバーから新パネルを開き、Duplicate でデフォルトを複製、`entryTemplate` を `* {{title}} <{{domain}}>` のように変更して保存・Activate。

- [ ] **Step 4: 自動エクスポートとダッシュボード手動エクスポートの両方でカスタムテンプレートが反映されることを確認**

再度ページを記録して自動エクスポートの出力を確認。続けてダッシュボードの手動ローカルエクスポート機能(日付範囲指定・全履歴)を実行し、同じカスタムフォーマットで出力されることを確認する。

- [ ] **Step 5: バリデーションの動作確認**

エディタで `{{entries}}` を含まないファイルテンプレートや、未知のプレースホルダー(例: `{{foo}}`)を入力して保存しようとし、エラーが表示され保存がブロックされることを確認する。

- [ ] **Step 6: Obsidian 送信経路が影響を受けていないことを確認**

Obsidian 連携を有効化した状態でページを記録し、Obsidian のデイリーノートへの追記が従来通り(`# 🌐 ブラウザ閲覧履歴` セクション、1エントリ行フォーマット)であることを確認する。

---

## 全体テスト実行

- [ ] **最終ステップ: `npm run validate` を実行し、型チェック・全テストがパスすることを確認**

Run: `npm run validate`
Expected: PASS(型チェック + 全テストスイート)
