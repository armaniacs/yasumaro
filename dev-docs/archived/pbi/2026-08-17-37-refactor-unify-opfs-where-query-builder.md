# PBI: OPFS Worker の WHERE 構築を共有クエリビルダーに統一する

## ユーザーストーリー
開発者として、PBI-29 で共有 `sqliteQueryBuilder.ts` を作成したのに、OPFS Worker の `crudHandlers.ts` が今も WHERE/ORDER BY をインラインで構築している重複を解消したい。なぜなら、同じフィルタロジックが2箇所にあり、新フィルタ追加時にドリフトするから。

## 優先度
- 順位: 3 / 6
- RICEスコア: 2.40（Reach=3 / Impact=1 / Confidence=80% / Effort=1人日）
- 根拠: 1人日のクイックウィン。PBI-29の意図を完成させる後続。高確信・低コスト。

## ビジネス価値
- SQL構築が1モジュールに集約
- 新フィルタ追加が1箇所で済む（2箇所→1箇所）
- PBI-29の意図を完成

## BDD受け入れシナリオ

```gherkin
Scenario: crudHandlers が共有ビルダーを使う
  Given sqliteQueryBuilder が buildWhereClause/buildOrderByClause を提供している
  When crudHandlers が検索・ソートのSQLを構築する
  Then 共有ビルダー経由で構築され
  And インラインのWHERE構築が削除されている

Scenario: 既存クエリと同一SQLが生成される
  Given 既存の検索・ソートテストがある
  When crudHandlers を共有ビルダー利用に置換する
  Then 生成されるSQLが置換前と同一であり
  And 結果の並び・件数・rank値が変わらない
```

## 受け入れ基準
- [ ] `crudHandlers.ts` が `sqliteQueryBuilder` をimportしている
- [ ] インラインのWHERE/ORDER BY構築が削除されている
- [ ] `ALLOWED_ORDER_COLUMNS` のホワイトリスト検証が1箇所に集約されている
- [ ] 既存の `opfsWorker` 検索・ソートテストがすべてパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard の SQLite History パネルからの検索・ソートが従来通り動作する

### 統合テスト
- 共有ビルダー利用後の crudHandlers が従来と同一SQLを生成する契約テスト

### 単体テスト
- 共有ビルダーの WHERE/ORDER BY 組み合わせ（タグ・検索語・ソート・LIMIT/OFFSET境界）

## 実装アプローチ
- **Outside-In**: 現行SQLを契約テストで固定してから、共有ビルダーへ段階的に置換
- **Red-Green-Refactor**: 各フィルタ移行ごとにグリーンを維持

## 見積もり
2pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI-29（`sqliteQueryBuilder` 作成）の後続。PBI-30（opfsWorker分割）と同一ファイルに触れるが必須ではない
- 副作用: SQLite読み取りの中核。生成SQLが変わらないことを契約テストで固定
- テスタビリティ: 共有ビルダーはDOM/Worker非依存の純関数

## 実装者向け注記

### 現状コードの確認
```bash
# crudHandlers のインラインWHERE構築を確認
grep -n "WHERE\|ORDER BY\|ALLOWED_ORDER" src/offscreen/opfsWorker/crudHandlers.ts
# 共有ビルダーの提供関数を確認
grep -n "export function" src/offscreen/sqliteQueryBuilder.ts
```

### 現状（2026-08-17 確認済み）
- `crudHandlers.ts` 175行。38行目で `ALLOWED_ORDER_COLUMNS` 検証、63-67行目でインラインWHERE構築（`conditions.push(...)` → `WHERE ${conditions.join(' AND ')}`）
- `sqliteQueryBuilder.ts` 106行（`buildWhereClause`/`buildOrderByClause`/`buildFts5OrderClause`/`buildLikeOrderClause`/`sanitizeTextForFts5`/`shouldUseFts5`/`buildTagFilterClause` を提供）
- `IdbVfsBackend` は既に `buildWhereClause` を使用。`crudHandlers` のみ未移行

### 実装手順
1. crudHandlers の現行SQLを契約テストで固定
2. インラインWHERE構築を `buildWhereClause` 呼び出しに置換
3. インラインORDER BY構築を `buildOrderByClause`/FTS5系へ置換
4. `ALLOWED_ORDER_COLUMNS` 検証を共有ビルダー側に一本化
5. 既存テストでグリーンを確認

### 落とし穴
- crudHandlers は FTS5 MATCH（`browsing_logs_fts WHERE tags MATCH ?`）と LIKE フォールバックを自前分岐している。`buildWhereClause`/`buildFts5OrderClause`/`buildTagFilterClause` の対応関係を確認し、trigram長判定・`bm25()`由来のrank値の挙動を変えないこと
- `ALLOWED_ORDER_COLUMNS` は現在 `../schema.js` からimport。移行先を確認し、二重定義を残さないこと

## Definition of Done
- [ ] `crudHandlers.ts` が共有ビルダーをimportしている
- [ ] インラインWHERE/ORDER BY構築が削除されている
- [ ] `ALLOWED_ORDER_COLUMNS` 検証が1箇所に集約されている
- [ ] 契約テストが追加されパスしている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
