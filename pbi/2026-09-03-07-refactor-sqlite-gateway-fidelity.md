# PBI: SqliteGateway fidelity 向上 — Offscreen / Dashboard の transport 分割と InMemory fidelity drift 解消

## ユーザーストーリー
SQLite アクセスを保守する開発者として、`SqliteGateway` の 390l 1クラスに同居する Offscreen hop と Dashboard hop の2語彙と `InMemoryTransport` の fidelity drift を解消したい、なぜなら現在は `query/mutate/maintain/status` の13 overloads と Dashboard confirm-token dance が1クラスに混在し、`SqliteClient` は 87l の pass-through shim で、`InMemoryTransport` が `buildExtraWhereSql` を再実装しつつ FTS は `substringIncludes` に short-circuit し `ORDER BY` が `(a[key] ?? 0)` で string 列の ordering を壊しているがテストが numeric `created_at` のみで drift を検出できないから

## 優先度
- 順位: 07 / 07
- RICEスコア: **12**（Reach=20 / Impact=0.5 / Confidence=0.6 / Effort=0.5）
- 根拠: SQLite browsing-log 検索・dashboard 表示に影響するが利用頻度は記録 pipeline より低く、現状でも主要パスは動作（Impact 0.5）。しかし InMemory と Chrome の fidelity drift は将来の回帰（offline や browsing-log 検索の ordering 不具合）を生むため Speculative として backlog に確保。Effort 0.5人週は gateway 分割＋共有 SQL builder 抽出＋contract test。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 1クラスに2語彙が混在？ | `SqliteGateway` が Offscreen transport（`ChromeOffscreenTransport`）と Dashboard transport（`sendDashboard` / `sendDashboardRaw` / `getDashboardConfirmToken` + `tokenExempt`）の2つの hop を1クラスで統合 → `OffscreenGateway` と `DashboardGateway` に分割 |
| なぜ shim が残る？ | `SqliteClient` 87l が `SqliteGateway` への委譲のみで唯一の価値は `getSharedSqliteClient()` singleton → gateway の singleton に一本化し shim を削除 |
| なぜ InMemory が drift する？ | `InMemoryTransport` が `buildExtraWhereSql` を再実装しつつ FTS を `bare.length>0 substringIncludes` に short-circuit、FTS_CAP 100k / PLAIN_CAP 1k の cap も独自 → 共有 `buildExtraWhereSql` と FTS tokenizer を抽出し InMemory は委譲する |
| なぜ ordering バグが検出されない？ | `ORDER BY` が `(a[key] ?? 0)` で string 列（`title` / `url`）の ordering を壊すが、テストが numeric `created_at` のみを assert → string 列 ordering を含む contract test で検出 |

## BDD受け入れシナリオ

### Scenario: Offscreen と Dashboard の gateway が別ファイルに分割される
  Given `OffscreenGateway` と `DashboardGateway` が別ファイルとして存在する
  When `grep -r "class SqliteGateway" src/` を実行する
  Then 390l 1クラスの `SqliteGateway` は存在せず、2つの gateway に分割されている

### Scenario: InMemoryTransport が共有 SQL builder に委譲する
  Given `buildExtraWhereSql` と FTS tokenizer が共有 module として抽出される
  When `InMemoryTransport` が query を実行する
  Then 独自の `buildExtraWhereSql` 再実装ではなく共有 builder に委譲し、FTS も共有 tokenizer を使う

### Scenario: ORDER BY の string 列 ordering が正しく動く
  Given `InMemoryTransport` の `ORDER BY` が string 列（`title` / `url`）でも正しくソートする
  When `query({ orderBy: 'title', orderDir: 'asc' })` で title が `['apple','Banana','cherry']` のレコードを検索する
  Then string 列の ordering が正しく（大文字小文字を考慮した）ソート順で返る

### Scenario: SqliteClient shim が削除される
  Given `SqliteClient` 87l shim が削除される
  When `grep -r "from.*sqliteClient" src/` を実行する
  Then `sqliteClient.ts` への import は存在せず、gateway の singleton（例: `getSharedSqliteGateway()`）に一本化されている

### Scenario: Contract test で両 transport が同一 suite で検証される
  Given 同一の assertion suite（`buildExtraWhereSql` / FTS / ORDER BY / cap）が定義される
  When `ChromeOffscreenTransport`（または `OffscreenGateway`）と `InMemoryTransport` の両方で suite を実行する
  Then 両 transport で同じ結果が得られ、FTS の short-circuit や cap の不一致が検出される

## 受け入れ基準
- [x] `src/background/sqliteGateway.ts` の 390l 1クラスが `OffscreenGateway` と `DashboardGateway` に分割され、各 gateway が自身の hop（Offscreen / Dashboard）の語彙のみを持つ
- [x] `buildExtraWhereSql` と FTS tokenizer が共有 module として抽出され、`InMemoryTransport` が再実装ではなく委譲している
- [x] `InMemoryTransport` の `ORDER BY` が string 列でも正しくソートされる（`(a[key] ?? 0)` の数値 fallback が削除されている）
- [ ] `src/background/sqliteClient.ts` 87l shim が削除され、gateway の singleton に一本化されている
- [x] Contract test が両 transport で同一 suite を実行し green
- [ ] `npm run validate` green

## テスト戦略
- 単体: `buildExtraWhereSql` の共有 builder が全 filter（domain / starred / date / FTS）の WHERE 生成を正しく行うことを unit test
- 単体: `ORDER BY` の string 列（`title` / `url`）と numeric 列（`created_at`）の両方でソート順を検証
- 単体: FTS の `substringIncludes` short-circuit が共有 tokenizer に置換され、FTS_CAP 100k / PLAIN_CAP 1k の cap が両 transport で一致することを検証
- 統合: Contract test で `ChromeOffscreenTransport` と `InMemoryTransport` の query 結果が一致することを検証
- 回帰: 既存の `sqliteGateway` / `inMemoryTransport` / `offscreenTransport` テストが新 gateway 経由で green

## 見積もり
2 pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `SqliteGateway` 390l 1クラスが分割され `SqliteClient` shim が削除されている（`grep` で確認）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` §5.4 SqliteGateway 節を分割前提に更新）
- [ ] `npm run validate` green

## 実装メモ（任意）
- 分割後のファイル配置は `src/background/sqlite/offscreenGateway.ts` / `dashboardGateway.ts` / `queryPlan.ts`（共有）のサブディレクトリも検討。
- Dashboard の confirm-token dance（`create_confirm_token` → `msg.payload.confirmToken` + `tokenExempt`）は `DashboardGateway` に閉じ、`confirmTokenManager.ts` との境界を明確にすること。
