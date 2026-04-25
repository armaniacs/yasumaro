# service-worker.ts Refactoring Plan

## 概要

service-worker.ts（1066行, 0%カバレッジ）をリファクタリングし、ユニットテスト可能な設計に変換する。

**目的:**
- モジュールレベルのChrome API依存を分離
- 各メッセージハンドラを独立関数としてテスト可能化
- 全体カバレッジを62.73% → 77-80%に向上（+5-8%）

**工数:** 2-3日
**リスク:** リファクタリング中の回帰バグ（既存テストで検証）
**着手日:** 2026-04-24（予定）
**最終更新:** 2026-04-26

---

## 現在の状況（2026-04-23 更新）

### 完了していること

- `init()` 関数: **export済み**（L48）
- `createMessageHandler()` factory: **export済み**（L126）
- `handleTabRemoved()`: **export済み**（L625）
- `handleNotificationButtonClicked()`: **export済み**（L977）
- `service-worker.test.ts`: **212行のテストが作成済み**（`src/background/__tests__/service-worker.test.ts`）

### 問題点

モジュール末尾で `init()` を経由せず直接 Chrome リスナーを登録している（`0d3791c` のリバート）:

```typescript
// Module-level initialization（末尾 ~1050-1066行）
chrome.runtime.onMessage.addListener(createMessageHandler());
chrome.tabs.onRemoved.addListener(handleTabRemoved);
// ...
```

これによりテスト環境でモジュールをimportするとChrome未定義エラーが発生するため、`vitest.config.ts` の exclude に入れて回避している。

### 直近アクション

**`**/service-worker.test.ts`** が `vitest.config.ts` の `exclude` に含まれており、テストが全く実行されていない（カバレッジ0%の直接原因）。

### 次のステップ（優先度順）

1. **短期:** モジュール末尾の直接リスナー登録を `if (typeof chrome !== 'undefined')` で guards → テスト環境でもimport可能にする
2. **中期:** `service-worker.test.ts` の exclude を解除 → 既存テストが通るか確認
3. **長期:** ハンドラを個別関数化してカバレッジをさらに引き上げる

---

## 現状分析（2026-04-23時点）

### 現在のservice-worker.ts構造

関数のexportとモジュール末尾の直接登録が**混在**している状態:

```typescript
// L48: init()はexportされているが使われていない
export function init(): void {
  chrome.runtime.onMessage.addListener(createMessageHandler());
  // ...
}

// L126: createMessageHandler()もexport済み
export function createMessageHandler(): (request, sender, sendResponse) => boolean { ... }

// L625: handleTabRemoved()もexport済み
export function handleTabRemoved(tabId: number): void { ... }

// L977: handleNotificationButtonClicked()もexport済み
export async function handleNotificationButtonClicked(...): Promise<void> { ... }

// L1050〜末尾: init()を使わず直接登録（0d3791cのリバート）
chrome.runtime.onMessage.addListener(createMessageHandler());
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onUpdated.addListener(handleTabUpdated);
chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(handleStartup);
chrome.notifications.onButtonClicked.addListener(handleNotificationButtonClicked);
chrome.notifications.onClicked.addListener(handleNotificationClicked);
```

**問題点:**
1. モジュール末尾の `chrome.runtime.onMessage.addListener` 等がimport時に即実行 → テスト環境でchrome未定義エラー
2. そのため `vitest.config.ts` の `exclude` に入れて回避 → カバレッジ0%
3. `service-worker.test.ts`（212行）は書かれているが一切実行されていない

**リバートの理由（`0d3791c`）:** `init()` 経由にすると拡張機能として正常動作しないケースが確認された

---

## リファクタリング設計

### パターン: Factory + Initialization

**リファクタリング後の構造:**
```typescript
// service-worker.ts
export function init(): void {
  // Service Workerライフサイクル初期化
  chrome.runtime.onMessage.addListener(createMessageHandler());
  chrome.alarms.onAlarm.addListener(handleAlarm);
  chrome.runtime.onInstalled.addListener(handleInstalled);
}

// Factory: ハンドラ生成関数
export function createMessageHandler():
  MessageHandlerFunction {
  return async (request, sender, sendResponse) => {
    const handled = await dispatchByType(request, sender, sendResponse);
    // 未処理の場合のフォールバック
    if (!handled) {
      await handleUnknownMessage(request, sender, sendResponse);
    }
  };
}

// 個別ハンドラ（エクスポート可能）
export async function handleManualRecord(
  request: ManualRecordRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: chrome.runtime.SendResponse
): Promise<boolean> {
  // 元のMANUAL_RECORDケースのロジック
  try {
    const result = await recordingLogic.record(...);
    sendResponse({ success: true, result });
    return true;
  } catch (error) {
    logError(error, ErrorCode.RECORDING_FAILED);
    sendResponse({ success: false, error: error.message });
    return true;
  }
}

// 他にも必要に応じてハンドラを分割
export async function handlePreviewRecord(...) { ... }
export async function handleSaveRecord(...) { ... }
export async function handleUnknownMessage(...) { ... }

// メッセージ種別のディスパッチャ
async function dispatchByType(
  request: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: chrome.runtime.SendResponse
): Promise<boolean> {
  switch (request.type) {
    case 'MANUAL_RECORD':
      return await handleManualRecord(request, sender, sendResponse);
    case 'PREVIEW_RECORD':
      return await handlePreviewRecord(request, sender, sendResponse);
    // ...
    default:
      return false;
  }
}
```

---

## リファクタリングタスク一覧

### Day 1: 構造変更と抽出（8-10時間）

#### Task S1-1: init() 関数の作成（2時間） ✅ 完了済み
- [x] `init()` 関数をexportsとして追加（L48）
- [x] `createMessageHandler()` factory関数を作成（L126）
- [x] `handleTabRemoved()`, `handleNotificationButtonClicked()` をexport（L625, L977）
- **未完:** モジュール末尾の直接登録を `init()` 経由に切り替えることは `0d3791c` でリバート

#### Task S1-1b: モジュール末尾をテスト可能に（NEW・未着手）
リバートの根本原因を解消する代替アプローチ:

```typescript
// 末尾をguardで囲む（import時にはchrome未定義なので安全）
if (typeof globalThis.chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener(createMessageHandler());
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    // ...
}
```

- [x] 末尾の直接登録を `if (typeof globalThis.chrome !== 'undefined' && chrome.tabs?.onRemoved)` で囲む
- [x] `npm test` で全テスト通過確認（3824 passed）
- [x] `vitest.config.ts` から `'**/service-worker.test.ts'` を除外リストから削除
- [x] `npx vitest run src/background/__tests__/service-worker.test.ts` で10件通過確認
- [ ] Chromeにロードして実際の動作確認（guard内は実際のChrome環境では実行される）

#### Task S1-2: createMessageHandler() 抽出（3時間） ✅ 完了済み
- [x] `createMessageHandler()` factory関数作成（L126）
- [x] テストも作成済み（`service-worker.test.ts` L125-170）
- **実行不可状態:** exclude中のため確認できていない

#### Task S1-3: 主要ハンドラの個別関数化（3-4時間）
**対象ハンドラ（優先度順）:**
1. `handleManualRecord`（最も複雑、テスト価値高）
2. `handlePreviewRecord`（AI連携、エラーハンドリング重要）
3. `handleSaveRecord`（ストレージ操作、重複检查）

- [ ] 各ケースのロジックを無名関数から分離
- [ ] 引数・戻り値の型を明確化（`Request`, `Response` 型定義を `messaging/types.ts` からimport）
- [ ] エラーハンドリングを統一（try-catch + `logError()` + `sendResponse({error})`）

#### Task S1-4: 残りハンドラの整理（1-2時間）
- [ ] 既存の `case` 一覧を列挙（20以上あるので優先度判断）
- [ ] 優先度低いものは `handleGenericRequest` にまとめて也对処
- [ ] 実際のservice-worker.ts diffレビュー

---

### Day 2: テスト容易性向上 & Chrome API抽象化（6-8時間）

#### Task S2-0: service-worker.test.ts のexclude解除 ✅ 完了済み
- [x] `vitest.config.ts` の exclude から `'**/service-worker.test.ts'` を削除
- [x] `npm test` で全テストパス確認（3824 passed）
- [x] カバレッジ: 62.73% → 62.99%（+10テスト）

#### Task S2-1: Chrome API抽象化interface（4時間）※任意
**方針判断:** service-worker内のChrome API使用が多数あるため、テストでモックしやすくするためinterfaceを定義するか？

**選択肢A: interface定義する（推奨）**
- [ ] `src/background/interfaces/chrome.ts` 作成
  ```typescript
  export interface ChromeTabs {
    query(queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void): void;
    sendMessage(tabId: number, message: any, options?: any): Promise<any>;
  }
  export interface ChromeStorage {
    local: {
      get(keys: string | string[], callback?: (result: any) => void): Promise<any>;
      set(items: any, callback?: () => void): Promise<void>;
    };
  }
  // ...
  ```
- [ ] service-worker.ts で `chrome.tabs` の型を `ChromeTabs` として注入可能に
- [ ] テスト時にモックを注入しやすくなる

**選択肢B: vi.mock('chrome') でモック**
- 現在のrecordingLogic.test.tsで使っている方式を拡張
- interface作成せず、`vi.mock('chrome', () => ({ ... }))` を使用
- 実装コスト低、拡張性も低くない

**推奨:** 選択肢A（interface化）を選択。設計の明確化・契約の明文化のため。

#### Task S2-2: テスト環境セットアップ（2時間） ✅ 完了済み
- [x] `src/background/__tests__/service-worker.test.ts` 作成済み（212行）
- [ ] 必要なモック定義:
  ```typescript
  import { vi, beforeEach } from 'vitest';
  import { chrome } from 'chrome-mock'; // または自前モック

  let mockTabs: any;
  let mockStorage: any;

  beforeEach(() => {
    mockTabs = { query: vi.fn(), sendMessage: vi.fn() };
    mockStorage = { local: { get: vi.fn(), set: vi.fn() } };
    // Chrome API差し替え
  });
  ```
- [ ] `logError`, `ErrorCode` モック
- [ ] `recordingLogic` moduleモック（依存関係）

#### Task S2-3: テストケース作成 – 正常系（2-3時間）
**優先度1: MANUAL_RECORD ハンドラ**
- [ ] `handleManualRecord` 正常時テスト:
  - 正常なリクエスト→ recordingLogic.record() 呼び出し
  - sendResponse({success: true}) 返却
  - `chrome.tabs.query` 呼ばれること
- [ ] `handleManualRecord` で recordingLogic.record() がrejectした場合:
  - エラーログ出力
  - sendResponse({success: false, error: ...})
  - 例外が伝播しない（catchしてsendResponse）

**優先度2: PREVIEW_RECORD, SAVE_RECORD**
- 同様のパターンでテスト

---

### Day 3: エッジケーステスト & リファクタリング完了（6-8時間）

#### Task S3-1: エラーハンドリングテスト（3-4時間）
- [ ] `chrome.runtime.lastError` 発生時の処理:
  - Chrome APIコール後に `if (chrome.runtime.lastError) throw ...`
  - sendResponseにはエラーメッセージを設定
- [ ] `sendResponse` がundefined（非同期）の場合:
  - `return true` で非同期応答を維持
- [ ] `recordingLogic.record()` がthrowした場合:
  - `logError` が呼ばれること
  - `sendResponse` にエラーメッセージ含まれること

#### Task S3-2: 境界条件テスト（2時間）
- [ ] 不明な `request.type` は `handleUnknownMessage` へ
- [ ] 必須フィールド(`url`, `title`) がない場合:
  - 適切なエラーレスポンス
- [ ] 権限なしドメインの場合:
  - `checkPermissionStep` がreject→エラーハンドリング

#### Task S3-3: 統合テスト & リグレッション検証（2時間）
- [ ] 全already passing testsがstill passになることを確認:
  ```bash
  npm test -- --reporter=dot
  ```
- [ ] 新規テストがpassすることを確認:
  ```bash
  npx vitest run src/background/__tests__/service-worker.test.ts
  ```
- [ ] カバレッジ計測:
  ```bash
  npm run test:coverage | grep -A 5 "service-worker.ts"
  ```
  目標: 60%以上（最初から100%は非現実的）

#### Task S3-4: ドキュメント更新（1時間）
- [ ] JSDocコメントをハンドラ関数に追加
- [ ] README or internal docs にリファクタリング内容記載

---

## 工数・リスク評価

### 工数見積もり

| タスク | 想定工数 | 備考 |
|--------|---------|------|
| Day 1: 構造変更 | 8-10h | 既存ロジック壊さずに抽出が最重要 |
| Day 2: Chrome抽象化 & テスト環境 | 6-8h | interface作成は任意だが推奨 |
| Day 3: テスト作成 & リグレッション検証 | 6-8h | エッジケース検証に時間をかける |
| **合計** | **20-26時間**（2.5-3.25日） | バッファ含め3日間を見込む |

### リスクと緩和策

| リスク | 影響度 | 発生確率 | 緩和策 |
|--------|--------|----------|--------|
| リファクタリング中に回帰バグ | 中 | 中 | 既存テスト全件パスを常時検証 |
| Chrome API抽象化で設計変更过大 | 中 | 低 | interface最小限に、必要に応じて段階的導入 |
| テスト作成が想定以上に時間がかかる | 中 | 中 | 優先度順に作成（必修のみ） |
| リファクタ後もモジューレベル初期化が残る | 高 | 低 | レビューで確認 |

---

## 成功基準（Acceptance Criteria）

- [x] `npm test` で全テストパス（4436 passed, 0 failed）
- [x] `service-worker.test.ts` がexclude外れて実行される（**101 tests passed**）
- [ ] `npm run test:coverage` で service-worker.ts カバレッジ 60%以上（**現在2.71%**）
- [x] 全体カバレッジが70%以上に向上（**現在73.61%**）
- [ ] リファクタリングによるパフォーマンス低下なし（Chrome手動確認未実施）
- [ ] Chromeに実際にロードして正常動作することを確認（**E2Eテストで部分的に確認済み**）

### カバレッジ状況（2026-04-26 時点）

| 指標 | 値 | 目標 |
|------|-----|------|
| service-worker.ts カバレッジ | 2.71% | 60%+ |
| 全体カバレッジ | 73.61% | 70%+ (達成済み) |
| service-worker.test.ts テスト数 | 101 tests | - |

### 残タスク

1. service-worker.ts のカバレッジ向上（60%目標）
2. Chrome手動確認
3. ハンドラ個別関数化（S1-3）

---

## 代替案（Contingency Plan）

もしリファクタリング中に重大な回帰が発生した場合：

1. **ロールバック:** gitブランチを残し、元の状態に戻す
2. **部分リファクタ:** まずは `init()` 関数化のみ行い、ハンドラはそのまま
3. **E2E依存:** service-workerはE2Eテストのみに延期（カバレッジ目標断念）

---

## 着手前チェックリスト（現在の状況）

- [x] 現在のすべての変更をコミット済み（`git status` clean）
- [x] `refactor/service-worker-testability` ブランチで作業中
- [x] `npm run validate` で全テストパスを確認済み（4436 passed）
- [x] coverage baseline（62.73%）を記録済み
- [x] **S1-1b完了:** `chrome.tabs?.onRemoved` guardを追加、exclude解除
- [x] **service-worker.test.ts 実行済み:** 101 tests passed
- [ ] **次のアクション:** service-worker.ts カバレッジ向上（60%目標）またはpopup-refactoring完了後の次の優先タスクへ

### 補足

service-worker.tsのカバレッジがまだ2.71%低い理由は、ハンドラ内部のロジック（switch case内の処理）がまだ十分にテストされていないためです。101件のテストは全て通過していますが、メッセージハンドラの深層部分是まだテストされていません。ハンドラ個別関数化（S1-3）を行う事でカバレッジが向上する可能性があります。

---

## 関連ファイル

- 対象ファイル: `src/background/service-worker.ts` (970行)
- 参考設計: `recordingLogic.ts`（既にリファクタ済み、テスト可能）
- 参考テスト: `src/background/__tests__/recordingLogic.test.ts`
- フェーズ計画: `plans/2026-04-19-tobe-ow6.md` Phase 5
- カバレッジ計画: `plans/2026-04-23-coverage80.md` Task D-1

---

**最終判断:** この計画で進めますか？何か追加すべき点はありますか？
