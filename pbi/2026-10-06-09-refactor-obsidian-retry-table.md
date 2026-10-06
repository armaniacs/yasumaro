# PBI: obsidian 接続チェックのリトライ表を SSOT 由来にする

## ユーザーストーリー

Obsidian 接続の保守担当者として、リトライ可否の定義元を 1 つにしたい。接続チェックだけが独自 4 点リストで、共通の「一時的サーバー障害」定義と範囲がずれており、範囲変更時に 2 箇所の同時編集が必要だから。

## 優先度

- 順位: 9/23
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: 定数定義 1 箇所＋コメント＋契約テスト 1 件。挙動変化なし
- 依存: なし

## 背景（file:line 現状）

- `src/background/obsidianClient.ts:48-53`（`retryableStatusCodes: [500, 502, 503, 504]`）
- `src/background/obsidianClient.ts:321-344`（`_fetchConnectionResponse` が `isRetryableStatus` で分岐）
- SSOT: `src/utils/failureTaxonomy.ts:134-136`（`isTransientHttpStatus`: 500-599）、`:293-299`（`shouldRetryHttpResponse`）、`src/utils/retryPredicate.ts:91-93`（汎用述語）
- 対照: `src/utils/fetch.ts:334-338`（`defaultShouldRetry` は委譲済み）
- 現状差分: 501・505-599 が接続チェックでは非リトライ
- 事前確認済み: AI 要約系に独立リトライ表なし（`HttpProviderStrategy.ts:233` が transport 述語単一決定を明記）

## BDD受け入れシナリオ

```gherkin
Scenario: 定義元が SSOT になる
  Given retryableStatusCodes の定義
  When 読む
  Then SSOT から導出され、現行 4 点に絞る意図がコメント＋テストで固定されている

Scenario: 挙動が変わらない
  Given 500/502/503/504 と 501/505 の応答
  When 接続チェックする
  Then 前者はリトライ、後者は即時失敗のままである
```

## 受け入れ基準

- [x] `retryableStatusCodes` が SSOT 由来（例: `filter(500..599, shouldRetryHttpResponse(s,'GET'))` で導出）になっている
- [x] 現行 4 点維持の意図がコメント＋契約テストで固定されている
- [x] `501,505-599` の新規リトライは含めない（挙動変化のため対象外）
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 導出定数の契約テスト 1 件。既存テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/background/obsidianClient.ts`（SSOT 導出＋意図コメント）、`obsidianClient.test.ts`（契約 1 件追加）
- ゲート: 対象 51 tests green / type-check PASS / lint 0 errors
