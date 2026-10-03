# PBI: dashboardGateway の protocolVersion 自己スタンプを messageTransport 契約へ統合

## ユーザーストーリー

保守者として、プロトコルバージョンのスタンプとメッセージ型検証を messageTransport 側に一元化したい。dashboardGateway が生の `TransportPort.send` で `protocolVersion` を自己スタンプすると、バージョン契約と `VALID_MESSAGE_TYPES` 検証経路の両方を迂回できてしまうからだ。

## 優先度

- 種別: fix
- 順位: 06 / 20
- RICEスコア: 10.0（Reach=5 / Impact=1 / Confidence=1.0 / Effort=0.5 SP）
- 根拠: バージョンスタンプの一元化により契約違反を構造的に防ぎ、全 dashboard 間メッセージに型検証を復帰させる。
- 依存: なし

## 背景

- `src/messaging/dashboardGateway.ts:61` — `protocolVersion: CURRENT_PROTOCOL_VERSION` を自前でスタンプし、生の `TransportPort.send` で送信している。
- `src/messaging/messageTransport.ts:59-60` — 契約は「Senders must not stamp the version themselves — send() does it for every message」。自己スタンプは契約違反。
- 生の `TransportPort.send` 使用により、`VALID_MESSAGE_TYPES` による検証経路も迂回されている。

## BDD受け入れシナリオ

```gherkin
Scenario: gateway の送信メッセージには transport が一度だけスタンプする
  Given dashboardGateway が messageTransport 経由でメッセージを送信する
  When メッセージが送信される
  Then protocolVersion は messageTransport の send() によって正確に 1 回スタンプされる
  And dashboardGateway 側の自己スタンプは存在しない

Scenario: 検証対象外のメッセージ型は transport の検証で拒否される
  Given 送信メッセージの type が VALID_MESSAGE_TYPES に含まれない
  When メッセージを送信する
  Then messageTransport の検証がそのメッセージを拒否する

Scenario: テスト注入のポートは維持される
  Given テストがモックの TransportPort を注入している
  When gateway がメッセージを送信する
  Then 注入されたポート経由で送信される
```

## 受け入れ基準

- [x] dashboardGateway から protocolVersion の自己スタンプが除去されている。
- [x] dashboardGateway は生の `TransportPort.send` を使わず、messageTransport の send() を経由する。
- [x] protocolVersion のスタンプは messageTransport 側でのみ行われる。
- [x] gateway 送信メッセージに `VALID_MESSAGE_TYPES` 検証が適用される。
- [x] テスト注入ポートの仕組みが維持されている。
- [x] ワイヤフォーマット（スタンプ済みメッセージの形状）に変化がない。
- [x] 既存テストを新しい経路に更新し、`npm run validate` が成功している。

## テスト戦略（t_wadaスタイル）

### 単体テスト

- messageTransport の send() が全メッセージに protocolVersion を 1 回だけスタンプすることを、注入ポートへの記録で検証する（モック戻り値の比較だけにしない）。
- `VALID_MESSAGE_TYPES` 外の型が拒否されることを検証する。

### 統合テスト

- gateway → transport → 注入ポートの経路で、スタンプ 1 回・型検証・宛先を端到端で確認する。

## 見積もり

**0.5 SP**

スタンプと検証の transport 側への移動、gateway の送信経路変更、テスト更新が主体。

## Definition of Done

- [x] 自己スタンプの除去と transport 側への一元化が完了している。
- [x] `VALID_MESSAGE_TYPES` 検証が gateway メッセージに適用されている。
- [x] テスト注入ポートが維持され、既存テストが更新されている。
- [x] ワイヤフォーマットに変化がないことを確認している。
- [x] `npm run validate` が成功している。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。

## 実装記録

- 変更ファイル: `src/messaging/dashboardGateway.ts`（`CURRENT_PROTOCOL_VERSION` の自己スタンプを除去、`dashboardTransport` を `MessageTransport` 契約へ変更、注入ポートは `new MessageTransport(port)` でラップし同一ワイヤエンベロープを維持、transport 送信に `retries: 0` を明示し callDashboard 側リトライとの二重リトライを構造的に排除）、`src/messaging/__tests__/dashboardGateway-transport.test.ts`（回帰 pin: transport 層で protocolVersion が正確に 1 回スタンプされること、gateway がバージョン定数を import しないことをソース読み込みで pin）
- 変更なし: `src/messaging/messageTransport.ts`（既存の MessageTransport 契約を利用。33 の types.ts 変更とは別系統）
- ゲート: `npx tsc --noEmit` 0 エラー / `npm run lint` 0 エラー / `npm test` 15529 passed・21 skipped / `npm run validate` PASS
