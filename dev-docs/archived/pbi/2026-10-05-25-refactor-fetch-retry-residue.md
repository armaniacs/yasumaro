# PBI: `fetch.ts` / `storageTransaction.ts` のリトライ実装に残る形骸化・重複・SoC 違反

## ユーザーストーリー

通信・永続化の保守担当者として、リトライ経路の残骸を整理したい。no-op の診断ログ・読み出しゼロの代入・同一ブロックの二重・テストを縛る抜け道が同一経路に残っているから。

## 優先度

- 順位: 27/32
- RICE: 2.0（R5 / I1 / C0.8 / E2）
- 根拠: fetch は全通信経路に関わる。4 つの独立した問題の束ね
- 依存: なし

## 背景（file:line 現状）

- (a) `src/utils/storage/storageTransaction.ts:22-24` の no-op `logDebug`（コメントは「tests can spy on console if needed」と言うが console も呼んでいない）。呼び出し `:164, :172` → リトライ発生の観測手段が本番・テストともゼロ
- (b) `src/utils/fetch.ts:365, :370, :404` の `_lastResponse` は代入のみ・読み出し 0 件（grep で確認）。`eslint.config.js:28, :152` の `varsIgnorePattern: '^_'` が unused 検出を黙らせて捨て代入が残存
- (c) `src/utils/fetch.ts:388-397` と `:408-416` が同一の `backoffDelayMs` + `logWarn` + `sleepFn` ブロックを二重保持。HTTP 経路と catch 経路
- (d) `src/utils/fetch.ts:116-134` が毎リクエスト `settingsRepository.getAll()` → `CSPValidator.initializeFromSettings` → `isUrlAllowed` を行い、`skipCspValidation` が唯一の抜け道 → fetch の単体テストが skipCspValidation か settingsRepository モックを強制され、境界がオプションの抜け道に隠れている

## BDD受け入れシナリオ

```gherkin
Scenario: リトライ発生が観測できる
  Given CAS リトライが発生する
  When onRetryDiagnostic を注入する
  Then コールバックで msg と data が受け取れ、既定（未注入）では何も起きない

Scenario: 死んだ代入と重複が消える
  Given 整理後の fetch.ts
  When _lastResponse と backoff ブロックを確認する
  Then _lastResponse 3 行が削除され、backoff 待機が 1 ヘルパーに集約されている

Scenario: テストが抜け道なしで疎通する
  Given FetchOptions の resolveSettings
  When テストが既定値を差し替える
  Then skipCspValidation なしで CSP 判定ブロックがテストできる
```

## 受け入れ基準

- [x] (a) no-op `logDebug` が削除されるか、注入する `onRetryDiagnostic?: (msg, data) => void`（既定 no-op）へ置換されている。「logger を import して循環を作るな」という既存制約は維持し、`sleep` と同じ注入方式で観測 seam を返す
- [x] (b) `_lastResponse` 3 行が削除されている（挙動不変）
- [x] (c) `await backoffWait(sleepFn, delay, payload)` ヘルパーに集約され、`try` 内の `attempt < maxRetryCount` 判定と `throw` の入れ子構造はそのまま
- [x] (d) `FetchOptions` に `resolveSettings?: () => Promise<Settings>`（既定は `settingsRepository.getAll()`）が追加され、CSP 判定ブロック（`:115-134`）の `try` / `tagFailure` は既存のまま
- [x] try/catch と `runCasRetryLoop` の throw 位置は不変
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: onRetryDiagnostic の呼び出しテスト、backoff 集約後の遅延テスト（sleep stub）
- 既存テストが green。実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/utils/fetch.ts`（_lastResponse 削除、backoffWait 集約、resolveSettings 追加）、`src/utils/storage/storageTransaction.ts`（no-op logDebug を onRetryDiagnostic 注入に置換。logger の import なし）
- ゲート: 対象 4 ファイル 116 tests green / type-check PASS / lint 0 errors
