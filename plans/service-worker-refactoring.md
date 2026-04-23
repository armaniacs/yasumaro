# service-worker.ts Refactoring Plan

## 概要

service-worker.ts（970行, 0%カバレッジ）をリファクタリングし、ユニットテスト可能な設計に変換する。

**目的:**
- モジュールレベルのChrome API依存を分離
- 各メッセージハンドラを独立関数としてテスト可能化
- 全体カバレッジを62.73% → 77-80%に向上（+5-8%）

**工数:** 2-3日
**リスク:** リファクタリング中の回帰バグ（既存テストで検証）
**着手日:** 2026-04-24（予定）

---

## 現状分析

### 現在のservice-worker.ts構造

```typescript
// モジュールレベル即実行（テスト不可能）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 巨大switch文（500行以上）
  switch (request.type) {
    case 'MANUAL_RECORD':
      // 複数ステップに分かれた非同期処理
      break;
    case 'PREVIEW_RECORD':
      // ...
      break;
    // ... 20以上のケース
  }
});

// その他の即実行
chrome.alarms.onAlarm.addListener(...);
chrome.runtime.onInstalled.addListener(...);
```

**問題点:**
1. `chrome.runtime.onMessage.addListener` がモジュール評価時に即呼び出し → テスト環境でchrome未実装エラー
2. ハンドラ関数が無名関数内に閉じ込められ、単体テスト不可能
3. エラーハンドリング・リトライロジックの単体検証不可

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

#### Task S1-1: init() 関数の作成（2時間）
- [ ] `init()` 関数をexportsとして追加
- [ ] 現在のモジュールレベルの `onMessage.addListener`, `onAlarm.addListener`, `onInstalled.addListener` を `init()` 内に移動
- [ ] `init()` を最終行で呼び出し（既存挙動維持）
- [ ] テスト: `init()` を呼び出してもエラーなく実行されること

#### Task S1-2: createMessageHandler() 抽出（3時間）
- [ ] `createMessageHandler()` factory関数作成
- [ ] onMessage listener のコールバックをfactoryから生成するよう変更
- [ ] 既存のswitch文ロジックを `dispatchByType()` 関数に抽出
- [ ] テスト: `createMessageHandler()` が関数を返し、呼び出し可能であること
- [ ] テスト: `dispatchByType()` が未知のtypeでfalseを返すこと

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

#### Task S2-2: テスト環境セットアップ（2時間）
- [ ] `src/background/__tests__/service-worker.test.ts` 新規作成
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

- [ ] `npm test` で全テストパス（198+ tests, 0 failed）
- [ ] `npm run test:coverage` で service-worker.ts カバレッジ 60%以上
- [ ] 全体カバレッジが70%以上に向上（現状62.73%）
- [ ] リファクタリングによるパフォーマンス低下なし
- [ ] コードレビューで設計の明確化を評価

---

## 代替案（Contingency Plan）

もしリファクタリング中に重大な回帰が発生した場合：

1. **ロールバック:** gitブランチを残し、元の状態に戻す
2. **部分リファクタ:** まずは `init()` 関数化のみ行い、ハンドラはそのまま
3. **E2E依存:** service-workerはE2Eテストのみに延期（カバレッジ目標断念）

---

## 着手前チェックリスト

- [ ] 現在のすべての変更をコミット済み（`git status` clean）
- [ ] `main` ブランチから feature/service-worker-refactor ブランチ作成
- [ ] `npm run validate` で全テストパスを確認済み
- [ ] coverage baseline（62.73%）を記録済み

---

## 関連ファイル

- 対象ファイル: `src/background/service-worker.ts` (970行)
- 参考設計: `recordingLogic.ts`（既にリファクタ済み、テスト可能）
- 参考テスト: `src/background/__tests__/recordingLogic.test.ts`
- フェーズ計画: `plans/2026-04-19-tobe-ow6.md` Phase 5
- カバレッジ計画: `plans/2026-04-23-coverage80.md` Task D-1

---

**最終判断:** この計画で進めますか？何か追加すべき点はありますか？
