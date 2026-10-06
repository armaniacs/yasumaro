# PBI: sqlite 表 records/search のデコード双子を共通化する

## ユーザーストーリー

wire 表の保守担当者として、query デコードを 1 つにしたい。gateway decode と dashboard serviceDecode が完全同一で、検証強化を片側だけに入れると読経路で結果が割れるから。

## 優先度

- 順位: 11/23
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: 2 関数の抽出＋参照置換。`encodePayload` と `messageType` は行ごとに残す
- 依存: なし（NN17 と同ファイルだが関数抽出位置のみで競合は軽微。NN17 は NN11 着地後）

## 背景（file:line 現状）

- `src/messaging/sqliteWireTable.ts:289-292` と `:338-341`（`decodeGateway` 同一）
- `:299-302` と `:347-350`（`serviceDecode` 同一。`requiredRows`＋`requiredNonNegativeNumber` の並びまで一致）
- コメント `:308-311`（fold の経緯）
- 層差は残す: gateway 側の緩いキャストと dashboard 側の厳密検証の方針差は維持し、行の中身だけ共通化する

## BDD受け入れシナリオ

```gherkin
Scenario: デコードが共有関数になる
  Given records / search の両行
  When デコードする
  Then decodeQueryGateway / decodeQueryService の 2 関数を経由し、結果が従来と同一である
```

## 受け入れ基準

- [x] `decodeQueryGateway` / `decodeQueryService` の 2 関数が切り出されている
- [x] 両行から参照され、`encodePayload` と `messageType` は行ごとに残っている
- [x] 振る舞い不変
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 wire 表テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/messaging/sqliteWireTable.ts` のみ
- 統合修正: 抽出関数の戻り注釈が `BrowsingLogRecord[]` で、ガード推論の `BrowsingLogEntry[]` とずれ、dashboard 側 3 箇所で型エラーになったため、`decodeQueryService` の注釈を `BrowsingLogEntry[]` に修正（gateway 側は元のキャストどおり維持）
- ゲート: 対象 19 tests green / type-check PASS / lint 0 errors
