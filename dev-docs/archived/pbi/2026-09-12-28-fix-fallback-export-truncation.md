# PBI 2026-09-12-28 — Fallback export の 10k 切り詰め解消（SQL backend は全件のままの実バグ）

- **種別**: 🔧非機能追加（fix）
- **優先度**: 4 位 / RICE **12.8**（R4 × I2 × C80% / E0.5人日）
- **出典**: round 12 診断 候補 28・サブエージェント探索 + 直接検証

## 背景（なぜ）

`FallbackStorageAdapter.serialize`（:56）が `query({limit: 100000})` を要求するが、`storageFallback.query`（:181）が `buildQuerySpec(q, {caps: QUERY_CAPS, ...})` で plain cap 10000（limits.ts:74-77）に clamp する。IDB（IdbVfsBackend.ts:365-366）と OPFS worker（backupHandlers.ts:20-23）の serialize は LIMIT 無しで全件取得。>10k レコードの DB で fallback backend のみ export が部分的になる（round 11 の envelope SSOT は形状を統一したが件数は統一していない）。

## スコープ

- fallback serialize を capped `query()` 経由でなく direct scan（filter + map）に変更（envelope SSOT は維持）
- または paging loop で offset を回す（実装は simple 側を採用）
- envelope テストに件数 parity pin を追加

## 受け入れ基準（BDD）

### シナリオ 1: fallback でも全件が export される（ハッピーパス）
```gherkin
Given fallback backend に 10001 件
When serialize() を呼ぶ
then 10001 行を含む envelope が返る（IDB/OPFS と同一）
```

### シナリオ 2: envelope 形状は不変（境界）
```gherkin
Given serialize の結果
When JSON を parse する
then {version:1, table, rows} で EXPORT_COLUMNS が維持される
```

## DoD

- [x] fallback serialize の direct scan 化
- [x] 件数 parity テスト新設
- [x] offscreen export 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `FallbackStorage.exportAllRecords()` 新設（未削除全件・created_at DESC の direct scan — capped query を迂回）。`FallbackStorageAdapter.serialize` がこれを使用
- envelope SSOT（buildExportEnvelope）は維持 — 形状不変・件数のみ修正
- 検証: offscreen 全 77 ファイル 1067 tests green・type-check green・lint 0 errors

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし
