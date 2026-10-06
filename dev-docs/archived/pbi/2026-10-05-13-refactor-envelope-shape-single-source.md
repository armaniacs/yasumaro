# PBI: envelope 検証が 3 系統に分岐し、許可ルールが実際に食い違う

## ユーザーストーリー

メッセージ種別を追加する開発者として、SW 宛 envelope の形判定を 1 モジュールに集約したい。同じ判定が 3 つありルールが異なるうえ、新規種別の追加時にどの表を直せばよいか自体が不明だから。

## 優先度

- 順位: 12/32
- RICE: 4.0（R5 / I2 / C0.8 / E2）
- 根拠: 本番で許可・predicate で拒否する入力がある。どちらを正とするかの裁定が残る。NN23 の先行
- 依存: なし（NN23 の先行）

## 背景（file:line 現状）

- 本番 `src/background/handlers/envelopePolicy.ts:137-141`: `NO_PAYLOAD_TYPES` なら payload 検査をスキップし、それ以外は object 必須。`:112-120` に policy table
- predicate `src/messaging/types.ts:242-265`: `:255-257` で NO_PAYLOAD は `payload === undefined` **必須**、`:260-262` で TEST_OBSIDIAN / DASHBOARD_SQLITE は undefined **許可**、それ以外は object 必須
- 結果として「NO_PAYLOAD 型に payload を付けたもの」は本番は許可・predicate は拒否する
- 本番死蔵 `src/messaging/validators.ts:89-96` の ServiceWorkerRequestValidator、`:672` の `serviceWorkerRequestValidator` の参照は `__tests__/validators.test.ts` のみで本番未接続
- 4 本目: `src/messaging/messageTransport.ts:85-87` が送信側で `VALID_MESSAGE_TYPES.includes` を再判定
- 型側の矛盾: `src/background/messageTypes.ts:98-106` / `:205-208` の `payload?`、`src/background/dashboardSqliteWiring.ts:62` の `message.payload || {}`（payload 欠落を想定した防御）
- リスト自体の SSOT は良好: `src/messaging/messageTypeRegistry.ts:19-73`
- テストが両論を別々に固定しているため乖離が維持される: `messaging-types-uniformity.test.ts`（predicate 側）と `envelopePolicy.test.ts`（本番側）

## BDD受け入れシナリオ

```gherkin
Scenario: envelope 判定が 1 モジュールに集約される
  Given 同一の envelope 入力
  When 本番の checkEnvelope と predicate と validator に通す
  Then 3 者の accept / reject が一致する

Scenario: TEST_OBSIDIAN payload の扱いが裁定される
  Given TEST_OBSIDIAN / DASHBOARD_SQLITE の payload なし入力
  When 判定する
  Then 「NO_PAYLOAD_TYPES へ追加」か「型から ? を外して必須」のいずれかに統一され、両テストが同一入力で pin される

Scenario: 死蔵 validator が整理される
  Given serviceWorkerRequestValidator
  When 整理する
  Then 削除または本番導線への接続のいずれかになり、本番未接続のまま残らない
```

## 受け入れ基準

- [x] envelope 形判定が 1 モジュール（例 `messaging/envelopeShape.ts`）に集約され、predicate と validator がその上の薄い wrapper になっている
- [x] TEST_OBSIDIAN / DASHBOARD_SQLITE の payload 扱いが裁定済み（NO_PAYLOAD_TYPES 追加 or 型の `?` 除去）で、両テストが同一入力で pin されている
- [x] 死蔵の `serviceWorkerRequestValidator` が削除または本番導線に接続されている
- [x] 既存の try/catch は envelopePolicy 側に維持され、挙動は裁定どおりに統一されている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: `messaging-types-uniformity.test.ts` と `envelopePolicy.test.ts` を同一入力で pin（両論の一致テスト）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 裁定: optional-object（`payload === undefined` または非 null object を受理）。NO_PAYLOAD legacy 例外（TEST_AI / ACTIVITY_UPDATE の `payload: {}` 送信）は送信者修正まで維持
- 変更ファイル: 新規 `src/messaging/envelopeShape.ts`、`src/messaging/types.ts`（薄い wrapper 化）、`src/background/handlers/envelopePolicy.ts`（委譲。統合側で `msgType` ナローイングの型エラー 3 件を修正）、`src/messaging/messageTransport.ts`（同一リストへの委譲）、`src/messaging/validators.ts`（死蔵 validator + singleton 削除）
- テスト: 両テストに同一リテラルの shape matrix を pin。対象 135 + 隣接 112 + 12 tests green
- ゲート: type-check PASS / lint 0 errors
