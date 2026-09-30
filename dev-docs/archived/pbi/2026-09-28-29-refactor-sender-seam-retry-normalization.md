# PBI: 送信 seam 集約とリトライ判定の正規形集約

種別: refactor
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ1の一部。PBI 26（契約 linkage）の後に着手する（送信側の整理のため）。

## ユーザーストーリー

送信リトライの条件を変える開発者として、1箇所の変更で全送信経路に反映され、経路ごとの独自判定が残らない状態を目指す。

## 優先度

- 順位: 6 / 7
- RICE スコア: 4.8（Reach=8 / Impact=1.5 / Confidence=80% / Effort=2.0）
- 根拠: 影響範囲は広いが、各経路は現状動いている。PBI 26 の linkage 後に着手する依存関係。26箇所の移行は段階的に行う

## 現状と問題（file:line 証拠付き）

- `src/messaging/messageTransport.ts:1-3` の single seam 宣言に対し、`src/messaging/pendingRecordGateway.ts:59` を含む26箇所が `protocolVersion` を自前で貼って直接 `chrome.runtime.sendMessage` する。採用者は `src/popup/recordCurrentPage/previewFlow.ts:109` と `src/content/contentMessageSender.ts:21` の実質2ファイルのみ
- リトライ判定の4系統: `src/messaging/messageTransport.ts:30-39`（正規表現）/ `src/messaging/dashboardGateway.ts:163-164,171`（`retriable` フラグ）/ `src/background/pipeline/retryPolicy.ts:17,59`（レガシー文字列包含）/ `src/background/ai/providers/ProviderStrategy.ts:352,600`（provider 側）

## BDD 受け入れシナリオ

```gherkin
Scenario: 全送信が seam を通る
  Given 直接送信の26箇所を MessageTransport.send() に寄せる
  When `rg 'chrome\.runtime\.sendMessage' src entrypoints` を実行する（テスト・offscreen transport 実装を除く）
  Then 残存がゼロである（または残存理由がコメントで明示される）

Scenario: リトライ判定が正規形に集約される
  Given 回復可能性の判定関数を1箇所に集約する
  When 各層のリトライ条件を読む
  Then 判定ロジックは正規形を参照し、回数・待機のみ各層が持つ
```

## 受け入れ基準

- [x] 直接送信の移行が完了する（または残存の理由付き allow-list がある）。`protocolVersion` の手貼りを lint で検出できること
- [x] 回復可能性の判定関数が1箇所に集約され、4系統がそれを参照する（回数・待機 backoff の各層保持は維持する）
- [x] PBI 26 の後に着手する（契約 linkage が先）

## テスト戦略

- 単体: 正規形判定関数の境界テスト。移行した各送信経路の既存テストが green
- E2E: 主要送信経路（record/preview）の既存 E2E が green

## 見積もり

2.0 SP

## Definition of Done

- [x] BDD シナリオに対応する確認が通る
- [x] `npm run validate` が通る
