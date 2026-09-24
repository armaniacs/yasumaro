# 2026-09-24 arch-delivery-loop ラウンド（パネル基盤深化）— 採点台帳

分析パネルラウンド（01-08・アーカイブ済み）後のアーキテクチャ診断（Phase 0）で抽出した9候補を RICE 採点。NN は 2026-09-24 内の通し番号（前ラウンド 01-08 はアーカイブ済みのため 09 起点とし、優先順位は本台帳の順位列で管理する）。

## 採点表

RICE = (Reach × Impact × Confidence) / Effort。Reach は影響する呼び出しサイト数。

| 順位 | 候補 | Reach | Impact | Conf | Effort | RICE | 結果 |
|---|---|---|---|---|---|---|---|
| 1 | 『Summary not available.』リテラルの中立層 SSOT 化 | 5 | 1.0 | 100% | 0.25pt | 20.0 | PBI 09 |
| 2 | fetchPeriodRows — パネルデータ読み込みシーム | 8 | 2.0 | 100% | 1.5pt | 10.7 | PBI 10 |
| 3 | periodFilter 契約の深化（同期 emit 廃止） | 7 | 2.0 | 100% | 1.5pt | 9.3 | PBI 11 |
| 4 | i18n / パネルカタログゲート強化 | 2 | 1.0 | 100% | 0.25pt | 8.0 | PBI 12 |
| 5 | navigateToHistoryWithTag 集約 | 7 | 0.5 | 100% | 0.5pt | 7.0 | PBI 13 |
| 6 | PanelNotices — 通知/空状態モジュール | 8 | 1.5 | 80% | 1.5pt | 6.4 | PBI 14 |
| 7 | MAX_QUERY_ROWS ローカル再宣言の SSOT 化 | 3 | 0.5 | 100% | 0.25pt | 6.0 | PBI 15 |
| 8 | msg() フォールバックヘルパー集約 | 6 | 0.5 | 100% | 0.5pt | 6.0 | PBI 16 |
| — | defineAnalysisPanel 単一登録シーム | 6 | 1.5 | 80% | 2.0pt | 3.6 | 台帳送り |
| — | renderTagGraph 抽出 | 2 | 0.5 | 80% | 1.0pt | 0.8 | 台帳送り |

同点（6.0×2）はリスク軽減 → 緊急性の順: MAX_QUERY_ROWS（表示が静かに嘘をつく drift）を msg() より先。

## 依存グラフとバッチ構成

- PBI 09（background/utils）と PBI 12（テスト）は独立 → **バッチ1: 並列**
- PBI 10 / 11 / 13 / 14 / 15 / 16 は同一パネルファイル群（src/dashboard/panels/asyncData/）を触るため**直列チェーン**（RICE 順）: 10 → 11 → 13 → 14 → 15 → 16
- LAYERS.md の dashboard→background 定数 import 規約追記は PBI 09 の DoD に含める（docs のみのため PBI 化せず）

## 5 Whys サマリー

- **8重複 loadRowsWithRetry の失敗ポリシードリフト**: なぜ5種に分岐したか → パネルごとにコピーされた → なぜコピーしたか → データ読み込みの seam が存在しない → なぜ → 今ラウンド8パネルを短期間で追加する際、共通部品の設計より速度を優先した → **解: fetchPeriodRows を新設し失敗ポリシー（throw + capped 検出）を1箇所に固定**
- **filterReady 回避策 ×3**: なぜ必要か → periodFilter が構築中に同期 emit する → なぜ → load() との二重発火を各パネルが自分で防いでいる → なぜ → 契約が「初回 emit をパネルが無視する」ことを要求する → **解: 契約を反転（emit は変更時のみ、初期値は getRange()）し回避策を削除**
- **孤立 i18n キーの漂着**: なぜ検出されないか → parity 機構が release:check 専用で validate が実 locale を読まない → **解: 実ファイルを読む parity テストを vitest に追加**
- **フォールバックリテラルの4重宣言**: なぜ one home 主張と乖離したか → pipelineText は表示優先度の owner であってリテラル定数の配布点ではない → なぜ → markdownFormatter（Layer 2）が background import 禁止のため辿り着けなかった → **解: 中立 Layer 0（utils/summaryFallback.ts）へ昇格**

## 台帳送り候補（着手トリガー）

- **defineAnalysisPanel 単一登録シーム**（RICE 3.6・2pt）: カタログ+ファクトリー+pinned リストの二重管理解消。静的サイドバー HTML は CSP/初回描画/a11y の記録済み決定により維持。トリガー: 次回パネル追加ラウンドで登録ミスが起きた時、またはパネル数が 30 を超えた時
- **renderTagGraph 抽出**（RICE 0.8・1pt）: tagCluster と timeSlider の SVG 描画重複。トリガー: 3つ目のクラスタグラフ系パネルを追加する時
