# PBI: ログインポートのファイル上限を 30 MiB に緩和する

## ユーザーストーリー
10,000 件超の履歴を移行する利用者として、エクスポートした JSON ファイルをそのままインポートしたい、なぜなら現行の MAX_IMPORT_TEXT_BYTES (10 MiB) が先に発火し、標準レコードでは 20,000-40,000 件のファイルが拒否される。エクスポートが 100,000 件に緩和されると「エクスポートしたものはインポートできない」往復不変条件が壊れるから。

## ビジネス価値
- 「エクスポートしたものはインポートできる」往復不変条件を成立させる (移行機能の本質)
- 行 cap (IMPORT_TOTAL_ROW_CAP = 100,000) が実効化する (現行の 10 MiB は 20,000-40,000 行で先に発火する死にゲー)
- 測定方法: 10 MiB を超え 30 MiB 以下の JSON がインポートでき、上限ちょうどで許容・1 バイト超過で拒否されること

## BDD受け入れシナリオ

```gherkin
Scenario: 10 MiB 超のファイルがインポートできる
  Given 12 MiB の有効な署名付き JSON がある
  When JSON からログをインポートする
  Then 拒否されず、有効な行が取り込まれる

Scenario: 上限ちょうどは許容される
  Given 30 MiB ちょうどのファイルがある
  When インポートする
  Then サイズ拒否されない (後続処理に進む)

Scenario: 上限超過は拒否される
  Given 30 MiB + 1 バイトのファイルがある
  When インポートする
  Then サイズ上限を示す文言で拒否される

Scenario: 行 cap は据え置き
  Given 100,001 行のファイルがある
  When インポートする
  Then 行上限 (100,000) で拒否される
```

## 受け入れ基準
- [x] MAX_IMPORT_TEXT_BYTES が 10 MiB → 30 MiB に引き上げられている (limits.ts、WHY コメントに根拠を記録)
- [x] importLogsService の事前チェックとエラー文言が新上限を示す (IMPORT_SIZE_ERROR 定数、`Import file is too large (limit: 30 MiB)`)。service 返却の英語固定文字列 + panel の formatImportLogsError 補間という既存流儀のため i18n キー追加は不要
- [x] IMPORT_TOTAL_ROW_CAP (100,000) と MAX_IMPORT_ROWS (1,000/メッセージ、実バッチ 200 行) は据え置き (VULN-023/006 の多層防御を維持)
- [x] 上限境界試験 (30 MiB ちょうどでパースに進む、+1 バイトで上限値入り文言、通常/移行パス両方) と行 cap 試験 (100,001 行で拒否) がある
- [x] 往復不変条件の試験 (フルフィデリティ 50,000 行、27.8MB、本物 HMAC、バッチ 250 回、inserted 50,000 / skipped 0) がある
- [x] `npm run validate` が通る (関連 16 ファイル 300 件緑、type-check / lint 通過。limits-drift に「30MB family」パターンを新設し新値の再局所化を監視。フル validate は統合側で最終実行)

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (統合 pin で裏取り)

### 統合テスト
- 軽量行で往復 (エクスポート出力をインポート)、バッチ分割の回数と進捗

### 単体テスト
- サイズ境界 (30 MiB ちょうどで通過、+1 バイトで拒否、文言に上限値)
- 行 cap (100,000 ちょうどで通過、100,001 で拒否)
- parse 前チェックが既存パス (通常/移行) の両方で効くこと

## 見積もり
S-M (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 依存関係: PBI 04 (エクスポート 100,000 件) と直列推奨。往復不変条件の試験は両 PBI 完了状態で pin する
- VULN-023 趣旨の維持: 緩和は「無制限 parse/accumulate の防止」を廃止しない。30 MiB は明示的上限であり、行 cap (100,000) とメッセージ cap (1,000/メッセージ) の多層防御も残る。上限引き上げは pin の書き換えとセット (上限ちょうど/超過の試験)
- 値の根拠: 30 MiB ≒ 100,000 行 x 標準 ~300 バイト。メモリ増幅 (parse 後 2-5 倍) を含むピーク ~300-400MB は dashboard タブの許容域。50 MiB 以上は安全マージンが薄れるため不採用
- なぜなぜ分析 30 回: 10 MiB は VULN-023 対策として設定インポート (数 MB 級) の感覚をログに持ち込んだ値。レコード集合のスケール特性が考慮されず、行 cap との整合 (どちらが先に発火するか) の統合試験も無かった
- 設定インポート (settingsExportImport) の 10 MiB は別経路 (別ファイル規模) で影響しないが、定数が mirroring の関係にあるため、ログ側の独立性をコメントと SSOT で明確にする

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "MAX_IMPORT_TEXT_BYTES" src/utils/limits.ts src/dashboard/importLogsService.ts
grep -rn "IMPORT_TOTAL_ROW_CAP" src/dashboard/importLogsService.ts | head -5
grep -rn "Import file is too large" src/ public/_locales | head -10
```
確認結果 (2026-11-26):
- MAX_IMPORT_TEXT_BYTES = 10 * 1024 * 1024 (limits.ts:123、VULN-023、round 6 PBI 2026-09-11-08 由来)
- 事前チェックは importLogsService.ts:371 (通常パス) と :412 (移行パス)
- IMPORT_TOTAL_ROW_CAP = 100_000 (limits.ts:186、VULN-023)
- MAX_IMPORT_ROWS = 1_000/メッセージ (VULN-006、バッチ分割済み)

### 実装手順
1. limits.ts の MAX_IMPORT_TEXT_BYTES を 30 * 1024 * 1024 に (limits-parity テストの EXPECTED 更新。limits-drift テストの 10MB family パターンの扱いを確認し、必要なら更新)
2. importLogsService の 2 箇所の事前チェックとエラー文言を新上限に (文言は上限値を含める)
3. 境界試験 + 行 cap 試験 + 往復試験 (Red → Green)
4. i18n が必要なら ja/en に新キー追加 (check-docs-chars に注意)

### 落とし穴
- limits-drift.test.ts は「10MB family」パターンで定数を pin している。30 * 1024 * 1024 はパターンに合わなくなるため、drift テストの更新が必要か確認する
- エラー文言の i18n 化状況を実装時に確認 (service が英語固定文字列を返す場合は panel 側の表示経路に合わせる)
- 30 MiB のテスト文字列は 'x'.repeat(30 * 1024 * 1024 + 1) で生成可 (parse 前に拒否されるためメモリは文字列 1 個分)
- ESM import は .js 拡張子必須。コメントは非自明な WHY のみ。絵文字禁止
- git 操作は一切しない (統合側が行う)

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす (統合/単体)
- [x] コードレビュー完了 (checking-team 2026-11-26: 9 観点、High 2/Medium 12 指摘は Phase 5 で修正済み)
- [x] リファクタリング完了 (グリーン後)
- [x] ドキュメント更新の要否判定: 本 PBI はユーザーに見える上限を変えるため docs 更新が必須。PBI 2026-11-26-06 で実施済み
