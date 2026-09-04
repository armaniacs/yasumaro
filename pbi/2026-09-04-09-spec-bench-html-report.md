# ベンチ結果 HTML レポート設計

- 日付: 2026-09-04
- 状態: 承認済み（設計確定）
- 対象: `bench/harness/`（micro ベンチハーネス）

## 1. 目的

micro ベンチの実行結果（最新実行 + baseline 比較）を、依存ゼロの自己完結 HTML として出力し、ブラウザで即座に閲覧できるようにする。

本レポートの主役は PASS/FAIL 判定ではなく「どの指標がどれだけ動いたか」の視覚的差分支援である。`bench:check` のゲートは決定的カウンタのみで、wall-clock の判定は常に人間が行うため、人間の判定速度と正確さを上げることが目的。

要件:

- 開くまでの摩擦ゼロ（ベンチ実行後に自動でブラウザオープン）
- オフライン・`file://` でも確実に描画される（外部リソース参照ゼロ）
- 古い成果物がゴミとして残らない（自動ローリング保持 + 週次アンカー）

## 2. スコープ

### 対象

- micro ベンチ結果の HTML レンダラ新設
- ベンチ実行結果（`micro-<日付>.json`）の永続化
- `bench/reports/` の保持ポリシー（ローリング 5 世代 + 週次アンカー）と `bench:clean` コマンド
- e2e ベンチ（Playwright）実行後の同じ保持ポリシー適用

### 対象外

- 履歴トレンドビュー（日付横断の推移グラフ）— `micro-<日付>.json` の蓄積を素材に将来拡張する
- e2e 結果の HTML レンダリング（JSON 出力のみでよい）
- `scripts/benchmark-cleansing.mjs`（単一ベンチの互換ラッパ。Markdown 出力のまま）
- `bench:check` の終了コード体系・ゲート対象メトリクスの変更
- CI への `bench:check` 組み込み（`.gitignore` と `bench/` 追跡対象の整合が別途必要）

## 2.1 隠れた仮定の検証（なぜなぜ分析の結論）

| 仮定 | 結論 |
|------|------|
| 履歴トレンドを最初から作るべきか | 不要。カウンタは決定的で baseline 比較に信号が十分。wall-clock の履歴トレンドは共有マシンの ±100% ノイズで誤解を招く。ただし将来の trend 開発に備え生データ（JSON）は保存する |
| CDN（Chart.js / Tailwind）利用 | 不採用。bench 実行環境は SSH・オフラインになりがち。`file://` で確実に描画される自己完結（インライン SVG + 手書き CSS）とし、「外部参照ゼロ」をテストで自動保証する |
| レポート保存先 | `bench/reports/`（gitignore 対象）。architecture-review の temp dir 方式と異なり、日付付きで隣接実行と比較する用途のため保存する。リポジトリ汚染はしない |
| Markdown / HTML の二重レンダリングによるドリフト | 数値整形（`fmtNum` 等）を共有ヘルパに切り出し、両レンダラから参照する |
| HTML インジェクション | bench id・説明はリポジトリ内文字列だが、一律 HTML エスケープする |

## 3. コンポーネント

### 3.1 `bench/harness/format.mjs`（新規）

数値整形ヘルパ。`report.mjs` の `fmtNum` を移動し、`report.mjs` と `htmlReport.mjs` の両方から import する。パーセント差・KB 変換などの整形もここに集約する。

### 3.2 `bench/harness/htmlReport.mjs`（新規）

`renderHtml(results, opts) => string`。既存 `renderMarkdown` と同じ入力（`results` 配列 + `comparison` オブジェクト）を受け取る純関数。I/O なし。

- インライン CSS + 最小限のインライン JS のみ。`src=` / `href=` に外部 URL を一切含まない
- 注入するすべての文字列を HTML エスケープする

### 3.3 `bench/harness/cli.mjs` への配線

- Markdown 書き出しの直後に、同一スタンプで HTML と JSON も書き出す:
  - `bench/reports/micro-<日付>.html`
  - `bench/reports/micro-<日付>.json`（`results` + `comparison` をそのまま永続化）
- レポート書き出し完了後、`pruneReports()`（3.5）を呼び、`bench/reports/` を自動掃除する
- 自動オープン: 以下の**すべて**を満たす場合のみレポートをブラウザで開く
  - `--no-open` フラグがない
  - `process.env.CI` 未設定
  - TTY が接続されている（インタラクティブセッション）
  - オープンコマンド: macOS `open` / Linux `xdg-open` / Windows `start`
- オープン失敗は stderr への注意喚起のみ。ベンチ実行の成否に影響しない

### 3.4 `scripts/benchmark-cleansing.mjs`

変更しない。単一ベンチの互換ラッパであり、Markdown 出力を維持する。

### 3.5 `bench/harness/clean.mjs`（新規）

`bench/reports/` 専用の掃除モジュール。

**保持ポリシー（自動適用）:**

1. ローリング保持: 日付スタンプ（世代）の新しい順に 5 世代を保持
2. 週次アンカー: 各 ISO 週について、その週に属する世代のうち最新の 1 世代を保持する。ローリング 5 に含まれる世代は既に保持済みのため、アンカーが実効的に追加するのは 5 世代より古い世代のみ（各週 1 件。年間最大 52 世代と有界）
3. 削除単位は世代（同一日付スタンプのファイル群）単位。`micro-<日付>.md/.html/.json` や `e2e-<名前>-<日付>.json` を必ずまとめて削除し、単一ファイルだけ残る片足状態を防ぐ
4. 安全側の保護:
   - `YYYY-MM-DD` スタンプを持たないファイルは自動掃除では削除しない
   - 削除対象は `bench/reports/` 配下のみ。`bench/baselines/`、`bench/harness/`、`bench/micro/`、`bench/e2e/`、`bench/fixtures/`、`bench/README.md` には触れない
   - `bench/reports/` が存在しない場合は no-op

**CLI:**

- `npm run bench:clean` — 上記ポリシーを適用
- `npm run bench:clean -- --all` — `bench/reports/` を全消去

**e2e への配線:** Playwright bench config（`bench/playwright.bench.config.ts`）の `globalTeardown` で `pruneReports()` を呼ぶ。

### 3.6 `package.json`

- `"bench:clean": "node bench/harness/clean.mjs"` を追加

### 3.7 docs 更新

`docs/PERFORMANCE_TEST.md` に以下を追記する:

- コマンド表に `bench:clean` の行
- 保持ポリシー（ローリング 5 世代 + 週次アンカー、世代単位削除）の説明

## 4. HTML レポート仕様

- **ヘッダ**: 生成日時・Node バージョン・ベンチ一覧・baseline 比較の総合判定バッジ（PASS=緑 / REGRESSED=赤）
- **ベンチカード（id ごと）**:
  - id + 説明、warmup / measure
  - スケーリング指数 + verdict バッジ（sub-linear / linear / super-linear / quadratic / polynomial-or-worse で色分け）
  - S / M / L 各サイズの wall p50 / p95 / p99 をグループ化した横棒グラフ（インライン SVG 自前描画）
  - heap p50、counters をチップ表示
- **baseline 比較テーブル**: metric / baseline / current / Δ% / status
  - `regressed` = 赤、`improved` = 緑、`worse-ungated` = 琥珀、`ok` / `new` = 中立色
  - デフォルトは動いた指標のみ表示（Markdown と同じ方針）。トグルで全行表示
- 見た目: 手書き CSS のカードレイアウト + 等幅数字。依存グラフ等のグラフ形状データが無いため Mermaid は使わない

## 5. 成果物とライフサイクル

| 成果物 | 蓄積単位 | 保持 |
|---|---|---|
| `bench/reports/micro-<日付>.md` | 1日1ファイル（同日は上書き） | ローリング 5 世代 + 週次アンカー |
| `bench/reports/micro-<日付>.html` | 同上 | 同上 |
| `bench/reports/micro-<日付>.json` | 同上 | 同上 |
| `bench/reports/e2e-<名前>-<日付>.json` | e2e 実行ごと | 同上 |
| `bench/baselines/micro.json` | 常に 1 ファイル上書き | 削除しない（コミット対象の基準値） |

`dev-docs/benchmark-cleansing-*.md` は bench/ 外の意図的なドキュメントであり、本設計の管轄外。

## 6. エラーハンドリング

- HTML / JSON 生成は try/catch で包む。失敗しても Markdown レポートは書かれ、bench 実行自体は成功扱い（stderr に警告、exit コードに影響なし）
- `pruneReports()` の失敗も同様にベンチ実行の exit コードに影響しない
- ブラウザオープン失敗は stderr に注意喚起のみ

## 7. テスト計画

`bench/harness/__tests__/`（vitest）に追加:

- **`htmlReport.test.ts`**
  - bench id・スケーリング指数・baseline 比較行が HTML に含まれること
  - status 色分けクラス（`regressed` / `improved`）が正しく付くこと
  - `src=` / `href=` に `http(s)://` を含む外部参照が一切無いこと（自己完結性の保証）
  - 注入文字列（id・description）が HTML エスケープされること
- **`clean.test.ts`**
  - ローリング 5 世代の選択（新しい世代から 5 件残し、残り削除）
  - 週次アンカーの選択（5 世代からあふれた各 ISO 週の最新世代が残る）
  - 世代単位のグループ削除（同日付の .md / .html / .json がまとめて消える）
  - 日付スタンプなしファイルの保護
  - `bench/baselines/` が無傷であること
  - `reports/` 欠如時の no-op
- **CLI スモーク**: `--no-open` 相当の分岐（オープンskip）を含む配線テスト

## 8. 将来の拡張（本設計では実装しない）

- 履歴トレンドビュー: `micro-<日付>.json` の蓄積を素材に、日付横断の推移グラフを HTML に追加
- e2e 結果（autosave レイテンシ・Long Tasks など）の HTML レンダリング
