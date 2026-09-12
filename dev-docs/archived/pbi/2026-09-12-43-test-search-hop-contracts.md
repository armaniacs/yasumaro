# PBI 2026-09-12-43 — テキスト検索のホップ契約 + rank 実行保証テスト

- **種別**: ✅功能追加（test・境界契約の pin）
- **優先度**: 2 位 / RICE **20.0**（R20 × I1 × C80% / E0.8人日）
- **出典**: round 13/14 のなぜなぜ分析 連鎖 B/C/H/J — テキストが通過する全ホップで契約を pin し、どの hop で落としても即特定できるようにする

## ユーザーストーリー

開発者として、テキスト検索パスの全境界（dashboard→SW→gateway→offscreen→worker）で「text が保持されること」「正しいハンドラに配送されること」がテストされることがほしい。なぜなら、どの hop で欠落しても即座に原因箇所を特定できるから。

## ビジネス価値

検索破壊時の原因特定時間を「全パス調査（数時間）」から「失敗テストのファイル名特定（数分）」に短縮。測定: text をどこかの hop で落とすミューテーションが、対応する契約テストを FAIL させること。

## BDD受け入れシナリオ

```gherkin
Scenario: buildSearchParams が query を text に写像する
  Given subtype:'search' の payload に query:'研究所' が含まれる
  When buildSearchParams を呼ぶ
  Then 戻り値の text が '研究所' になる

Scenario: gateway kind:'search' が StorageQuery に text を載せる
  Given kind:'search' の op に text:'研究所' が含まれる
  When gateway.query を呼ぶ
  Then SQLITE_QUERY ペイロードに text:'研究所' が含まれる

Scenario: planQuery が text を保持する
  Given payload に text:'研究所' が含まれる
  When planQuery を呼ぶ
  Then 戻り値の text が '研究所' になる

Scenario: orderBy:'rank' が全 backend で SQL エラーにならない
  Given 3 backend にシードされた行がある
  When query({ text, orderBy: 'rank' }) を実行する
  then 3 backend とも SQL エラーではなく正常応答を返す
```

## 受け入れ基準

- [ ] `readOnlyHandler.test.ts` に buildSearchParams の query→text 写像テスト追加
- [ ] `offscreenGateway.test.ts`（新規）に kind:'search' → SQLITE_QUERY ペイロードの text 保持テスト追加
- [ ] `queryPlanner.test.ts` に planQuery の text 保持テスト追加
- [ ] rank ソート実行保証: 3 backend × `{text, orderBy:'rank'}` が SQL エラーなしで応答（IDB は better-sqlite3 実行、OPFS/fallback は実装パターン assert）
- [ ] 既存テスト green

## テスト戦略（t_wadaスタイル）

### E2E テスト
- （PBI 44 に委譲）

### 統合テスト
- gateway hop: kind:'search' → SQLITE_QUERY ペイロード変換
- readOnlyHandler hop: buildSearchParams query→text

### 単体テスト
- planQuery hop: text 保持
- backend hop: rank ソート実行保証（better-sqlite3 実行）

## 実装アプローチ

- **Outside-In**: dashboard 側（readOnlyHandler）から worker 側（queryPlanner）へ hop 順にテスト追加
- **Red-Green-Refactor**: 各 hop で「text を落とすミューテーション → 対応テストが red」を確認してからグリーン

## 見積もり

1pt

## 技術的考慮事項

- 依存関係: PBI 42（symptom test）と独立して実施可能
- テスタビリティ: 各 hop は純粋関数または vi.mock で検証可能
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認

```bash
# 各 hop の現状を確認
grep -n "buildSearchParams" src/background/handlers/dashboardSqlite/readOnlyHandler.ts
grep -n "kind: 'search'" src/background/sqlite/offscreenGateway.ts
grep -n "export function planQuery" src/offscreen/queryPlanner.ts
```

4 hop のうち normalizeStorageQuery（offscreen hop）と OpfsWorkerBackend（worker hop）の pin は round 14 で実装済み。本 PBI は残り 2 hop + rank 実行保証。

### 実装手順

1. `readOnlyHandler.test.ts`（新規作成）: buildSearchParams({query:'研究所', limit:10}) → {text:'研究所', limit:10} を assert
2. `offscreenGateway.test.ts`（新規作成）: gateway.query({kind:'search', text:'研究所'}) が callInternal に渡すペイロードに text:'研究所' が含まれることを assert（callInternal を vi.spyOn）
3. `queryPlanner.test.ts` に planQuery({text:'研究所'}) → text 保持を追加
4. rank 実行保証: `realEngineLikeSearch.test.ts` に `orderBy:'rank'` ケースを追加（FTS JOIN SQL が実行できること）

### 落とし穴

- gateway の `callInternal` は private メソッド — vi.spyOn では (gateway as any).callInternal を spy するか、offscreen への postMessage モックで検証する（後者が契約に忠実）
- readOnlyHandler の buildSearchParams は純粋関数 — import して直接 assert できる
- `orderBy:'rank'` は plain listing（buildOrderByClause）では `Invalid orderBy` エラーになる（意図的）— 本テストは search path（buildFts5OrderClause）のみを検証する

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] mutation proof（各 hop で text 落とし → 対応テスト red 確認）
- [x] コードレビュー完了
- [x] ドキュメント更新済み

## 実装メモ（2026-09-12）

- `searchHopContracts.test.ts` 新設（6 tests）: hop 1（buildSearchParams query→text 写像 2 件）+ hop 2（gateway kind:search → SQLITE_QUERY ペイロード text 保持 2 件）+ hop 3（planQuery text 保持 2 件・単独 + 組合せフィルタ）
- `realEngineLikeSearch.test.ts` に rank 実行保証テスト追加（FTS JOIN + `ORDER BY rank` が better-sqlite3 実エンジンで実行できること — trigram 3 文字境界のため 'run' を使用）
- `makeDb()` に FTS テーブル + FTS index row を追加（rank JOIN の JOIN 先が必要）
- 検証: searchHopContracts 6 + realEngineLikeSearch 7 tests green
