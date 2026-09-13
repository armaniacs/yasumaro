# PBI 2026-09-12-42 — テキスト検索回帰の多層防御テスト（症状回帰 + 構造対策）

- **種別**: ✅功能追加（test・検索回帰の恒久防止）
- **優先度**: 1 位 / RICE **40.0**（R25 × I2 × C80% / E1.0人日）
- **出典**: round 14 のテキスト検索回帰（`normalizeStorageQuery` text 欠落 + OPFS routing 誤配送）の恒久防止。ユーザー報告「東京大学で検索、ガバメントで検索も同じ」を直接 pin

## ユーザーストーリー

開発者として、テキスト検索の回帰が unit/integration テストで自動検出されることがほしい。なぜなら、検索破壊がユーザー手動発見になる前に阻止したいから。

## ビジネス価値

検索破壊の再発を「ユーザー手動発見（数日後）」から「CI 即座検出」に短縮。測定: 本 PBI のテストが round 12/13 クラスの回帰（text 欠落・routing 誤配送）を検出すること。

## BDD受け入れシナリオ

```gherkin
Scenario: 異なるトピックの検索は異なる結果を返す（症状回帰）
  Given 3 つの異なるトピック（大学・プリンタ・レシピ）の行がシードされている
  When 各トピックのキーワードで検索する
  Then 各検索の結果集合は互いに素であり、シードされた該当行のみを含む

Scenario: StorageQuery の全フィールドが正規化を生き残る（構造対策）
  Given 全フィールド（text/tag/starred/domain/orderBy/orderDir/limit/offset/dateFrom/dateTo/gistSynced/ids/excludeDeleted）が設定された StorageQuery
  When normalizeStorageQuery に通す
  Then 全フィールドが保存される（allowlist 更新漏れを機械的検出）

Scenario: 実エンジンで日本語テキスト検索が動作する（連鎖 D）
  Given FTS5 trigram と LIKE の両パスで日本語クエリを検索する
  Then 4 文字以上は FTS、2 文字以下は LIKE で該当行が返る
```

## 受け入れ基準

- [x] `search-distinct-results.test.ts` 新設: 3 トピック × 3 backend（IDB/OPFS/fallback）で結果集合が互いに素
- [x] `queryNormalize.test.ts` に field preservation contract 追加（全フィールド生存 assert・新フィールド追加時に FAIL）
- [x] `StorageQuery` に `satisfies` 網羅性チェック追加（コンパイル時の field 追加漏れ検出）
- [x] 日本語 corpus（FTS 4 文字 / LIKE 2 文字 / 大文字小文字混在）の unit test
- [x] 既存テスト green

## 見積もり

1pt

## 技術的考慮事項

- 依存関係: なし
- テスタビリティ: 3 backend のシード harness は既存 `query-backends-parametric.test.ts` のパターンを再利用
- 非機能要件: 日本語（CJK trigram）対応は既存 FTS5 `tokenize='trigram'` に依存

## 実装者向け注記

### 現状コードの確認

```bash
# 検索回帰テストの既存実装を確認
grep -rn "distinct\|search-distinct" src/offscreen/__tests__/ testDir/e2e/
# text 保持テストの確認（PBI 2026-09-12-34 で追加済み）
grep -rn "text preservation" src/offscreen/__tests__/queryNormalize.test.ts
```

text 保持 unit test（queryNormalize.test.ts 末尾 2 件）と OPFS routing pin（sqlite-search-fts5.test.ts SEARCH メッセージ assert）は実装済み。本 PBI はその拡張（symptom test + 構造対策 + 日本語 corpus）。

### 実装手順

1. `src/offscreen/__tests__/searchDistinctResults.test.ts` 新設: FallbackStorage（実エンジン JS）で 3 トピックシード → 3 クエリ → 結果集合 assert。IDB/OPFS は stub では SQL を実行しないため、FallbackStorage で symptom を pin し、real-engine は `realEngineLikeSearch.test.ts` パターン（better-sqlite3）で補完
2. `queryNormalize.test.ts` に全フィールド生存テスト追加: StorageQuery の全 optional フィールドに値を設定 → normalizeStorageQuery 経由で全フィールドが一致することを assert。新フィールド追加時に FAIL する（normalizer 更新漏れの機械的検出）
3. `src/utils/sqlite-types.ts` の StorageQuery に対し、テスト側で `satisfies` を使った網羅性チェックを追加（コンパイル時に型欠落を検出）
4. 日本語 corpus: `realEngineLikeSearch.test.ts` に '研究所'（4 文字・FTS）と '大学'（2 文字・LIKE）ケース追加

### 落とし穴

- 3 backend の stub では SQL が実行されない — symptom test は FallbackStorage（実 JS エンジン）で pin し、SQL backend は better-sqlite3 で実行する（round 14 の教訓: stub は shape のみ検証）
- `pickDefined` は値が undefined のキーを落とす — 空文字 '' は保持されるため、text='' は「検索なし」扱いになる（正しい契約）。空文字で全件返ることを regression テストに明記
- better-sqlite3 の trigram tokenizer は CJK 3 文字以上で動作 — 2 文字クエリは LIKE path を使う（shouldUseFts5 は charLen >= 3）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] mutation proof（text 欠落・routing 誤配送の再現ブランチで red 確認）
- [x] コードレビュー完了
- [x] ドキュメント更新済み（TEST_RULE に symptom test の指針追記は PBI 44 で実施）
```

## 実装メモ（2026-09-12）

- `searchDistinctResults.test.ts` 新設（7 tests）: FallbackStorage 実エンジンで 3 トピック distinct・field preservation contract（13 フィールド全生存）・satisfies 型ガード
- `tagCorpusParity.test.ts` に日本語 corpus 4 tests 追加（CJK trigram/LIKE 境界・ASCII case-fold within CJK rows）
- **テストケース修正**: full-width `ＡＩ` は SQL LIKE の ASCII case-fold 対象外のため、ASCII within CJK rows ケースに修正
- 検証: offscreen 全 81 ファイル 1102 tests green・type-check green・lint 0 errors
- IDB/OPFS backend の symptom pin は realEngineLikeSearch（better-sqlite3）と routing pin（sqlite-search-fts5）で既に担保済み
