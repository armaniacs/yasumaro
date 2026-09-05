# PBI 16: bench htmlReport から trendReport モジュール分離

優先度: Round 5 6 位 / RICE 3.3 = (1 × 0.5 × 100%) / 0.15w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch5.md](2026-09-05-00-backlog-arch5.md)
依存: なし

## ユーザーストーリー
bench ハーネスのレポート出力を保守する開発者として、trend UI（sparkline・Trend テーブル・CSS）が trendReport モジュールに集約されてほしい。なぜなら arch2 が「trend UI を拡張する次ラウンドで分離する」と条件付けた先で PBI 10（bench trend 表示）が既に発火して拡張が htmlReport.mjs に同居しており、次の trend 変更も再びレポート本体に手を入れることになるから。

## 対象（2026-09-05 ファクトチェック済み）

- `bench/harness/htmlReport.mjs`（253 行）のうち:
  - `sparkline`（:137-164、~28 行）— multi-series sparkline
  - `trendSection`（:166-220、~55 行）— Trend テーブル本体
  - trend CSS 4 ルール（:55-58、`.sparkline .trend-line-*` / `.trend-vals`）
  - wire-up 1 箇所（:247 `${trendSection(history)}`）
- 共有 helper は既に分離済み: `fmtNum` / `fmtKB` は `bench/harness/format.mjs`（htmlReport.mjs:9 が import）
- `escapeHtml`（htmlReport.mjs:12）は htmlReport 定義。trendReport にも必要になるため format.mjs への移動が自然
- `bench/harness/trend.mjs`（78 行）は「pure-data module、I/O は cli が所有」と自己文書化済み（seam は半分切れている状態）

## なぜなぜ分析（設計判断の導出）

**問い: なぜ trend UI がレポート本体に同居し続けているのか**

1. なぜ同居したのか → PBI 10（2026-09-04）が trend 表示を実装した際、出力先の htmlReport.mjs に直接書いたから。
2. なぜその時に分離しなかったのか → その時点では trend セクションが小さく、分離の leverage が見えなかったから（arch2 も「1 importer のみで leverage が小さい」と評価）。
3. なぜ今が着手時か → arch2 が条件付けた「trend UI を拡張する次ラウンド」は PBI 10 で発生済みで、trend UI は ~80 行に成長。arch2 の遡及条件は満たされており、見送り継続には新しい理由が必要だから。
4. なぜ分離に価値が出たのか → 次の trend 拡張（指標追加・期間選択等）のたびにレポート本体（benchCard / comparisonTable）と差競合する構造が続き、locality が壊れたままだから。
5. → 解: sparkline + trendSection + trend CSS を `trendReport.mjs` に移動（`renderTrendSection(history)`）。`escapeHtml` は format.mjs に移動（htmlReport と trendReport の両方が使う format 系 helper の自然な家）。削除テスト: 新 module を消すと trend UI がレポート本体に戻るだけ — complexity は移動であり集中ではないが、**次の trend 変更の局所化**が本 PBI の価値（leverage は小さいが friction の予防として妥当）

## BDD受け入れシナリオ

```gherkin
Scenario: trend セクションの変更がレポート本体に触れずに完結する
  Given bench/harness/trendReport.mjs が新設されている
  When  sparkline の色や Trend テーブルの列を変更する
  Then  変更が trendReport.mjs（と CSS 移行分）に留まり、htmlReport.mjs は trend 関連行を含まない

Scenario: history 未指定のレポートは変化しない
  Given history を渡さない renderHtml 呼び出し
  When  HTML を生成する
  Then  trend セクションは今日と同様に出力されない（空文字）

Scenario: 既存のレポート生成テストが無修正で green
  Given bench ハーネスのテストスイート
  When  テストを実行する
  Then  renderHtml の出力アサーションが変化なく green する（trend 専用 assert は trendReport 側に移行）
```

## 受け入れ基準
- [ ] `bench/harness/trendReport.mjs` が新設され、`renderTrendSection(history)`（sparkline + trendSection を含む）を export する
- [ ] `htmlReport.mjs` から sparkline / trendSection / trend CSS 4 ルールが削除され、`renderHtml` は `renderTrendSection` を 1 箇所で呼ぶ（htmlReport.mjs は ~170 行に縮減）
- [ ] `escapeHtml` が `bench/harness/format.mjs` に移動し、htmlReport / trendReport の両方が import する（htmlReport からの re-export は不要 — consumer は htmlReport 本体と htmlReport.test.ts のみ、test の import を付け替え）
- [ ] trend 関連のテスト（htmlReport.test.ts の trend セクション assert）が trendReport 側のテストに移行する
- [ ] `bench` / `bench:check` が PASS（レポート出力のバイト差は CSS/HTML の移動に由来する同一内容であること）

## テスト戦略（t_wadaスタイル）
### 単体テスト
- `trendReport.test.ts` 新設（htmlReport.test.ts から trend 関連ケースを移行）: history 空 / 1 世代 / 複数世代 / sparkline の 2 点未満で空 / counters・scaling の表示
### 統合テスト
- htmlReport.test.ts の renderHtml 統合 assert は無修正（trend セクション込みの出力形状が不変）
### 例外ハンドリング
- history の形状異常（generations 欠落）で今日どおり空文字を返す

## 見積もり
0.15w（半日）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: trendReport は純粋関数（history → HTML 文字列）で jsdom 不要
- 非機能要件: 生成 HTML の内容は移動のみで不変（id="trend"・クラス名を維持）
- ADR 整合: なし（bench ハーネス内部の整理。arch2 backlog の遡及条件が満たされたことの着地）

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '137,220p' bench/harness/htmlReport.mjs   # sparkline + trendSection
sed -n '50,60p' bench/harness/htmlReport.mjs      # trend CSS
rg -n "escapeHtml|fmtNum|fmtKB" bench/harness/*.mjs bench/harness/__tests__/*
```

### 実装手順
1. `escapeHtml` を format.mjs へ移動 → htmlReport の import を付け替え → htmlReport.test.ts の import を付け替え
2. `trendReport.mjs` を新設（sparkline + trendSection + trend CSS。CSS は `trendCss` export として htmlReport の `<style>` に差し込む）
3. htmlReport から該当部を削除し `renderTrendSection(history)` に差し替え
4. trend 関連テストを移行 → bench / bench:check PASS

### 落とし穴
- trend CSS は htmlReport の `CSS` 定数に連結されている — 移動後は `CSS + trendCss` の連結順が変わらないよう差し込む位置に注意（出力 HTML の diff を最小化）
- `trend.mjs`（pure-data）と `trendReport.mjs`（presentation）の役割分担をファイル header に明記すること（data と presentation の seam を混同しない）
- htmlReport.test.ts の trend assert はレポート全体の文字列検査の可能性 — 移行時に assert 対象を trendReport 単体に切り出すだけで、renderHtml 側は「trend セクションが含まれる」程度の疎 assert に保つ

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] bench ハーネス テスト全 green ＋ `bench` / `bench:check` PASS
- [ ] コードレビュー完了
- [ ] ドキュメント更新（docs/PERFORMANCE_TEST.md の harness 構成に trendReport を追記）
