# PBI-22: 単純委譲型 StaticFormPanel 9件の宣言表化 実装計画

> **Source PBI:** `pbi/2026-08-09-22-refactor-shallow-static-form-panels.md`（フェーズ0調査済み・2026-08-09）

**Goal:** 「既存 init 関数を呼ぶだけ」のパネルモジュール9件（133行）を削除し、
1つの宣言表 + 汎用アダプタに集約する。

**Tech Stack:** TypeScript (nodeNext ESM), Vitest, jsdom

**所要目安:** 2pt

---

## この計画の性質

**行数削減が目的ではない**（133行と小さい）。
目的は「**設定パネルの一覧が1画面で読める**」という可読性。

**回帰リスクの所在**: 対象9件には**テストが1件も存在しない**。
自動テストで守られていないため、**手動確認が Definition of Done に含まれる**。

---

## 対象と非対象（間違えないこと）

### 対象（削除して表に移す）9件

```
src/dashboard/panels/staticForm/
  tagsSettingsPanel.ts            (12行)
  recordingConditionsPanel.ts     (12行)
  promptSettingsPanel.ts          (14行)
  markdownTemplatePanel.ts        (14行)
  cspSettingsPanel.ts             (15行)
  contentSettingsPanel.ts         (16行)
  exportImportPanel.ts            (16行)
  trustSettingsPanel.ts           (16行)
  domainFilterPanel.ts            (18行)
```

### 非対象（**絶対に触らない**）3件

```
  generalSettingsPanel.ts         (205行) ← 固有処理が大量
  privacySettingsPanel.ts         (95行)  ← テストあり
  aiSummaryCleansingPanel.ts      (66行)  ← スライダー処理あり
```

---

## Step 0: 現状確認（実装ではない・必須）

- [ ] 対象9件を**全部読む**（合計133行しかない）

```bash
cd /Users/yaar/Playground/obsidian-smart-history
cat src/dashboard/panels/staticForm/tagsSettingsPanel.ts \
    src/dashboard/panels/staticForm/recordingConditionsPanel.ts \
    src/dashboard/panels/staticForm/promptSettingsPanel.ts \
    src/dashboard/panels/staticForm/markdownTemplatePanel.ts \
    src/dashboard/panels/staticForm/cspSettingsPanel.ts \
    src/dashboard/panels/staticForm/contentSettingsPanel.ts \
    src/dashboard/panels/staticForm/exportImportPanel.ts \
    src/dashboard/panels/staticForm/trustSettingsPanel.ts \
    src/dashboard/panels/staticForm/domainFilterPanel.ts
```

- [ ] 登録側 `src/dashboard/main.ts` を読む
- [ ] `src/dashboard/panels/types.ts` の `StaticFormPanel` 契約を読む
- [ ] **現状の挙動を記録する（手動）**: `npm run build` して Chrome で options を開き、
      対象9タブのスクリーンショットを撮っておく（後で比較するため）

---

## Step 1: 対応表を作る（実装ではない・重要）

**この表を先に埋めないと必ず間違える。** Step 0 で読んだ内容から作る。

| id | mount で呼ぶもの | settings 要る? | refresh で呼ぶもの |
|---|---|---|---|
| `panel-tags` | `initTagsPanel()` (async) | – | なし |
| `panel-recording-conditions` | `initRecordingConditionsSettings()` (async) | – | なし |
| `panel-prompt` | `initCustomPromptManager(settings)` | **要** | なし |
| `panel-markdown-template` | `initMarkdownTemplateManager(settings)` | **要** | なし |
| `panel-csp` | `CSPSettings.loadCSPSettings()` (async) | – | `CSPSettings.loadCSPSettings()` |
| `panel-content` | `initContentSettings()` | – | `loadContentSettings()` ←**別関数** |
| `panel-export-import` | `initExportImport()`, `initEncryptedBackupPanel()`, `initGistSettings()` ←**3つ** | – | なし |
| `panel-trust` | `initTrustSettings()`, `loadTrustSettings()` ←**2つ** | – | `loadTrustSettings()` |
| `panel-domain` | `initDomainFilter()`, `initDomainFilterTagUI()` ←**2つ** | – | `loadDomainSettings()` ←**別関数** |

- [ ] 上表を自分で `cat` の出力と照合し、正しいことを確認する
- [ ] **id は HTML と一致していなければならない**。確認する

```bash
grep -o 'data-panel="[^"]*"' entrypoints/options/index.html | sort -u
```

---

## Step 2: アダプタのテストを書く（Red）

- [ ] `src/dashboard/panels/staticForm/__tests__/staticPanelAdapter.test.ts` を新規作成

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createStaticFormPanel } from '../staticPanelAdapter.js';

describe('createStaticFormPanel', () => {
  it('id と category を設定する', () => {
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {} });
    expect(panel.id).toBe('panel-x');
    expect(panel.category).toBe('static-form');
  });

  it('mount が指定した関数を呼ぶ', async () => {
    const spy = vi.fn();
    const panel = createStaticFormPanel({ id: 'panel-x', mount: spy });
    await panel.mount(document.createElement('div'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('非同期の init を await する', async () => {
    let done = false;
    const panel = createStaticFormPanel({
      id: 'panel-x',
      mount: async () => { await Promise.resolve(); done = true; },
    });
    await panel.mount(document.createElement('div'));
    expect(done).toBe(true);
  });

  it('settings を要求する init に settings を渡す', async () => {
    const spy = vi.fn();
    const panel = createStaticFormPanel({
      id: 'panel-x', needsSettings: true, mount: spy,
    });
    await panel.mount(document.createElement('div'));
    expect(spy).toHaveBeenCalledWith(expect.any(Object));
  });

  it('refresh 未指定ならプロパティ自体が存在しない', () => {
    // PBI 2026-08-08-03 の決定: refresh は optional。空実装を作らない
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {} });
    expect('refresh' in panel).toBe(false);
  });

  it('refresh 指定時は指定した関数を呼ぶ', async () => {
    const spy = vi.fn();
    const panel = createStaticFormPanel({ id: 'panel-x', mount: () => {}, refresh: spy });
    await panel.refresh?.();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] 実行 → **失敗を確認**（アダプタが未実装）

---

## Step 3: アダプタを実装（Green）

- [ ] `src/dashboard/panels/staticForm/staticPanelAdapter.ts` を新規作成

```typescript
import { type StaticFormPanel } from '../types.js';
import { getSettings, type Settings } from '../../../utils/storage.js';

/**
 * Declarative description of a panel whose only job is to call existing
 * init functions.
 *
 * Panels with logic of their own (generalSettingsPanel, privacySettingsPanel,
 * aiSummaryCleansingPanel) keep their own files — the deletion test fails for
 * them: inlining would scatter their bodies into the registration list.
 */
export interface StaticPanelSpec {
    id: string;
    /** Called on first mount. Receives settings only when needsSettings is set. */
    mount: (settings: Settings) => void | Promise<void>;
    /** Set when mount needs persisted settings, so others skip the read. */
    needsSettings?: boolean;
    /** Omitted entirely when the panel has nothing to re-read (PBI 2026-08-08-03). */
    refresh?: () => void | Promise<void>;
}

export function createStaticFormPanel(spec: StaticPanelSpec): StaticFormPanel {
    const panel: StaticFormPanel = {
        id: spec.id,
        category: 'static-form',
        async mount(_container) {
            // `await` accepts non-promises, so sync and async inits share one path.
            const settings = spec.needsSettings
                ? await getSettings()
                : (undefined as unknown as Settings);
            await spec.mount(settings);
        },
    };

    // Assign conditionally: declaring an empty refresh would contradict the
    // optional contract settled in PBI 2026-08-08-03.
    if (spec.refresh) {
        const refresh = spec.refresh;
        (panel as { refresh?: () => Promise<void> }).refresh = async () => { await refresh(); };
    }

    return panel;
}
```

- [ ] Step 2 のテストを実行 → **通ること**を確認
- [ ] `npm run type-check`
- [ ] **コミット**: `feat(dashboard): 単純委譲パネル用のアダプタを追加する`

---

## Step 4: 宣言表を作る

- [ ] `src/dashboard/panels/staticForm/staticPanels.ts` を新規作成

```typescript
import { createStaticFormPanel } from './staticPanelAdapter.js';
import { type StaticFormPanel } from '../types.js';

import { initTagsPanel } from '../../tagsPanel.js';
import { initRecordingConditionsSettings } from '../../recordingConditionsSettings.js';
import { initCustomPromptManager } from '../../settings/customPromptManager.js';
import { initMarkdownTemplateManager } from '../../markdownTemplateManager.js';
import { CSPSettings } from '../../cspSettings.js';
import { init as initContentSettings, loadContentSettings } from '../../settings/contentSettings.js';
import { initExportImport } from '../../exportImport.js';
import { initEncryptedBackupPanel } from '../../encryptedBackupPanel.js';
import { initGistSettings } from '../../gistSettings.js';
import { init as initTrustSettings, loadTrustSettings } from '../../settings/trustSettings.js';
import { init as initDomainFilter, loadDomainSettings } from '../../settings/domainFilter.js';
import { initDomainFilterTagUI } from '../../domainFilterTagUI.js';

/**
 * Panels that only forward to an existing init function.
 *
 * `id` must match the element id and `data-panel` attribute in
 * entrypoints/options/index.html — a typo makes that tab silently fail to
 * open, because wireSidebar swallows the registry's throw.
 */
export const STATIC_FORM_PANELS: readonly StaticFormPanel[] = [
    createStaticFormPanel({
        id: 'panel-tags',
        mount: () => initTagsPanel(),
    }),
    createStaticFormPanel({
        id: 'panel-recording-conditions',
        mount: () => initRecordingConditionsSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-prompt',
        needsSettings: true,
        mount: (settings) => initCustomPromptManager(settings),
    }),
    createStaticFormPanel({
        id: 'panel-markdown-template',
        needsSettings: true,
        mount: (settings) => initMarkdownTemplateManager(settings),
    }),
    createStaticFormPanel({
        id: 'panel-csp',
        mount: () => CSPSettings.loadCSPSettings(),
        refresh: () => CSPSettings.loadCSPSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-content',
        mount: () => initContentSettings(),
        refresh: () => loadContentSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-export-import',
        mount: async () => {
            initExportImport();
            initEncryptedBackupPanel();
            await initGistSettings();
        },
    }),
    createStaticFormPanel({
        id: 'panel-trust',
        mount: async () => {
            initTrustSettings();
            await loadTrustSettings();
        },
        refresh: () => loadTrustSettings(),
    }),
    createStaticFormPanel({
        id: 'panel-domain',
        mount: async () => {
            initDomainFilter();
            await initDomainFilterTagUI();
        },
        refresh: () => loadDomainSettings(),
    }),
] as const;
```

- [ ] **Step 1 の表と1行ずつ照合する。** 特に:
  - `panel-content` の refresh は `loadContentSettings`（`initContentSettings` ではない）
  - `panel-domain` の refresh は `loadDomainSettings`（mount とは別）
  - `panel-export-import` は3つ呼ぶ
  - `panel-trust` は mount で2つ呼ぶ

- [ ] `npm run type-check`

---

## Step 5: `main.ts` を差し替え、旧9ファイルを削除

- [ ] `src/dashboard/main.ts` の import 9行と登録9行を差し替える

```typescript
// 削除する import 9行
// import { createDomainFilterPanel } from './panels/staticForm/domainFilterPanel.js';
// ...

// 追加
import { STATIC_FORM_PANELS } from './panels/staticForm/staticPanels.js';

bootstrapper.registerPanels([
  createDiagnosticsPanel(),
  createExportLogsPanel(),
  createDomainSearchPanel(),
  createTagClusterPanel(),
  createHistoryPanel(),
  createSqliteHistoryPanel(),
  // 固有処理を持つため個別に残す3件
  createGeneralSettingsPanel(),
  createPrivacySettingsPanel(),
  createAiSummaryCleansingPanel(),
  // 単純委譲型9件
  ...STATIC_FORM_PANELS,
]);
```

- [ ] 旧9ファイルを削除する（**`git rm` を使う。`rm` は許可されない**）

```bash
git rm src/dashboard/panels/staticForm/tagsSettingsPanel.ts \
       src/dashboard/panels/staticForm/recordingConditionsPanel.ts \
       src/dashboard/panels/staticForm/promptSettingsPanel.ts \
       src/dashboard/panels/staticForm/markdownTemplatePanel.ts \
       src/dashboard/panels/staticForm/cspSettingsPanel.ts \
       src/dashboard/panels/staticForm/contentSettingsPanel.ts \
       src/dashboard/panels/staticForm/exportImportPanel.ts \
       src/dashboard/panels/staticForm/trustSettingsPanel.ts \
       src/dashboard/panels/staticForm/domainFilterPanel.ts
```

- [ ] `npm run type-check` → 削除漏れの参照があればここで判明する
- [ ] `npm run validate`
- [ ] **コミット**: `refactor(dashboard): 単純委譲パネル9件を宣言表へ集約する`

---

## Step 6: id と HTML の対応を検証するテストを追加

**Step 5 の最大のリスク（idのタイプミスで無言で開かなくなる）を潰す。**

- [ ] `src/dashboard/panels/staticForm/__tests__/staticPanels.test.ts` を新規作成

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { STATIC_FORM_PANELS } from '../staticPanels.js';

describe('STATIC_FORM_PANELS', () => {
  it('全パネルのidがHTMLに存在する', () => {
    const html = readFileSync('entrypoints/options/index.html', 'utf-8');
    for (const panel of STATIC_FORM_PANELS) {
      // A typo here makes the tab silently fail to open: NavigationRegistry
      // throws, but wireSidebar catches it.
      expect(html).toContain(`id="${panel.id}"`);
    }
  });

  it('idが重複していない', () => {
    const ids = STATIC_FORM_PANELS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('全パネルが static-form である', () => {
    for (const panel of STATIC_FORM_PANELS) {
      expect(panel.category).toBe('static-form');
    }
  });
});
```

- [ ] 実行 → 通ること。**落ちたら Step 4 の id が間違っている**
- [ ] `npm run validate`
- [ ] **コミット**: `test(dashboard): パネルidとHTMLの対応を固定する`

---

## Step 7: 手動確認（必須・省略不可）

**対象9件にテストが無かったため、自動テストだけでは不十分。**

- [ ] `npm run build`
- [ ] Chrome で `chrome://extensions` → 拡張機能を再読み込み
- [ ] options 画面を開き、**以下9タブすべてをクリックして内容が表示されることを確認**

| タブ | 確認内容 |
|---|---|
| タグ | タグ一覧が表示される |
| 記録条件 | 滞在時間・スクロール率の入力欄が表示される |
| プロンプト | プリセット5種が表示される |
| Markdownテンプレート | テンプレート編集欄が表示される |
| CSP | CSP設定が表示される |
| コンテンツ | コンテンツ設定が表示される |
| エクスポート/インポート | エクスポート・Gist設定が表示される |
| 信頼済みドメイン | 信頼設定が表示される |
| ドメインフィルタ | フィルタ一覧とタグUIが表示される |

- [ ] Step 0 で撮ったスクリーンショットと比較する
- [ ] `npm run test:e2e`

---

## 完了確認チェックリスト

- [ ] `ls src/dashboard/panels/staticForm/*.ts` が3ファイル + アダプタ + 表のみ
- [ ] `generalSettingsPanel.ts` / `privacySettingsPanel.ts` / `aiSummaryCleansingPanel.ts` が残っている
- [ ] `npm run validate` / `npm run build` / `npm run test:e2e` すべて成功
- [ ] **手動確認9タブすべて完了**

---

## 困ったときの判断基準

| 状況 | 判断 |
|---|---|
| あるパネルが表に収まらない | **無理に入れない。** 個別ファイルのまま残すのが正しい（deletion test に落ちた証拠） |
| `refresh` を全パネルに付けたくなった | **付けない。** PBI 2026-08-08-03 の決定に反する |
| タブが開かなくなった | まず id のタイプミスを疑う。Step 6 のテストで検出できる |
| `getSettings()` を全パネルで呼びたくなった | **呼ばない。** 不要なパネルで無駄な storage 読み込みが起きる。`needsSettings` で分ける |
| `generalSettingsPanel` も表に入れたくなった | **入れない。** 205行の固有処理があり本PBIの対象外（PBI 2026-08-08-09 の管轄） |
