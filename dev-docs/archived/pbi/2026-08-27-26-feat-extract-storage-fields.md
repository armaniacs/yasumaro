# PBI: StorageField 深いモジュールの抽出

## ユーザーストーリー
開発者として、`commonStorageFields:43` + `BrowsingLogRecordMapper:7` + `saveMetadataStep:33` の浅い抽出を `CommonStorageFields` 深いモジュールに集約したい、なぜなら `extractCommonStorageFields` が40 field を `as Record` で `any` キャスト読みし、`rawMasked || null` で `0` を潰すバグがあり、Mapper は薄い委譲で実体の `saveMetadataStep` は20行の `if !== null patch.x = common.x` を手書きで本来 `CommonStorageFields.toMetadataPatch()` が深く持つべきだから。

## 優先度
- 順位: 5 / 7
- RICEスコア: 180（Reach=30 / Impact=1.5 / Confidence=70% / Effort=0.20）
- 根拠: `saveMetadataStep` の20本 `if` は将来の field 追加で必ず漏れる。`maskedCount` の `||` → `??` バグは既に存在。

## なぜなぜ分析
- なぜ浅いか: `extractCommonStorageFields` は40 field を `as Record` でキャスト読み
- なぜバグが残るか: `rawMasked || null` で `0` を潰す `||` vs `??` の混在
- 解: `CommonStorageFields` に `toMetadataPatch(opts)`/`toBrowsingLogRecord(contentEnabled)` を生やし `saveMetadataStep` の20本 `if` を削除

## BDD受け入れシナリオ
Scenario: ハッピーパス — 40 field が正しく抽出される
  Given 40 field を持つ `BrowsingLogRecord` を渡す
  When `CommonStorageFields.toMetadataPatch()` を呼ぶ
  Then `maskedCount:0` が `null` に潰れず正しく保持される

Scenario: エッジケース — `contentEnabled` で分岐が正しく動作する
  Given `contentEnabled: false` の場合
  When `toBrowsingLogRecord` を呼ぶ
  Then `content` が正しく除外される

## 受け入れ基準
- [x] `CommonStorageFields` に `toMetadataPatch(opts)`/`toBrowsingLogRecord(contentEnabled)` が実装されている
- [x] `saveMetadataStep` の20本 `if` が削除されている
- [x] `maskedCount` の `||` → `??` が修正されている

## テスト戦略
- 単体: `CommonStorageFields` の 40 field 抽出テスト
- 単体: `maskedCount:0` の `||` vs `??` バグ再現テスト
- 統合: `BrowsingLogRecordMapper` と `saveMetadataStep` の連携テスト
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [x] ドキュメント更新済み
