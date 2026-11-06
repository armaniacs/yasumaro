# yasumaro CLI 設計

- 日付: 2026-11-06
- 状態: 設計承認済み(読み取り中心・Obsidian CLI 準拠)
- 目的: yasumaro が作った履歴 SQLite を、ターミナルから読み取り・分析できる CLI を作る。Obsidian CLI の使い勝手(全文検索・無引数 TUI・Ctrl+R・AI 連携・--copy)を基準にする。起動は `yasumaro` コマンドにする。

## 第1節 背景と制約

- 本体の履歴 DB は拡張機能の OPFS 内の `yasumaro.db` である。正の定義は `src/offscreen/dbFilename.ts` の `DB_FILENAME` だけである。OPFS Worker + sqlite-wasm で開いており、Node から直接開くことはできない。
- 稼働中の OPFS 実体を直接探して開く方式は採らない。プロファイルや版依存が強く、WAL とロックの関係で壊しやすいためである。
- 取り出し口は既存のものを使う。Dashboard の `exportDb()` (`src/dashboard/exportLogsService.ts`) が `backupDb()` のバイナリ `.db` をダウンロードさせる。中身は `handleBackup` (`src/offscreen/opfsWorker/backupHandlers.ts`) が OPFS から読んだ素の SQLite である。アーカイブ機能のダウンロード物も標準 SQLite として扱う。
- Node 側の読み手は `better-sqlite3` を使う。すでに devDependencies にあり、テストが実 DB 相当として使っている。CLI のために新規の DB 駆動を追加しない。
- フルバックアップ `.db` には FTS5 があるが、アーカイブ形式の `.db` は FTS なしが前提である(`ALLOWED_TABLES` は `browsing_logs` / `yasumaro_archive_meta` / `sqlite_sequence` のみ)。CLI は FTS 有無で MATCH / LIKE を切り替える。切替の考え方は `src/offscreen/sqliteQueryBuilder.ts` に寄せる。
- 対象表は当面 `browsing_logs` のみとする。`audit_log` は将来拡張に残す。

## 第2節 全体方針

- 方式はエクスポートファイルを読む CLI とする。拡張機能側の変更は不要である。
- 初版は読み取り専用とする。書き込み(スター・削除・タグ編集)はやらない。DB は必ず read-only で開く。
- フィルタ語彙は `StorageQuery` (`src/utils/sqlite-types.ts`) に寄せ、Dashboard と挙動を揃える。`EXPORT_COLUMNS` (`src/offscreen/exportEnvelope.ts`) を表示の安定契約とし、列追加があっても CLI の既定表示は壊さない。
- 外部送信はしない。ローカルのみで動く。履歴は私的な内容を含むため、保存を伴う動作は明示指定のときだけ行う。

## 第3節 UX(Obsidian CLI 準拠)

- 全文検索は `yasumaro search --query "検索語"` とする。`obsidian search query="検索語"` に対応する形である。
- 引数なしの `yasumaro` は対話型シェル(REPL)を起動する。フルスクリーン TUI ではなく、Node 標準の readline による REPL とする。
- REPL の履歴検索は Ctrl+R とする。Node の readline の既定の Emacs 系キーバインド(reverse-i-search)を活かし、追加実装をしない。履歴は `~/.yasumaro_history` に残す。検索語は私的な内容を含むため、履歴ファイルの扱いは第8節に定める。
- 各コマンドに `--copy` を付与する。結果の主出力をクリップボードに送る。`--json` と併用時は JSON 文字列を送る。
- AI エージェント連携はパイプ前提とする。Claude Code や Cursor などターミナル上の LLM ツールから `yasumaro search --query "..." --json` のように呼べる。安定した JSON と終了符号だけを約束し、専用プロトコルは作らない。
- 起動は `yasumaro` コマンドとする。`node tools/yasumaro-cli.mjs` ではない。配布の詳細は第7節に定める。

## 第4節 コマンド体系(初版)

- `yasumaro search --query "語" [--domain 例.com] [--tag 名] [--starred] [--limit N] [--offset N] [--json] [--copy] [--db PATH]`
  - FTS があれば MATCH、なければ LIKE に落とす。3 文字未満は LIKE 側に寄せる。`excludeDeleted` は既定 true とする。
- `yasumaro list [--domain 例.com] [--tag 名] [--starred] [--from 日付] [--to 日付] [--limit N] [--offset N] [--json] [--copy] [--db PATH]`
- `yasumaro show --id N [--json] [--copy] [--db PATH]`
- `yasumaro stats [--db PATH] [--json]`
  - 件数、期間(最小・最大 created_at)、ドメイン上位、日別件数の概況を出す。分析パネルの集計を CLI に移植するほど凝らない。
- `yasumaro export --format json|csv|md [--query "語"] [絞り込みは search と同等] [--db PATH] [--out FILE]`
  - 既定は標準出力。`--copy` 併用時は標準出力と同じ文字列を送る。ファイル保存は `--out` 明示時のみとする。
- 共通旗: `--db PATH`、`--json`、`--copy`、`--limit`、`--offset`、`--help`、`--version`。
- DB 未指定時の解決順は次のとおり。`--db` 明示 > `YASUMARO_DB` 環境変数 > カレントの `./yasumaro.db`。見つからなければ一覧系は起動せず、入手手順を表示して終了符号 2 で終わる。

## 第5節 REPL 仕様

- `yasumaro` 単独で REPL を開く。終了は `exit` / `.exit` / Ctrl+D とする。
- 行内命令は `search 語...`、`show ID`、`stats`、`export ...`、`help`、`exit` とする。各行は対応する非対話コマンドと同じ処理に投げる。
- Ctrl+R は readline の履歴逆検索に任せる。自前の絞り込み UI は作らない。
- 履歴ファイルは `~/.yasumaro_history` とし、上限は 500 行とする。将来 `--no-history` を付けられる余地を残すが、初版の旗には含めない。履歴が私的な検索語を含む点は README と `--help` に明記する。
- 色付けは対話時のみとする。パイプ時(非 TTY)は色を付けない。AI 連携の出力を汚さないためである。

## 第6節 --copy 仕様

- 外部依存を追加せず、OS 標準命令に委ねる。macOS は `pbcopy`、Linux は `xclip` / `xsel` の順に探す、Windows は `clip` とする。子プロセス起動は Node 標準の `child_process` のみ使う。
- 命令が無い環境では終了符号 0 のままか、明確な警告付きの失敗かを選ぶ必要がある。初版は「複写に失敗した旨を標準エラーに出し、終了符号 3 で終わる」とする。本体出力は保持しない。
- 複写対象は「その呼び出しの主出力の全文」とする。表整形の装飾は含めず、`--json` 併用時は JSON 文字列そのものを送る。

## 第7節 配布と起動

- 置き場所は `tools/yasumaro-cli/` とする。入口は `tools/yasumaro-cli/cli.mjs` とし、先頭に shebang を付けて実行可能にする。
- `package.json` の `bin` に `"yasumaro": "tools/yasumaro-cli/cli.mjs"` を足す。利用は `npm link` または `npx` 経路を想定し、初版は npm 公開をしない。
- Node の版要求は既存の `engines` (`>=24.0.0`) に従う。新規の TUI 依存は足さない。readline と `child_process` だけで REPL・履歴・複写をまかなう。
- 依存追加がある場合は `scripts/check-licenses.mjs` の規約に従い、GPL 系を持ち込まない。`validate:json` の対象になるため `package.json` の整形規約も守る。

## 第8節 失敗時と私的情報の扱い

- 存在しない DB・開けない DB・表なし・FTS なしは、それぞれ理由を表示して終わる。FTS なしは失敗にせず LIKE に落とす。
- 復号が必要な暗号化バックアップ(`yasumaro-backup-*.encrypted.json`)は初版の入力に含めない。対象は素の `.db` のみとする。
- 検索語と REPL 履歴は私的な内容になり得る。履歴ファイルの場所と上限と削除法(`rm ~/.yasumaro_history`)を README と `--help` に書く。
- 終了符号は次のとおり。0 は成功、2 は入力・DB 解決の誤り、3 は複写の失敗、その他の内部失敗は 1 とする。`--json` 時も符号の約束は同じとし、標準出力の JSON 形は崩さない。

## 第9節 テスト

- 小さい fixture `.db` を `better-sqlite3` で作り、次を golden にする。FTS あり DB の MATCH、FTS なし DB の LIKE 落ち、削除済み除外の既定、`--json` の安定形、終了符号。
- CLI の表整形と JSON 整形の分岐、非 TTY での無色化、`--copy` 失敗時の符号 3 を単体で固める。実クリップボードへの依存は差し替え口で逃がす。
- 既存の `npm run validate` を壊さない。`type-check` と `lint` と関連単体試験を通す。

## 第10節 段階計画

- 第一段: 非対話の読み取り(`search` / `list` / `show` / `stats` / `export`)と `--db` / `--json` / `--copy` を作る。`yasumaro` の bin 配線まで含める。
- 第二段: 無引数 REPL と Ctrl+R 履歴を作る。履歴の上限と削除法の文書化まで含める。
- 第三段以降: `audit_log` の読み取り、保存済み条件の呼び出し、書き込み系(要復元設計)は別仕様とする。本仕様には含めない。
