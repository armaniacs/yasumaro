# 台帳: 2026-11-26 ログ移行の大容量対応 (3件)

## 概要

LOG_EXPORT_IMPORT_GUIDE.md に記載の上限 (エクスポート 10,000 件、インポート
10 MiB / 100,000 行) の緩和ラウンド。保持ポリシー (sqliteMaxRecords 最大
100,000) とエクスポート上限の 1 桁乖離、および「エクスポートしたものは
インポートできる」往復不変条件の欠落を閉じる。前ラウンド
(暗号化バックアップ大容量対応、同日実施済み) の方針をログ移行経路に揃える。

- ブランチ: fix/encrypted-backup-large-capacity (前ラウンドと同一、継続)
- なぜなぜ分析 30 回 x 3: 各 PBI の「技術的考慮事項」に要約を記録
  (スクラッチパッド whywhy/log-export-row-limit.md、
  whywhy/log-import-size-limit.md、whywhy/log-guide-drift.md)

## 実装の SSOT 現状 (file:line、2026-11-26)

- エクスポート 10,000 件: exportLogsService.ts:28 (EXPORT_ROW_LIMIT、1 発 query、
  QUERY_CAPS.plain = 10,000 に依存)。queryAllData は total > rows でエラー
  (exportLogsService.ts:47-52)
- keyset ページング前例: domainAnalysisPanel / fetchPeriodRows (until cursor
  包含再読 + id dedup + fetch 時凍結上限)
- QUERY_CAPS.plain = 10,000 (limits.ts:86、tagCluster hotfix 6.8.12 で
  1,000 → 10,000)
- インポート 10 MiB: MAX_IMPORT_TEXT_BYTES (limits.ts:123、VULN-023)
- インポート 100,000 行: IMPORT_TOTAL_ROW_CAP (limits.ts:186、VULN-023)
- メッセージ 1,000 行: MAX_IMPORT_ROWS (limits.ts:22、VULN-006、バッチ分割済み)
- VULN-023 記録: dev-docs/archived/pbi/2026-08-29-13-fix-import-pipeline-safety.md

## RICE 採点 (降順が実行順)

| PBI | R | I | C | RICE | 依存 | 順序 |
|---|---:|---:|---:|---:|---|---|
| 04 エクスポート 100k ページング | 5 | 2 | 0.8 | 8.0 | 05 と直列 (往復試験は 05 で pin) | 1 |
| 05 インポート 30MiB | 5 | 2 | 1.0 | 10.0 | 04 と直列だが本体は定数変更 | 1 (04 と並行不可: 往復試験共有のため 04 → 05) |
| 06 ガイド/FAQ 更新 | 8 | 0.5 | 1.0 | 4.0 | 04/05 完了後 (仮数字防止) | 3 |

実行順: 04 → 05 → 06 (往復不変条件の試験を 05 で pin するため 04 を先行)。

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 04 | [2026-11-26-04-feat-log-export-100k-paging.md](2026-11-26-04-feat-log-export-100k-paging.md) | ✨機能追加 | 8.0 | 5 | ✅ 実装完了 (keyset ページング、MAX_EXPORT_ROWS SSOT 化、100k 往復 pin) |
| 05 | [2026-11-26-05-feat-log-import-30mib.md](2026-11-26-05-feat-log-import-30mib.md) | ✨機能追加 | 10.0 | 3 | ✅ 実装完了 (30 MiB 緩和、上限値入り文言、フルフィデリティ往復 pin 27.8MB / 5万件) |
| 06 | [2026-11-26-06-doc-log-export-import-guide-limits.md](2026-11-26-06-doc-log-export-import-guide-limits.md) | 🔧非機能追加 (docs) | 4.0 | 1 | ✅ 実装完了 (ガイド ja/en 上限表と往復の説明、FAQ Q54 同期) |

## 検証記録

- PBI 04 完了時: 関連 17 ファイル 288 件緑 (type-check / lint 通過)、100k 往復実測 (ファイル 8.0MB、export 80ms / import 97ms、RSS 増分 ~170MB)
- PBI 05 完了時: 関連 16 ファイル 300 件緑、フルフィデリティ往復 27.8MB / 50,000 行 / バッチ 250 回
- PBI 06 完了後の最終統合: `npm run validate` 全緑 (1,375 ファイル / 19,360 件、check-privacy 含む全静的ゲート)
- 往復 pin の注意: 軽量 100,000 行 (8.0MB) とフルフィデリティ 50,000 行 (27.8MB) の 2 系統。実データ行で 100,000 行往復は 30 MiB を超える可能性がある (title/summary/content の長さ次第)。その帯域は .db / 暗号化バックアップが担う

## 後続候補 (本ラウンドの範囲外)

- ローカル Markdown 書き出しの DATE_RANGE_QUERY_LIMIT = 10,000
  (markdownExport.ts:34、別機能 MARKDOWN_DOWNLOAD)
- JSON エクスポートの stringify 最適化 (署名用と出力用の 2 回呼び出し) は
  メモリ特性の実測後に判断。レビューラウンド (plans/2026-11-26-0757-review-...)
  で Tuning Expert が「ゲート規模 (30 MiB 級) の peak RSS / 所要時間を
  bench:micro に追加し、次回上限引き上げ前の前提条件にする」旨を起案
- DEPENDINGS.md 書式知識の共通化: generate-dependings.mjs と
  check-dependings.mjs が行テンプレート/parse 正規表現/エイリアス map を
  それぞれ独立に保持 (Maintainability 指摘)。dependings ラウンド
  (2026-11-26-04-chore-dependings-freshness-gate、並行セッション) 管轄の
  ファイルのため本ラウンドでは着手しない
- generate-dependings.mjs の日付再スタンプ制御: 確認なしで「最終確認日」を
  当日に書き換えられる現状は鮮度ゲートの信頼性を損なう (Supply Chain 指摘、
  同じく dependings ラウンド管轄)

## 再発防止の運用メモ (なぜなぜ分析より)

- PBI 04/05 の DoD に「docs 更新の要否判定」を明記 (前ラウンドから継続)
- cap 群を変更する PBI では「実効的な第一関門はどの cap か」を統合試験で
  pin する (行 cap とバイト cap の死にゲーを防ぐ)
