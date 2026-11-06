# Task 7 Report: export 命令

## Implementation

`tools/yasumaro-cli/commands.mjs` に `runExport` を追加し、`runCommand` の `export` 分岐を配線した（`config` は従来通り `CliError('not implemented yet', 1)`）。

- **フォーマット**: `--format json`（未指定時は既定）→ `toJson(rows)` で stdout に JSON 配列（jq 対応）。`csv` → ヘッダ + 行。`md` → 1 レコード 1 行 `- [title](url)`。
- **CSV エスケープ**: `"` の倍化のみの最小実装。`,`・`"`・改行・CR を含む値だけ `"` で囲む。空（null/undefined）は空文字。
- **列**: `DISPLAY_COLUMNS` と `realColumns(db)` の積集合を `runExport` 内で算出（`queries.mjs` の `selectList` と同順・同集合、列リストの重複なし）。`selectList` 自体は非 export のため直接再利用せず、export 済みの構成要素を再利用した。
- **フィルタ**: search と同じ `--query/--domain/--tag/--starred/--from/--to/--limit/--offset/--db`。`--query` が非空なら `searchLogs`、空なら `listLogs`。日付・limit/offset の検証は既存 `parse*` を使い、不正は符号 2。
- **`--format` 不正**（例 `yaml`）→ DB を開く前に `CliError('invalid --format: ...', 2)`。
- **`--out FILE`**: `node:fs` の `writeFileSync`（`deps.writeFile` で差し替え可能、既定は `writeFileSync`）で書き込み、stdout は無音。書き込み失敗 → `CliError('cannot write ...', 1)`。
- **`--copy`**: 通常時は既存 `emit()` 経由。`--out` 併用時はファイルを書いた上で、stdout を null シンクに差し替えた `deps` で `emit()` を呼ぶ（同じ複写経路を通しつつ stdout を汚さない）。

## RED/GREEN evidence

- RED: 実装前に `npx vitest run tools/yasumaro-cli/__tests__/export.test.ts` → 10 件全 FAIL（`runExport is not a function` 9 件 + `runCommand` の `not implemented yet` 1 件）。
- GREEN: 実装後に `npx vitest run tools/yasumaro-cli/` → **7 ファイル・62 テスト全 PASS**（export 新規 10 件含む）。`npx eslint tools/yasumaro-cli/` → exit 0。

## Files changed (commit ac769858)

- `tools/yasumaro-cli/commands.mjs`（M: `runExport` + csv/md 整形 + `runCommand` 配線、`writeFileSync`・`DISPLAY_COLUMNS`・`realColumns` の import 追加）
- `tools/yasumaro-cli/__tests__/export.test.ts`（新規 10 件: json 配列 / csv 見出し / csv エスケープ / md 行 / 全フィルタ / --out 無音+読戻し / --out 失敗=1 / --format 不正=2 / --copy / runCommand 到達）
- `tools/yasumaro-cli/__tests__/commands.test.ts`（1 行のみ: `it.each(['export','config'])` → `['config']`。export が実装済みになったため旧プレースホルダ assertion が陳腐化。全体 green の門に必要だったため最小変更し、ここに記録する）

## Self-review

- `commands.test.ts` の 1 行変更は「他ファイルに触らない」指示への例外的逸脱。理由: Task 6 の placeholder test が新仕様と正面衝突し、触らなければ全体 green 門を満たせない。変更は assertion 対象の縮小のみで、実装ファイルには触っていない。
- `--format` 未指定の既定値は brief・plan とも未定義のため `json` とした（`--json` 系の既定動作・jq 親和性に整合）。`yaml` 等の明示的不正値は符号 2。
- md 行形式 `- [title](url)` は brief の門（`- ` 始まり）を超える最小選択。title/url 内の `]`・`)` はエスケープしない（最小実装の範囲）。
- 空 DB の csv は見出しのみ 1 行、md は空文字。json は `[]`。
- `--out` と `--copy` の併用は stdout 無音のまま clipboard に本文を渡す。stderr への copy 失敗警告と符号 3 は `emit` の既存動作をそのまま継承。
- `deps.writeFile` 注入はテスト容易性のため。既存流儀（`deps.dbOpener`・`deps.clipboard`）に倣った。

## Concerns

- なし。全体 green・lint clean・`feat:` コミット済み。`config` 分岐は Task 9 の担当のまま残している。
