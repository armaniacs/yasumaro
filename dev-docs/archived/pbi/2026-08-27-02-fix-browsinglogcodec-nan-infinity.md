# PBI: browsingLogCodec の NaN/Infinity 正規化漏れ

## ユーザーストーリー
利用者として、不正な visit データが SQLite に `NaN`/`Infinity` として保存されないようにしたい、なぜなら `CHECK(visit_duration >=0)` / `scroll_ratio 0-1` 違反でクエリ失敗や表示崩れが起きるから。

## 優先度
- 順位: 2 / 8
- RICEスコア: 900（Reach=50 / Impact=2 / Confidence=90% / Effort=0.1）
- 根拠: 不正値は visit 毎に発生しうる (Reach=50)。CHECK 違反は保存失敗に直結 (Impact=2)。codec の `Number()` 変換が原因と確信度高。payloadGuard OOM の次に高スコア。

## なぜなぜ分析
- なぜ NaN が保存されるか: `Number('not-a-number')` や `Infinity` を `null` に正規化せず `buildInsertParams` に渡すため
- なぜ正規化しなかったか: `payload.* != null` で文字列はガードしたが数値の `isFinite` まで見ていなかった
- なぜ気づかなかったか: テストが `expect(Number.isNaN).toBe(true)` で誤った期待を固定した
- 解: `!Number.isFinite(n) ? null : n` に正規化しテスト期待を `null` に修正

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常数値はそのまま保存される
  Given payload に `visit_duration: 30000` が含まれる
  When `buildRecordFromPayload` を呼ぶ
  Then `visit_duration === 30000` で返る

Scenario: 異常系 — NaN/Infinity は null に正規化される
  Given payload に `visit_duration: "not-a-number"`, `scroll_ratio: Infinity` が含まれる
  When `buildRecordFromPayload` を呼ぶ
  Then 両フィールドは `null` になり SQLite CHECK に違反しない

## 受け入れ基準
- [x] `src/offscreen/browsingLogCodec.ts` で全 numeric フィールドが `Number.isFinite` でガードされ非有限値は `null` に正規化される
- [x] `src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts:294-321` の期待値が `null` に修正される
- [x] 既存 322 ケース + 新ケースがパスする
- [x] `visit_duration:0` / `scroll_ratio:0` は `null` にならず 0 のままである

## テスト戦略
- 単体: `browsingLogCodec` の数値フィールド 10 項目 × (正常/0/NaN/Infinity/-0) の境界値テスト
- 統合: `buildRecordFromPayload` → `buildInsertParams` → `FallbackStorage.insert` の E2E で CHECK 違反が出ないことを確認
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
