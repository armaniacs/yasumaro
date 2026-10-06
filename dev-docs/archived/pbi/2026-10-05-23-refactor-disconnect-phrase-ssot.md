# PBI: 同一ロールの並行実装 — 切断エラー文言の 3 系統判定と queue facade の pre-flush 計測コピペ

## ユーザーストーリー

メッセージング層の保守担当者として、切断エラー文言の判定を 1 箇所にしたい。同一文言パターンが手書きで 3 箇所にあり、パターン追加時に同步が必要だから。

## 優先度

- 順位: 22/32
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: パターン追加時の同步漏れが起きる構造。NN13 と `messageTransport.ts` を共有するため NN13 の後に実行
- 依存: NN13

## 背景（file:line 現状）

- 判定 1: `src/messaging/messageTransport.ts:30-35` の `RETRYABLE_ERROR_PATTERNS`、`:46-49`
- 判定 2: `src/messaging/sqliteRpcClient.ts:63-74` の `categorizeError` の offscreen_lost 分岐
- 判定 3: `src/background/regenerateContentFetcher.ts:119-121` の injectionRace
- 判定 4（本領域外・参考）: `src/popup/errorUtils.ts:145`
- メッセージング層のコメントは「transport は cross-link して統合しない」としているが、`regenerateContentFetcher` はその cross-link 先ですらない
- queue 計測コピペ: `src/background/pendingChromeStorageQueue.ts:86-107` と `src/background/pendingSqliteQueue.ts:84-95, :116-122`（後者がコメントで `Same measurement shape as pendingChromeStorageQueue` と明記）。「pre-flush load → 空判定 → flush → recovered ログ」の同一シーケンス

## BDD受け入れシナリオ

```gherkin
Scenario: 切断文言の判定が 1 箇所に集約される
  Given Receiving end does not exist / Could not establish connection の文言
  When 各所の判定に通す
  Then isDisconnectMessage で同一結果になり、分類（retriable / offscreen_lost / 注入競合）は呼び出し側のポリシーとして残る

Scenario: queue の pre-flush 計測が共有される
  Given 両 facade の flush
  When 実行する
  Then measureFlush ヘルパを経由し、戻り値とログ文言が不変である
```

## 受け入れ基準

- [x] 中立層 `messaging/disconnectPhrase.ts`（`DISCONNECT_PHRASES` 配列 + `isDisconnectMessage`）が置かれ、各所が `isDisconnectMessage(errorMessage(e))` に置換されている
- [x] 分類（retriable / offscreen_lost / 注入競合）は呼び出し側のポリシーとして残り、過度な共通化をしていない
- [x] queue 側は `measureFlush(label, load, flush)` ヘルパが抽出され、両 facade から呼ばれている。`flush` / `flushBatch` の戻り値とログ文言は不変
- [x] NN13 の `messageTransport.ts` 変更と競合しない形になっている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 切断文言の判定テスト（既存の各分類テストが green のまま）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `src/messaging/disconnectPhrase.ts`、 `src/messaging/sqliteRpcClient.ts` / `src/background/regenerateContentFetcher.ts`（置換。分類は呼び出し側に残す）、`src/background/pendingChromeStorageQueue.ts` / `src/background/pendingSqliteQueue.ts`（measureFlush 抽出。成功ログの名詞差はラベル対応で文言 byte 同一）、新規テスト 2 件
- ゲート: 対象 7 ファイル 59 tests green / type-check PASS / lint 0 errors
