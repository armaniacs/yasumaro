# PBI: ベンチ結果 HTML レポートに履歴トレンド表示を追加

## ユーザーストーリー
最適化 PBI の効果確認をする開発者として、過去のベンチ実行との**推移（トレンド）**がレポートで見たい、なぜなら baseline との単発比較だけでは「改善が継続しているか・じわじわ劣化していないか」を読み取れず、最適化の効果測定と退行の早期発見に時間がかかるから。

## ビジネス価値
- 最適化 PBI の前後で「どの指標がどのくらいの期間でどう動いたか」を 1 画面で確認でき、PR 説明の証拠添付が容易になる
- wall-clock が緩やかに劣化するパターン（baseline ±15% のゲートでは検出されない退行）を推移で早期発見できる
- 測定方法: レポートの Trend セクションで各指標の最新値 vs 履歴内最古値の差分と sparkline を目視確認。テストでは集約ロジックの単体テストで検証

## BDD受け入れシナリオ

```gherkin
Scenario: 複数世代の実行結果から推移を表示する
  Given bench/reports/ に 3 日分の micro-<日付>.json が保存されている
  When  npm run bench:micro を実行して HTML レポートを開く
  Then  レポートに "Trend" セクションが表示される
  And   各ベンチの主要指標（L の wall p50/p95/p99・ヒープ・決定的カウンタ・スケーリング指数）に
        日付順の sparkline と最初/最新の値が表示される
  And   レポート自体は外部リソース参照ゼロのまま表示される

Scenario: データ点が 1 世代しかない
  Given bench/reports/ に micro-<日付>.json が 1 世代のみ存在する
  When  npm run bench:micro を実行して HTML レポートを開く
  Then  Trend セクションには "1 世代のみ（推移は次回以降に蓄積）" と表示される
  And   現在値は表示されるがグラフは描画されない

Scenario: 読み込めない・形式の古い JSON が混在する
  Given bench/reports/ に schemaVersion が 1 ではない JSON と
        壊れた（パースできない）JSON が混在している
  When  npm run bench:micro を実行して HTML レポートを開く
  Then  それらのファイルはスキップされ、読めた世代だけで Trend が描画される
  And   スキップされた件数が Trend セクションの補足に表示される
```

## 受け入れ基準
- [ ] Trend セクションが履歴 2 世代以上で sparkline（インライン SVG）+ 最初/最新値つきで描画される
- [ ] 履歴 0〜1 世代でもレポート生成が壊れない（プレースホルダ表示）
- [ ] schemaVersion != 1・パース不能な JSON をスキップし、スキップ件数を表示する
- [ ] トレンド対象は主要指標のみ: 各ベンチの **L サイズ**の wall p50/p95/p99、ヒープ（L）、決定的カウンタ（L）、スケーリング指数
- [ ] 履歴は保持ポリシー（ローリング 5 世代 + 週次アンカー）で存在する世代のみ使用し、系列は最大 26 世代に制限される
- [ ] 既存の自己完結性（`src=`/`href=` に外部 URL なし）と HTML エスケープが維持される
- [ ] `npm run bench:check` の挙動・終了コードが変わらない
- [ ] 既存テスト（contentExtractor / aiSummaryCleaner / htmlReport / trend）全绿、type-check / lint / build クリーン

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- `npm run bench:micro` 実行後に生成される HTML に Trend セクションが存在すること（CLI 配線のスモーク、--no-open 付き）

### 統合テスト
- `renderHtml(results, { history })` が履歴を受け取り Trend セクションを描くこと（htmlReport 経由の統合）
- 履歴 3 世代・1 世代・0 世代・不正混在の 4 状態でセクション出力を検証

### 単体テスト
- `loadTrendHistory`: ファイル走査・日付ソート・指標抽出・schemaVersion フィルタ・壊れた JSON の skip・世代 cap
- 境界値: 0 世代 / 1 世代 / 同日複数ファイル（同日は最新のみ使用）/ 欠落ベンチがある世代
- 例外ハンドリング: 読み込み権限なしディレクトリでもベンチ実行を失敗させない

## 実装アプローチ
- **Outside-In**: 統合テスト（renderHtml に history を渡す）から赤 → `trend.mjs` の単体テスト赤 → 実装 → グリーン → リファクタリング
- **Red-Green-Refactor**: 集約ロジックと描画を分離したまま各レイヤーで TDD

## 見積もり
2 pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（bench ハーネス内部で完結。Node 標準モジュールのみ）
- テスタビリティ: `trend.mjs` は I/O（ファイル走査）と集約を分離し、集約関数は純関数として単体テスト可能に。`htmlReport.mjs` は引き続き純関数（history は opts 経由で注入）
- 非機能要件: HTML サイズ — 系列は 26 世代 × 主要指標のみに制限し、既存レポート（約 43 KB）から概ね 2 倍以内に収める。外部参照ゼロ・全注入文字列のエスケープは既存テストで保証

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# トレンド機能は未実装であることを確認済み（2026-09-04 時点）
grep -rin "trend\|timeseries" bench/ | grep -v node_modules
# 既存コマンド: micro / --check / --update-baseline / --filter / --no-open のみ
rg -n "opts\.(check|updateBaseline|filter|noOpen)" bench/harness/cli.mjs
```
未実装を確認済み。設計書（`dev-docs/archived/pbi/2026-09-04-09-spec-bench-html-report.md` §8）が「履歴トレンドビュー」として将来拡張に明示していた領域。

### 現状のデータ基盤（2026-09-04 時点）
- `bench/reports/micro-<日付>.json` は毎回生成済み。スキーマ: `{ schemaVersion: 1, generatedAt, node, results, comparison }`
- `results[i]` = `{ id, description, config: { warmup, measure, sizes }, perSize: { S/M/L: { n, wallMs: { p50,p95,p99 }, heapBytes: { p50 }, counters } }, scaling: { exponent, verdict } }`
- **履歴は現在 1 世代のみ**（ハーネスが新しいため）。保持ポリシー（ローリング 5 世代 + 週次アンカー）で日をまたいで蓄積される。トレンドは 0〜1 点でも壊れないこと
- 同日のファイルは上書きされるため、1 日 1 世代。同一名でも `generatedAt` の新しい方を採用

### 実装手順
1. `bench/harness/trend.mjs` を新設: `loadTrendHistory(reportsDir, { cap = 26 })`
   - `readdirSync` で `micro-YYYY-MM-DD.json` を列挙（`DateSuffixRe` でフィルタ）
   - `JSON.parse` 失敗・`schemaVersion !== 1` はスキップ（skip 件数を返す）
   - `{ date, node, generatedAt, benches }` に集約（`benches[id] = { wall: { p50, p95, p99 }, heap, counters, scalingExponent }` — L サイズ基準、counters は L のみ）
   - 日付昇順ソート後、新しい方から `cap` 件に制限
2. `bench/harness/__tests__/trend.test.ts` を新設（先に赤）: 上記単体テスト一式
3. `bench/harness/htmlReport.mjs` に Trend セクションを追加
   - `renderHtml(results, opts)` の `opts.history`（`loadTrendHistory` の返値）を受け取る
   - 各ベンチ × 主要指標の sparkline（インライン SVG `<polyline>`、min/max と最初/最新値をテキスト併記）
   - 0〜1 点: `1 世代のみ（推移は次回以降に蓄積）` を表示。skip 件数があれば併記
   - 既存テスト（外部参照ゼロ・エスケープ）を維持
4. `bench/harness/__tests__/htmlReport.test.ts` に統合テストを追加（先に赤）
5. `bench/harness/cli.mjs` のレポート書き出しブロックで `loadTrendHistory(reportsDir)` を呼び `renderHtml` に渡す（try/catch 内・失敗時は history なしでフォールバック）
6. `npm run bench:micro -- --filter c2 --quick --no-open` でスモーク確認 → `npm run bench:check` が exit 0 のまま

### 落とし穴
- **JSON の `results` は配列順が保証されない**: ベンチ id でマップ化してからトレンドを組む（配列 index で参照しない）
- **`comparison` は baseline 未登録時 `null`**: 履歴側には依存しない（トレンドは results のみから組む）
- **同日上書き**: 保持ポリシーは世代 = 日付スタンプ。同名ファイルの再実行で上書きされるため、履歴キーは日付（`generatedAt` は表示用のみ）
- **htmlReport の純粋性**: `loadTrendHistory` の I/O を htmlReport に持ち込まない（cli.mjs で読んで渡す）。引数で履歴を注入しない呼び出し（既存テスト）が壊れないこと
- **HTML サイズ暴発**: sparkline はベンチ数 × 指標数分の SVG になる。`cap` 26 世代・L 基準のみで上限を守る。ベンチが将来増えたら指標の取捨選択を見直す
- **`bench:check` モードでも Trend が生成される**: 仕様どおり（全モードで成果物 3 点セット）。ただし `--check` の exit コード判定は Trend 生成失敗に影響されないこと（既存の try/catch 方針を維持）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（trend 集約・htmlReport 描画・CLI 配線）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（docs/PERFORMANCE_TEST.md 日英 + bench/README.md に Trend セクションの説明を追記）
