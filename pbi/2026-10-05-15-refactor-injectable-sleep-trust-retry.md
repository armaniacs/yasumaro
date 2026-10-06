# PBI: 生産リトライの sleep が注入 seam を持たない（TrustDbKernel / trancoUpdater の 2 箇所）

## ユーザーストーリー

TrustDb 周りの保守担当者として、本番リトライの待機を注入可能にしたい。AGENTS.md の明文化された契約を `fetch` と `storageTransaction` は守っているのに、この 2 箇所だけがハードコード `setTimeout` で失敗経路のテストが実時間駆動を強いられるから。

## 優先度

- 順位: 16/32
- RICE: 4.0（R4 / I1 / C1.0 / E1）
- 根拠: AGENTS.md 契約違反が 2 箇所に残り、`TRUST_DB_INIT_FAILED` 経路のテストが存在しない
- 依存: なし

## 背景（file:line 現状）

- 契約: AGENTS.md「本番コードの待機は注入可能に（`SleepFn` / `StepDelayFn` / `sleep` option）」
- 遵守例: `src/utils/fetch.ts:285` の `SleepFn` 型、`:287` の defaultSleep、`:304` の `sleep?: SleepFn` オプション、`:359` の既定値、`src/utils/storage/storageTransaction.ts:17, :244, :275`。`ObsidianClient` も遵守
- 違反 1: `src/utils/trustDb/TrustDbKernel.ts:100-117` の `doInitializeWithRetry`（特に `:110-111` の `await new Promise(resolve => setTimeout(resolve, delay))`、baseMs:100 の 3 回リトライ）
- 違反 2: `src/utils/trustDb/trancoUpdater.ts:93-95`（baseDelay の指数バックオフ待機が素の `setTimeout`）
- 影響: 失敗経路のテストが実時間か fake timer の連打駆動を強いられる（`src/utils/trustDb/__tests__/lockContract.test.ts:58-66` の `settle()` ループがその形骸）。TrustDb 初期化リトライを exercising するテストが存在せず `TRUST_DB_INIT_FAILED` 経路が未検証

## BDD受け入れシナリオ

```gherkin
Scenario: 注入 sleep でリトライがテストできる
  Given 即時解決の sleep stub を注入した TrustDbKernel
  When 初期化が 2 回失敗して 3 回目に成功する
  Then 実時間待ちなしで 3 回の試行が行われる

Scenario: 初期化リトライの失敗経路が検証される
  Given 常に失敗する sleep stub 付きの初期化
  When maxRetries を超える
  Then TRUST_DB_INIT_FAILED で throw され、リトライ回数が pin される

Scenario: 本番の既定挙動が変わらない
  Given sleep 未指定の呼び出し
  When リトライが発生する
  Then 従来と同一の backoff 遅延で待機する
```

## 受け入れ基準

- [x] 両リトライに `sleep: SleepFn = waitForRetry` 相当のオプションが追加され、`backoffDelayMs` の結果を `await sleep(delay)` で待つ
- [x] 既定値が現行挙動と同一で、本番挙動が不変である
- [x] `trancoUpdater.ts:106-112` の finally ロック解放と `TrustDbKernel.ts:93-97` の `initPromise` クリアはそのまま維持される
- [x] テストの `settle()` ループが削られ `sleep: async () => {}` 相当に置換されている
- [x] 初期化リトライの失敗テストが 1 本追加されている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: sleep stub 注入によるリトライ回数・遅延値の pin テスト
- 単体: 初期化失敗時の `TRUST_DB_INIT_FAILED` テスト
- 実時間待ちは一切使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/utils/trustDb/TrustDbKernel.ts`（`TrustDbKernelOptions.sleep` + per-call override）、`src/utils/trustDb/trancoUpdater.ts`（`TrancoUpdaterOptions.sleep`）、`src/utils/trustDb/__tests__/lockContract.test.ts`（settle ループを stub に置換）、新規 `src/utils/trustDb/__tests__/trustDbInitRetry.test.ts`（遅延 pin + 失敗経路）
- ゲート: trustDb 17 ファイル 212 tests green / type-check PASS / lint 0 errors
