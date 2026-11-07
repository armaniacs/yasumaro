# PBI-2026-11-07-06: JS-Rust CLI対応表ドキュメントで意味的所有権の二重化を検出可能にする

- ランク: 6/9 (holistic改善ラウンド)
- RICE: 1.0 (R2 / I0.5 / C1.0 / E1)
- 依存: なし
- テーマ: JS-Rust CLI意味的二重所有 (drift検出用、コード生成は対象外 - YAGNI)
- 見積: 1SP

## ユーザーストーリー

ドキュメント保守者として、JS参照実装とRust移植の対応関係を1つの対応表で確認したい。なぜなら二重所有の差分(drift)を早期に検出し、仕様の食い違いを防ぎたいからである。

## 背景

Rust CLIはJS参照実装の正確な移植として宣言されている。`cli/src/queries.rs:1-26` のモジュールコメントは `tools/yasumaro-cli/queries.mjs` (ブランチ `feature/yasumaro-cli`) の意味を正確に移植すると明記している。現状はコード内コメントに分散しており、JS側の1行がRust側のどの行に対応するかを一覧で追えない。

確認済み対応点は次の通りである。

- `cli/src/queries.rs:36-50` の `DISPLAY_COLUMNS` はJS側 `DISPLAY_COLUMNS` (13カラム: `id`, `url`, `title`, `summary`, `tags`, `created_at`, `domain`, `visit_duration`, `scroll_ratio`, `is_starred`, `is_deleted`, `obsidian_synced`, `gist_synced`) に対応する。
- `cli/src/queries.rs:52` の `FTS_MIN_CHARS = 3` はJS側 `FTS_MIN_CHARS` に対応する。
- `cli/src/queries.rs:55` の `SEARCH_MAX_CHARS = 200` はJS側 `SEARCH_MAX_CHARS` に対応する。
- `cli/src/queries.rs:145` の `sanitize_fts_term` (引用符除去、trim、200文字切詰め) はJS側 `sanitizeFtsTerm` に対応する。
- `cli/src/queries.rs:155` の `escape_like` (`\`, `%`, `_` のエスケープ) はJS側 `escapeLike` に対応する。
- `cli/src/main.rs:59-198` の `SearchArgs` / `ListArgs` / `ShowArgs` / `StatsArgs` / `ExportArgs` はJS側の引数定義に対応する。
- `cli/src/main.rs:321-334` の `filter_flags!` マクロは検索系フィルタ (`domain`, `tag`, `starred`, `limit`, `offset`, `from`, `to`) の集約点である。
- `cli/src/main.rs:233-248` の `usage_text` はJS側 `tools/yasumaro-cli/cli.mjs` の `HELP` 文字列と文単位で一致しなければならない。
- JS参照はブランチ `feature/yasumaro-cli` 配下の `tools/yasumaro-cli/` に存在し、`git show` 経由でのみ参照する。変更は加えない。

## BDDシナリオ

### シナリオ1: DISPLAY_COLUMNSと定数の対応が記録される

- Given JS参照 `queries.mjs` の `DISPLAY_COLUMNS`, `FTS_MIN_CHARS`, `SEARCH_MAX_CHARS` が存在する
- When 対応表ドキュメントを作成する
- Then JS側の各行に対応するRust側の行 (`queries.rs:36-50`, `queries.rs:52`, `queries.rs:55`) が対応記録として残る

### シナリオ2: HELP文の文単位対応が記録される

- Given JS側 `cli.mjs` の `HELP` とRust側 `main.rs:233-248` の `usage_text` が存在する
- When 対応表ドキュメントを作成する
- Then 両者の文単位の対応関係が対応記録として残り、差分検出手順が文書化される

### シナリオ3: FTS分岐とフィルタの対応が記録される

- Given JS側 `sanitizeFtsTerm` / `escapeLike` / `filters` / `searchLogs` / `listLogs` が存在する
- When 対応表ドキュメントを作成する
- Then Rust側 `sanitize_fts_term` (`queries.rs:145`) と `escape_like` (`queries.rs:155`) およびフィルタ条件への対応が対応記録として残る

## 受け入れ条件

1. [ ] JS側の行からRust側の行へのコメント対応表が存在し、`DISPLAY_COLUMNS`, `FTS_MIN_CHARS`, `SEARCH_MAX_CHARS`, `sanitize_fts_term` / `sanitizeFtsTerm`, `escape_like` / `escapeLike`, `filter_flags!`, `usage_text` / `HELP` を網羅する。
2. [ ] 対応表はdrift検出に直接使える形式である (JS更新時に照合すべきRust側の行が一意に定まる)。
3. [ ] `usage_text` (`main.rs:233-248`) とJS `HELP` の文単位照合結果が記録され、不一致があれば差分として明記される。
4. [ ] ドキュメントはdocs-charset規約に適合する (Shift-JIS安全文字のみ、絵文字なし、EM DASH不使用、ハイフン使用)。
5. [ ] 振る舞い変更を含まない (ドキュメント追加のみで、RustコードとJSコードの変更はなし)。
6. [ ] JS参照の取得手段 (`git show feature/yasumaro-cli:tools/yasumaro-cli/...`) と参照時点のcommitが記録される。

## 調査・文書化手順 (テスト戦略の代替)

1. `git show feature/yasumaro-cli:tools/yasumaro-cli/queries.mjs` と `git show feature/yasumaro-cli:tools/yasumaro-cli/cli.mjs` でJS参照を取得する (書込み禁止)。
2. `cli/src/queries.rs:1-26`, `:36-50`, `:52`, `:55`, `:145`, `:155` と `cli/src/main.rs:59-198`, `:233-248`, `:321-334` をRead/Grepで再確認する。
3. JS行からRust行への対応表を作成し、未確認項目があれば `要確認` と明記する。
4. `usage_text` とJS `HELP` を文単位で突き合わせ、差分有無を記録する。
5. `node scripts/check-docs-chars.mjs` 相当の文字種検査でShift-JIS安全性を確認する。
6. コード生成やリファクタは行わない (YAGNI)。drift検出のための記録に限定する。

## DoD (未チェック)

- [ ] 対応表ドキュメントが配置されている
- [ ] 受け入れ条件1-6をすべて満たす
- [ ] 文字種検査が正常終了する
- [ ] 振る舞い変更がない (docsのみ)
