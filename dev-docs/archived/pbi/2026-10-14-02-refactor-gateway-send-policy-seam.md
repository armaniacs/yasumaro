# PBI: Gateway三重奏の統一（sendWithPolicy seam）

## ユーザーストーリー
拡張機能の保守担当者として、envelope＋timeout＋normalizeの3点セットを単一seamにしてほしい、なぜならgateway追加のたびに鏡写しが増え、timeout契約の修正漏れが黙って失敗する送信パスを生むから

## 優先度
- 順位: 02 / 5
- RICEスコア: 10.0（Reach=5 / Impact=1 / Confidence=1.0 / Effort=0.5）
- 根拠: NN01と同点だがリスク軽減効果で01が先行。本PBIは変更範囲が `messaging/` に閉じるQuick Win。依存なし。

## 背景（holistic-code-review テーマ1）
`messageTransport.send()`＋`withRuntimeTimeout()`＋応答normalizeがgatewayごとに手書きされ、`regenerateSummaryGateway.ts:1-10` は自認する鏡写し。timeout契約（20s／60s）と `retries: 0` が各ファイルに分散する。

## BDD受け入れシナリオ
Scenario: pending送信の契約が保たれる
  Given pendingページの再記録を送る
  When 20s以内に応答がない
  Then `PENDING_RECORD_TIMEOUT` のセンチネルで正規化され、呼び出し側の文言は変わらない

Scenario: regenerate送信の契約が保たれる
  Given サマリ再生成を送る
  When 60s以内に応答がない
  Then タイムアウトとして正規化され、SW側パイプラインの冪等性は変わらない

Scenario: 新規gatewayが設定行だけで足りる
  Given 新しい送信種別を追加する
  When `sendWithPolicy` に設定行を足す
  Then envelope＋timeout＋normalizeの順序コードを複写しない

## 受け入れ基準
- [x] `src/messaging/withRuntimeTimeout.ts` の隣に `sendWithPolicy(msg, { timeoutMs, timeoutError, retries, normalize })` ができる（実装上の追加: 後方互換の任意 `mapError` 引数付き。既定値は両gatewayの既存catchと同値出力）
- [x] `src/messaging/pendingRecordGateway.ts:42-84` と `src/messaging/regenerateSummaryGateway.ts:31-56` がその薄ラッパになる（`PENDING_RECORD_TIMEOUT_MS = 20000`、`REGENERATE_TIMEOUT_MS = 60_000`、センチネル、既存テストのtimeout値は不変。新規pinテスト `sendWithPolicy.test.ts` 4件で契約を固定）
- [x] `src/messaging/dashboardGateway.ts:148-188` のリトライループは本PBIでは触らない（将来の寄せ余地として台帳F2に残す）
- [x] 外部挙動不変（センチネル文言・リトライ有無・decode失敗の非再試行を維持。`tsc` 0 errors、`src/messaging` 35 files / 428 tests passed、既存gatewayテスト無修正で緑）

## テスト戦略
- E2E: pending再記録のタイムアウト表示が変わらないこと
- 統合: gatewayのタイムアウト契約テストが無修正で緑
- 単体: `sendWithPolicy` のtimeout文言pinテストを新設

## 見積もり
0.5（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
