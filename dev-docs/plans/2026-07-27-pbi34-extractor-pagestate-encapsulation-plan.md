# PBI-34: content/extractor.tsのグローバル変数をPageStateクラスにカプセル化する 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBI:** `pbi/2026-07-25-34-refactor-extractor-global-state-encapsulation.md`（フェーズ0再調査済み・2026-07-27。本計画作成時にさらに詳細調査した）

**Goal:** `src/content/extractor.ts`（886行）のモジュールレベル変数9個を`PageState`クラスのインスタンスプロパティに移行し、テスト時の状態リセットを容易にする。

**Architecture:** Content Scriptは1ページにつき1回だけ読み込まれ、`init()`が一度だけ呼ばれる性質上、`PageState`は**モジュールレベルで1つだけインスタンス化されるシングルトン**として扱う（クラス自体は複数インスタンス化可能な設計にし、テストでは`new PageState()`を都度生成することで状態リセットを実現する）。既存の関数群は`PageState`インスタンスを引数に取るか、クロージャで捕捉する形にリファクタリングする。

**Tech Stack:** TypeScript, Vitest, jsdom

---

## 現状分析（本計画作成時に実施した詳細調査、フェーズ0再調査の「8個」表記を修正）

**PBI本文・前回のフェーズ0再調査は「8個」としていたが、実際は9個のモジュールレベル変数が存在する:**

| # | 変数名 | 行 | 型 | export |
|---|---|---|---|---|
| 1 | `minVisitDuration` | 46 | `number` | – |
| 2 | `minScrollDepth` | 47 | `number` | – |
| 3 | `startTime` | 48 | `number` | – |
| 4 | `maxScrollPercentage` | 49 | `number` | – |
| 5 | `isValidVisitReported` | 50 | `boolean` | – |
| 6 | `checkIntervalId` | 51 | `number \| null` | – |
| 7 | `cleansingConfig` | 153 | `CleansingConfig`（50プロパティの巨大オブジェクト） | – |
| 8 | `lastCleansedReason` | 156 | `'hard'\|'keyword'\|'both'\|'none'` | **export** |
| 9 | `lastCleanseStats` | 157 | `{hardStripRemoved, keywordStripRemoved, totalRemoved}` | **export**（PBI本文が見落としていた変数） |
| 10 | `lastByteStats` | 163 | `{pageBytes, candidateBytes, originalBytes, cleansedBytes}` | **export** |
| 11 | `lastAiSummaryCleansedStats` | 170 | `{aiSummaryOriginalBytes, ...}` | **export**（PBI本文が見落としていた変数） |
| 12 | `lastFallbackTriggered` | 178 | `boolean` | **export**（PBI本文が見落としていた変数） |

実際には**12個**（PBI本文の「8つ」、前回フェーズ0再調査の「9つ」からさらに増加）。うち5個（`lastCleansedReason`, `lastCleanseStats`, `lastByteStats`, `lastAiSummaryCleansedStats`, `lastFallbackTriggered`）が`export let`。

### 依存関係の図（テキスト表現）

```
loadSettings() [async, chrome.storage.local.get]
  → 書き込み: minVisitDuration, minScrollDepth, cleansingConfig

extractPageContent(config = cleansingConfig) [exported, GET_CONTENTハンドラから呼ばれる]
  → 読み込み: cleansingConfig（デフォルト引数として）
  → 書き込み: lastCleansedReason, lastCleanseStats, lastByteStats,
              lastAiSummaryCleansedStats, lastFallbackTriggered

shouldRecordVisit(duration, scrollPercent) [exported, 純粋関数]
  → 読み込み: minVisitDuration, minScrollDepth

checkVisitConditions()
  → 読み込み: isValidVisitReported, startTime, maxScrollPercentage,
              minVisitDuration, minScrollDepth
  → 書き込み: window.__OW_TEST_STATE（E2Eテストフック、複数変数のスナップショット）
  → 呼び出し: shouldRecordVisit(), reportValidVisit(), stopPeriodicCheck()

updateMaxScroll()
  → 書き込み: maxScrollPercentage

reportValidVisit() [推定、要Read確認 — 555行以降]
  → 書き込み: isValidVisitReported = true（551行、実際はcheckVisitConditions呼び出し元ではなくreportValidVisit内での代入と推定。着手前に要再確認）

scheduleNextCheck() / startPeriodicCheck() / stopPeriodicCheck()
  → 読み書き: checkIntervalId
  → 読み込み: isValidVisitReported（scheduleNextCheck内の再帰判定）

init() [exported, エントリポイント]
  → 呼び出し: loadSettings(), startPeriodicCheck()
  → 読み込み: maxScrollPercentage, isValidVisitReported, startTime,
              minVisitDuration, minScrollDepth（E2Eテスト用スナップショット組み立てのみ）

chrome.runtime.onMessage リスナー（854-884行、GET_CONTENTハンドラ）
  → 読み込み: lastCleansedReason, lastCleanseStats, lastByteStats,
              lastAiSummaryCleansedStats, lastFallbackTriggered
  （extractPageContent()呼び出し直後にこれらを読み、sendResponseで返す）
```

**重要な設計上の要点**: `cleansingConfig`は50個のプロパティを持つ巨大な設定オブジェクトで、`extractPageContent(config = cleansingConfig)`のデフォルト引数としてのみ使われる。`PageState`に移行する際、このデフォルト引数パターンを維持する（呼び出し元がテストのために独自の`config`を渡せる設計は壊さない）。

### 外部依存（4テストファイル、フェーズ0再調査で確認済み・本計画で再確認）

`lastCleansedReason`, `lastCleanseStats`, `lastByteStats`, `lastAiSummaryCleansedStats`, `lastFallbackTriggered`の5つの`export let`変数に直接依存するテストファイル:
- `src/content/__tests__/extractor-core.test.ts`
- `src/content/__tests__/extractor-extra.test.ts`
- `src/content/__tests__/extractor-r2.test.ts`
- `src/content/__tests__/extractor.test.ts`

これらは`PageState`移行の際、importパターンを`import { lastCleansedReason } from '../extractor.js'`から`import { getPageState } from '../extractor.js'; getPageState().lastCleansedReason`のような形に書き換える必要がある。

### `src/content/loader.ts`との関係

PBI本文が「依存関係」として挙げる`loader.ts`は、`extractor.ts`を動的importする**注入オーケストレーター**であり、`extractor.ts`のモジュールレベル変数を直接参照していない（`init()`のみを呼ぶ想定）。着手前に以下で確認する:

```bash
grep -n "extractor" src/content/loader.ts
```

---

## Task 1: PageStateクラスを新設し、依存の少ない6変数を移行する（第1段階）

**Files:**
- Modify: `src/content/extractor.ts`
- Modify: `src/content/__tests__/extractor.test.ts`（該当箇所のみ）

第1段階では、export不要でテスト依存の少ない6変数（`minVisitDuration`, `minScrollDepth`, `startTime`, `maxScrollPercentage`, `isValidVisitReported`, `checkIntervalId`）を移行する。`cleansingConfig`と5つの`export let`統計変数は、より依存が多いため第2段階（Task 2）に回す。

- [ ] **Step 1: `reportValidVisit()`の実装を確認する（依存関係図の未確認箇所）**

```bash
grep -n "function reportValidVisit" src/content/extractor.ts
```

該当行から実装を読み、`isValidVisitReported = true`（551行）がこの関数内の代入であることを確認し、他に読み書きする変数がないか確認する。

- [ ] **Step 2: 失敗するテストを書く（PageStateクラスの基本動作）**

```typescript
// src/content/__tests__/pageState.test.ts (新規)
import { describe, it, expect } from 'vitest';
import { PageState } from '../pageState.js';

describe('PageState', () => {
  it('initializes with default values matching the pre-refactor module-level defaults', () => {
    const state = new PageState();
    expect(state.minVisitDuration).toBe(5);
    expect(state.minScrollDepth).toBe(50);
    expect(state.maxScrollPercentage).toBe(0);
    expect(state.isValidVisitReported).toBe(false);
    expect(state.checkIntervalId).toBeNull();
    expect(typeof state.startTime).toBe('number');
  });

  it('each instance is independent (no shared module-level state)', () => {
    const a = new PageState();
    const b = new PageState();
    a.isValidVisitReported = true;
    a.maxScrollPercentage = 80;
    expect(b.isValidVisitReported).toBe(false);
    expect(b.maxScrollPercentage).toBe(0);
  });
});
```

Run: `npm test -- pageState.test`
Expected: FAIL with "Cannot find module '../pageState.js'"

- [ ] **Step 3: `src/content/pageState.ts`を新設する**

```typescript
// src/content/pageState.ts
/**
 * pageState.ts
 * Encapsulates content-script-scoped mutable state that was previously
 * held as module-level `let` bindings in extractor.ts. One instance is
 * created per content script injection (see extractor.ts bottom), and
 * tests create a fresh instance per case instead of resetting globals.
 */
const DEFAULT_MIN_VISIT_DURATION = 5;
const DEFAULT_MIN_SCROLL_DEPTH = 50;

export class PageState {
  minVisitDuration: number = DEFAULT_MIN_VISIT_DURATION;
  minScrollDepth: number = DEFAULT_MIN_SCROLL_DEPTH;
  startTime: number = Date.now();
  maxScrollPercentage: number = 0;
  isValidVisitReported: boolean = false;
  checkIntervalId: number | null = null;
}
```

- [ ] **Step 4: `extractor.ts`から6変数の宣言を削除し、`PageState`のシングルトンインスタンスに置き換える**

```typescript
import { PageState } from './pageState.js';

const pageState = new PageState();
```

削除する宣言（46-51行）:
```typescript
let minVisitDuration = DEFAULT_MIN_VISIT_DURATION;
let minScrollDepth = DEFAULT_MIN_SCROLL_DEPTH;
let startTime = Date.now();
let maxScrollPercentage = 0;
let isValidVisitReported = false;
let checkIntervalId: number | null = null;
```

**`DEFAULT_MIN_VISIT_DURATION`/`DEFAULT_MIN_SCROLL_DEPTH`定数（42-43行）は`extractor.ts`内で他の箇所（`loadSettings()`内のフォールバック値として300, 302行）でも使われているため、削除せずそのまま残す。**

- [ ] **Step 5: 全ての読み書き箇所を`pageState.xxx`形式に置き換える**

対象箇所（行番号は移行前のもの、置き換え時に再grepすること）:
- `loadSettings()`: 302, 306行 → `pageState.minVisitDuration`, `pageState.minScrollDepth`
- `shouldRecordVisit()`: 411行 → 引数はそのまま、内部参照を`pageState.minVisitDuration`/`pageState.minScrollDepth`に変更。**この関数はexportされた純粋関数のためシグネチャは変えない**（`duration`, `scrollPercent`は引数のまま、モジュールレベル参照のみ`pageState`経由にする）
- `checkVisitConditions()`: 426, 428, 431, 437-446, 449-458行 → 全て`pageState.xxx`
- `updateMaxScroll()`: 534行 → `pageState.maxScrollPercentage`
- `reportValidVisit()`: 551行 → `pageState.isValidVisitReported = true`
- `scheduleNextCheck()`/`startPeriodicCheck()`/`stopPeriodicCheck()`: 757, 760-774, 798-806行 → `pageState.checkIntervalId`, `pageState.isValidVisitReported`
- `init()`: 819, 823, 830-836, 840-848行 → `pageState.xxx`

- [ ] **Step 6: `src/content/__tests__/extractor.test.ts`等、既存テストが`minVisitDuration`等のモジュール内部状態に直接依存していないか確認する**

```bash
grep -n "minVisitDuration\|minScrollDepth\|maxScrollPercentage\|isValidVisitReported\|checkIntervalId\|startTime" src/content/__tests__/*.test.ts
```

これら6変数は元々`export`されていなかったため、直接importしているテストは無いはず（`shouldRecordVisit()`や`init()`等のexported関数経由でのテストのみのはず）。もし直接参照があれば、そのテストを`PageState`経由に書き換える。

- [ ] **Step 7: 型チェック・既存テストで検証する**

```bash
npm run type-check
npm test -- pageState.test extractor.test extractor-core.test extractor-extra.test extractor-r2.test
```

Expected: 全てパス

---

## Task 2: cleansingConfigと5つのexport統計変数をPageStateに移行する（第2段階）

**Files:**
- Modify: `src/content/extractor.ts`
- Modify: `src/content/pageState.ts`
- Modify: `src/content/__tests__/extractor-core.test.ts`
- Modify: `src/content/__tests__/extractor-extra.test.ts`
- Modify: `src/content/__tests__/extractor-r2.test.ts`
- Modify: `src/content/__tests__/extractor.test.ts`

**前提**: Task 1が完了していること。

- [ ] **Step 1: 4テストファイルでの`export let`変数の使用箇所を正確に洗い出す**

```bash
grep -n "lastCleansedReason\|lastCleanseStats\|lastByteStats\|lastAiSummaryCleansedStats\|lastFallbackTriggered" src/content/__tests__/extractor-core.test.ts src/content/__tests__/extractor-extra.test.ts src/content/__tests__/extractor-r2.test.ts src/content/__tests__/extractor.test.ts
```

importパターン（`import { lastCleansedReason } from '../extractor.js'`のような直接import）と、アクセスパターン（テストケース内で読むだけか、リセットのために書き換えているか）を確認する。

- [ ] **Step 2: `PageState`クラスに`CleansingConfig`と5つの統計プロパティを追加する**

```typescript
// src/content/pageState.ts に追記
export interface CleansingConfig {
  // extractor.ts の CleansingConfig インターフェース定義をそのまま移動
  // (50プロパティ、104-151行の内容)
}

export const DEFAULT_CLEANSING_CONFIG: CleansingConfig = {
  // extractor.ts の DEFAULT_CLEANSING_CONFIG をそのまま移動 (104-151行)
};

export class PageState {
  // ...Task 1で追加した6プロパティ...

  cleansingConfig: CleansingConfig = { ...DEFAULT_CLEANSING_CONFIG };

  lastCleansedReason: 'hard' | 'keyword' | 'both' | 'none' = 'none';
  lastCleanseStats = { hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 };
  lastByteStats = { pageBytes: 0, candidateBytes: 0, originalBytes: 0, cleansedBytes: 0 };
  lastAiSummaryCleansedStats: {
    aiSummaryOriginalBytes: number;
    aiSummaryCleansedBytes: number;
    aiSummaryCleansedElements: number;
    aiSummaryCleansedReason: 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';
    aiSummaryCleansedReasons?: string[];
  } = {
    aiSummaryOriginalBytes: 0,
    aiSummaryCleansedBytes: 0,
    aiSummaryCleansedElements: 0,
    aiSummaryCleansedReason: 'none',
  };
  lastFallbackTriggered: boolean = false;
}
```

**重要**: `CleansingConfig`インターフェースと`DEFAULT_CLEANSING_CONFIG`は`extractPageContent()`の関数シグネチャ（`config: CleansingConfig = cleansingConfig`）でも使われるため、`extractor.ts`側で`pageState.ts`からre-exportするか、両方から`import type { CleansingConfig } from './pageState.js'`する。既存の呼び出し元（あれば）が`CleansingConfig`型をimportしていないか確認すること:

```bash
grep -rn "CleansingConfig" src/ --include="*.ts" | grep -v "extractor.ts\|pageState.ts"
```

- [ ] **Step 3: `extractor.ts`から該当宣言を削除し、`pageState.xxx`形式に置き換える**

削除: 54-102行（`CleansingConfig`インターフェース定義、`pageState.ts`に移動済み）、104-151行（`DEFAULT_CLEANSING_CONFIG`、同上）、153行（`cleansingConfig`宣言）、155-178行（5つの`export let`宣言）。

`extractPageContent()`のシグネチャ:
```typescript
export function extractPageContent(config: CleansingConfig = pageState.cleansingConfig): string {
```

関数内の書き込み箇所（257-280行）を`pageState.lastCleansedReason = ...`等に置き換える。

`loadSettings()`内の`cleansingConfig`参照（309-387行の多数箇所）を`pageState.cleansingConfig`に置き換える。

`chrome.runtime.onMessage`リスナー内（864-879行）の読み込み箇所を`pageState.lastCleansedReason`等に置き換える。

- [ ] **Step 4: 外部からこれら5変数を直接importしていたコードのための後方互換層を検討する**

`export let`だった5変数を完全に削除すると、既存の4テストファイルの`import { lastCleansedReason } from '../extractor.js'`が壊れる。2つの選択肢:

**選択肢A（推奨）**: `extractor.ts`に読み取り専用のgetter関数を新設し、テストをこちらに移行する:
```typescript
export function getPageStateForTesting(): Readonly<PageState> {
  return pageState;
}
```
4テストファイルの該当箇所を`import { lastCleansedReason } from '../extractor.js'` → `import { getPageStateForTesting } from '../extractor.js'; const { lastCleansedReason } = getPageStateForTesting();`に書き換える。

**選択肢B**: `extractor.ts`側で`export`されたgetterプロパティ（`export function getLastCleansedReason()`等）を5つ個別に用意する。選択肢Aより冗長だが、テスト側の書き換え差分は小さくなる。

**選択肢Aを採用する**（テスト全体で状態リセットが必要になった際に`PageState`インスタンス全体を一括で扱えるため、PBIの受け入れ基準Scenario 4「テスト時の状態リセットが容易になる」に最も合致する）。

- [ ] **Step 5: 4テストファイルを選択肢Aのパターンに書き換える**

```bash
npm test -- extractor-core.test extractor-extra.test extractor-r2.test extractor.test
```

修正前に一度実行し、失敗内容（importエラー）を確認してから、各ファイルのimport文とアクセス箇所を書き換える。

- [ ] **Step 6: 型チェック・全テストで検証する**

```bash
npm run type-check
npm test -- pageState.test extractor.test extractor-core.test extractor-extra.test extractor-r2.test
```

---

## Task 3: 実ブラウザでの手動動作確認

**Files:** なし（手動確認のみ）

- [ ] **Step 1: `npm run build`でビルドが通ることを確認する**

- [ ] **Step 2: 実Chromeブラウザで拡張機能を読み込み、構造の異なる最低3種類のWebサイトで動作確認する（PBI受け入れ基準どおり）**

例: ニュースサイト（多量の広告・ナビゲーション）、技術ブログ（コードブロック含む）、SPA（React/Vue等でDOM構造が動的）の3種類。各サイトで:
1. ページを一定時間閲覧し、スクロールする
2. `min_visit_duration`/`min_scroll_depth`の条件を満たした時点で自動記録がトリガーされることを確認
3. ポップアップから手動記録（`GET_CONTENT`メッセージ経由）を実行し、コンテンツクレンジング統計が正しく返ることを確認（Service Workerのログまたはダッシュボードの診断パネルで`cleansedReason`/`byteStats`等を確認）

- [ ] **Step 3: リファクタリング前と抽出結果が変わらないことを比較確認する**

可能であれば、リファクタリング前のブランチ/コミットでの抽出結果とdiffを取る。

- [ ] **Step 4: `pbi/00-INDEX.md`の該当行を更新する**

---

## コミット方針

Task単位で個別コミットする:
1. `refactor(content): extractor.tsの訪問状態6変数をPageStateクラスに移行`（Task 1）
2. `refactor(content): extractor.tsのcleansingConfig/統計変数をPageStateクラスに移行`（Task 2）

## 実装者への注記

- **PBI本文・過去のフェーズ0再調査ともに変数の個数を過小評価していた**（8個→9個→実際は12個、うちexportは5個）。着手前に必ず`grep -n "^let \|^const.*CleansingConfig\|^export let " src/content/extractor.ts`で現状の変数一覧を再確認すること。
- Task 2 Step 4の「後方互換層（選択肢A）」は、既存4テストファイルとの互換性を保ちつつ`PageState`カプセル化のメリットを活かす妥協点。将来的にテストファイル自体も`new PageState()`を直接生成してテストする形にリファクタリングする余地があるが、それは本PBIのスコープ外（Content Scriptの`init()`がシングルトンの`pageState`を暗黙に使う設計を崩さない範囲に留める）。
- Content Scriptはページ遷移ごとに再読み込まれる（モジュール全体が再評価される）ため、`pageState`をモジュールレベルの`const`でシングルトン化しても、ページごとの独立性は従来通り保たれる。これは「グローバル変数を減らす」目的であり「マルチページ間で状態共有する」目的ではないことに注意する。
