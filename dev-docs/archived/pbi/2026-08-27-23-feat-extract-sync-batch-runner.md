# PBI: SyncTarget Runner の SyncBatchRunner 抽出

## ユーザーストーリー
開発者として、`SyncTarget` の2実装 (`GistSyncTarget` / `ObsidianSyncService`) の重複バッチロジックを `SyncBatchRunner` に抽出したい、なぜなら `isConfigured` の派生が乖離し `syncBatch` が Gist で `MAX_ITERATIONS=100×BATCH_SIZE=50` の全件再クエリ、Obsidian で `BATCH_SIZE=5` の単発フィルタとページング戦略が不統一で、sanitize と `sqliteClient.mutate` 成功マークがコピペされているから。

## 優先度
- 順位: 2 / 7
- RICEスコア: 180（Reach=60 / Impact=2 / Confidence=60% / Effort=0.40）
- 根拠: 2実装で抽象化コストは支払済みだが配置と batch ロジックが重複。Gist の 5000件ループは E2E でのみレート制限として顕在化。

## なぜなぜ分析
- なぜ重複するか: `SyncTarget.ts:7` は4メソッドの薄い interface だが `isConfigured` が Gist は `SettingsRepository.getAll()` 、Obsidian は `chrome.storage.local.get(OBSIDIAN_API_KEY)` と派生が乖離
- なぜ気づかないか: バッチ差は単体テストで `sqliteClient.query` mock 1回で隠蔽され、Gist の5000件ループは E2E でのみ顕在化
- 解: `SyncBatchRunner` が `SyncTarget` 2実装を `listPending(limit)` + `markSynced` port に委譲し `isConfigured` は `SettingsReader` 注入に統一。`BATCH_SIZE` 政策を runner に一元化

## BDD受け入れシナリオ
Scenario: ハッピーパス — バッチサイズが runner で一元管理される
  Given `SyncBatchRunner` を生成する
  When `syncBatch` を呼ぶ
  Then Gist と Obsidian で同じ `BATCH_SIZE` 政策が適用される

Scenario: エッジケース — sanitize と成功マークが重複しない
  Given `syncBatch` で sanitized データを投入する
  When 完了する
  Then `sanitizeForObsidian` と `sqliteClient.mutate` が1箇所で完結する

## 受け入れ基準
- [x] `SyncBatchRunner` が `listPending(limit)` + `markSynced` port に委譲している
- [x] `isConfigured` が `SettingsReader` 注入に統一されている
- [x] `BATCH_SIZE` 政策が runner に一元化されている（Gist=50/Obsidian=5 の値そのものは各ターゲットの API レート特性が異なるため維持しつつ、指定箇所を runner の `batchSize` オプション1箇所に集約）

## テスト戦略
- 単体: `SyncBatchRunner` の `listPending`/`markSynced` の委譲テスト
- 統合: 実 `sqliteClient` と `Gist`/`Obsidian` のバッチサイズ一元化テスト
- E2E: Gist の5000件ループがレート制限で正しく動作することを検証

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [x] ドキュメント更新済み
