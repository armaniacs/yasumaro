# PBI: export/import 往復の bench:micro 計測を追加する

## ユーザーストーリー
保守担当者として、exportJson / importFromJson の往復コストを bench:micro で計測したい、なぜならインポート上限を 10 MiB → 30 MiB に緩和した際、次回の上限引き上げ (30 MiB → それ以上) を判断する材料 (ゲート規模での peak RSS / 所要時間) が測定されておらず、Ops レビュー (holistic-1126) が「bench:micro に追加し、次回上限引き上げ前の前提条件にする」ことを起案したから。

## ユーザーへの背景
- 現状: bench/micro/ には archive (f3) や history-query (c6) の計測があるが、export/import 往復の計測が無い
- 既知の観測: PBI 04/05 の統合 pin で軽量 100,000 行 (8.0MB、export 80ms / import 97ms、RSS 増分 ~170MB) とフルフィデリティ 50,000 行 (27.8MB) が試験的に測定済み (ただし bench としては pin されていない)
- 本 PBI は「計測の常設化」であり、最適化実装は含まない (計測結果次第で次ラウンドに起案)

## ビジネス価値
- 次回インポート上限引き上げ (30 MiB → 50 MiB 等) の判断が計測ベースになる
- stringify 2 回最適化 (既知 (c)) の効果測定の土台になる
- 測定方法: bench/micro に f4-log-export.bench.mjs が追加され、軽量 100k 行とフルフィデリティ 50k 行の往復時間 + peak RSS が出力されること

## BDD受け入れシナリオ

```gherkin
Scenario: 往復計測が出力される
  Given bench/micro に f4-log-export.bench.mjs がある
  When npm run bench:micro を実行する
  Then 軽量 100k 行往復とフルフィデリティ 50k 行往復の時間と peak RSS が出力される
  And bench smoke 試験 (bench/__tests__/smoke.test.ts 系) が緑である

Scenario: 上限定数の変化が計測に反映される
  Given bench が limits.ts の上限定数を harness 経由で取り込む
  When 上限定数が変わる
  Then 計測対象の行数が定数に追従する (ハードコードされない)
```

## 受け入れ基準
- [x] `bench/micro/f4-log-export.bench.mjs` (新規、次の連番) が追加されている: 軽量 100k 行往復 (exportJson → importFromJson) とフルフィデリティ 50k 行往復を計測する
- [x] 時間 + peak RSS (process.memoryUsage().rss 差分、advisory) を出力する
- [x] 上限定数は limits.ts / SSOT から harness 経由で取り込む (f3-archive の ARCHIVE_INSERT_BATCH 前例に倣い、ハードコードしない)
- [x] bench smoke 試験 (bench/__tests__/smoke.test.ts、bench/harness/__tests__/domEnv.test.ts 等) が緑である (新 bench ファイルの登録漏れ検出)
- [x] `npm run bench:micro` が通る
- [x] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- bench smoke 系 (新 bench ファイルが harness の実行対象に登録され、smoke が壊れないこと)

### 単体テスト
- bench 自体は実行時間計測のため単体試験は smoke のみ (既存流儀)

## 見積もり
S (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: 台帳 07 の後続候補、Ops/Tuning レビュー指摘 (holistic-1126 レビュー報告書)
- f3-archive.bench.mjs の前例: harness/bundle.mjs 経由で本番定数を取り込む (ARCHIVE_INSERT_BATCH と同型)、bench 冒頭で wasm を data URL 化する (本 bench は sqlite 不要なら wasm セットアップは不要)
- chrome 依存の注入: exportJson / importFromJson は i18n (chrome.i18n) を参照する場合、bundle seam で stub を注入する (f3 の定数注入パターンに倣う)。実現できない場合は、envelope + HMAC の純粋層 (exportEnvelope) を直接計測する代替案を報告に記録
- peak RSS は advisory (機械依存) を明示。時間は bench harness の正規計測に従う
- なぜなぜ分析: 上限緩和ラウンドで計測が後追いになった根本原因は「上限を変える PBI に『次回引き上げの前提条件』を固定する工程が無かった」こと。本 PBI で計測を常設化する

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "bundle.mjs\|importFromSource" bench/micro/f3-archive.bench.mjs | head -4
grep -rn "exportJson\|importFromJson" src/dashboard/exportLogsService.ts src/dashboard/importLogsService.ts | head -6
grep -n "MAX_IMPORT_TEXT_BYTES\|MAX_EXPORT_ROWS" src/utils/limits.ts | head -3
```

### 実装手順
1. f3 の harness/bundle.mjs パターンで本番定数と関数を取り込む形の新 bench を設計
2. 軽量 100k 行生成 (PBI 04 pin と同種データ) → exportJson → importFromJson を計測
3. フルフィデリティ 50k 行生成 (PBI 05 pin と同種、title/summary 付き) → 往復計測
4. bench smoke 試験の確認 (ファイル登録漏れは smoke が検出する)

### 落とし穴
- exportJson は HMAC 署名 (crypto.subtle) を含む。Node 環境の webcrypto で動くことを確認 (f3 は sqlite-wasm が必要だが本 bench は不要の可能性が高い)
- importFromJson はバッチ (200 行/メッセージ) で DB に書く ― 本 bench では DB 依存を外し、検証 (validateImportRow) までを計測する等、測定対象を明示的に定義する (sqlite まで入れると wasm セットアップが必要になる。f3 パターンで可能だが重量)
- 計測対象の定義が曖昧なまま実装しない (どの層まで測るかを bench 冒頭のコメントで明記し、報告にも記録)
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了
- [x] リファクタリング完了 (グリーン後)
- [x] ドキュメント更新の要否判定: bench の追加でユーザーに見える挙動は不変のため、docs 更新は不要
