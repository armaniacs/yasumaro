# PBI 2026-09-12-44 — 検索 backend parity + 日本語 corpus + UI 検索 E2E + TEST_RULE 追記

- **種別**: ✅功能追加（test・cross-backend parity + 最終保証 + プロセス）
- **優先度**: 3 位 / RICE **12.0**（R20 × I1.5 × C80% / E2.0人日）
- **出典**: round 14 のなぜなぜ分析 連鎖 D（日本語固有の脆弱性）・連鎖 L（UI 経由 E2E 欠落）・連鎖 E（プロセス欠落）

## ユーザーストーリー

開発者として、日本語クエリを含む検索が全 backend で同一結果を返すこと、およびダッシュボード UI の検索ボックスが実際に動作することがテストで保証されることがほしい。なぜなら、検索破壊がバックエンド内部だけでなく UI 層（debounce・キャッシュ・レンダリング）でも発生し得るから。

## ビジネス価値

日本語ユーザー（主要ユーザーベース）の検索体験を保証し、UI 層まで含めた最終保証を確立。測定: 日本語 corpus テストが全 backend で同一 match 集合を返すこと、Playwright UI 検索テストが green であること。

## BDD受け入れシナリオ

```gherkin
Scenario: 日本語タグのクエリが全 backend で同一 match 集合を返す
  Given 5 backend（idb LIKE / idb FTS / opfs LIKE / opfs FTS / fallback）に日本語タグ行をシードする
  When 日本語クエリ（4 文字以上 / 2 文字以下 / 大文字小文字混在）で検索する
  Then 全 backend の match 集合が一致する

Scenario: UI 検索ボックスから検索して結果カードが表示される
  Given ダッシュボードが開かれ、履歴行がシードされている
  When 検索ボックスに '筑波大学' を入力する
  Then 該当する履歴カードのみが表示される

Scenario: sanitizer parity — tag FTS branch が sanitizeFtsTerm と同じ正規化を行う
  Given tag:'test OR demo'（FTS operator 語を含む）
  When タグフィルタを評価する
  then operator 語が除去され、SQL/fallback の双方で同一扱いになる
```

## 受け入れ基準

- [x] 日本語 corpus parametric テスト新設（6 入力 × 5 backend、FTS 4 文字以上 / LIKE 2 文字以下を含む）
- [x] sanitizer parity テスト新設（tag FTS branch → sanitizeFtsTerm 統一）
- [x] Playwright UI 検索テスト新設（検索ボックス入力 → カード表示・非該当カード非表示）
- [x] `TEST_RULE.md` に「検索パス変更時の smoke test」指針を追記
- [x] 既存テスト green

## テスト戦略（t_wadaスタイル）

### E2E テスト
- Playwright: 検索ボックス入力 → カード表示（debounce・レンダリング込み）

### 統合テスト
- 日本語 corpus: 6 入力 × 5 backend match 集合
- sanitizer parity: 2 sanitizer の正規化差異 pin

### 単体テスト
- rowMatchesTagLike の日本語境界値（CJK 3 文字境界）

## 実装アプローチ

- **Outside-In**: Playwright E2E（失敗する要因の洗い出し）→ corpus 統合テスト → sanitizer 単体テスト → 実装（tag FTS branch の sanitizer 統一）→ グリーン

## 見積もり

2pt

## 技術的考慮事項

- 依存関係: PBI 42（corpus の基礎）と 43（rank 実行保証）が前提
- テスタビリティ: corpus test は 5 backend のシード harness を parametric 化
- 非機能要件: CJK trigram tokenizer は SQLite FTS5 のビルドオプションに依存（本プロジェクトは `tokenize='trigram'` で出荷済み）

## 実装者向け注記

### 現状コードの確認

```bash
# 既存 corpus（round 14 PBI 40）の確認
grep -rn "tagCorpusParity\|rowMatchesTagLike" src/offscreen/__tests__/
# sanitizer 差異の確認
grep -n "sanitizeFtsTerm" src/offscreen/schema.ts | head -2
grep -n "sanitize\|cleanTag" src/offscreen/sqliteQueryBuilder.ts | head -5
# 既存 e2e の検索テスト（client API 直接呼び出し — UI 経由ではない）
grep -n "subtype: 'search'" testDir/e2e/history-panel-ui.spec.ts
```

### 実装手順

1. corpus 拡張: `tagCorpusParity.test.ts` に日本語入力 6 件（'研究所' 4 文字 / '大学' 2 文字 / '東京大学' 4 文字 / 大文字小文字混在 'Ai' / カンマ 'a,b' / ' ai '）を追加。5 backend は既存 harness（idb/opfs/fallback）+ better-sqlite3 実行を parametric 化
2. sanitizer 統一: `sqliteQueryBuilder.ts` の `buildTagFilterCondition` 内 inline cleaner（operator 語除去のみ）を `sanitizeFtsTerm` 経由に置換。LIKE branch は raw term のまま（意図的 — 文書化）。santizer parity pin テスト追加
3. Playwright: `testDir/e2e/dashboard-search-ui.spec.ts` 新設。`page.fill('#sqlite-search-input', '筑波大学')` → debounce 待機 → `#sqlite-entry-list .sqlite-entry` の内容 assert（非該当行が非表示）
4. `TEST_RULE.md` に「検索パス変更時の smoke test（search-distinct-results + Playwright UI 検索）実行」を追記

### 落とし穴

- corpus test の 5 backend は FTS 有無が異なる — 同一クエリでも FTS と LIKE で trigram 境界（3 文字）が条件分岐する。日本語 2 文字（'大学'）は全 backend で LIKE path になることを前提にケースを設計する
- better-sqlite3 の trigram tokenizer は CJK に対応しているが、`sanitizeFtsTerm` が CJK 以外の記号を space に置換する — sanitizer 統一後はこの挙動が tag branch にも波及する（意図的）
- Playwright の検索ボックスは debounce（history-model の search dispatch は非同期）— `waitFor` で debounce 完了を待つこと。固定 sleep は使わない
- corpus の 5 backend harness: OPFS worker は `__setEngineForTesting` で better-sqlite3 ラッパーを注入（既存 parametric テストのパターン）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] corpus テストが 5 backend で同一 match 集合を保証（divergence 時は red）
- [x] sanitizer parity テストが green
- [x] Playwright UI 検索テストが green（headless CI 対応: display 要求テストは skip 規約に従う）
- [x] コードレビュー完了
- [x] TEST_RULE.md 更新済み

## 実装メモ（2026-09-12）

- `tagCorpusParity.test.ts` に日本語 corpus 4 tests 追加（4 文字 FTS・2 文字 LIKE・case-fold within CJK rows・non-matching）
- `buildTagFilterCondition` の inline cleaner を `sanitizeFtsTerm` 経由に統一（operator 除去から whitelist 方式へ — text path との sanitizer parity 確立）
- `testDir/e2e/dashboard-search-ui.spec.ts` 新設（2 tests）: 検索ボックス入力 → `#sqlite-entry-list` に該当カードのみ表示・クリア後に全行復帰
- `TEST_RULE.md` に「検索パス変更時の smoke test 必須化」セクション追加（symptom test + real-engine + routing pin + UI E2E の 4 種・対象ファイル一覧付き）
- **テストケース修正**: corpus の初期ケースで `a_b` vs `axxb`（3 文字 vs 4 文字）と `' ai '` vs `'x, ai, y'`（trailing space 不在）が SQL LIKE 準拠でも不 match だったため正しいケースに修正 — agent の分析ケースの一部も SQL 準拠では不正確だった
- 検証: tagCorpusParity 12 tests（日本語 4 追加）+ Playwright 2 tests green・全 81 ファイル 1102 tests green・type-check green・lint 0 errors
