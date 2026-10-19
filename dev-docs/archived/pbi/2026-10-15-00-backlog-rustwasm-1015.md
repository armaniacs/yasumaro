# Backlog: rust-wasm-migration ラウンド wasm-1015 (2026-10-15)

rust-wasm-migration skill による自律発見 (STEP 0) の計測ベース選定記録。対象指定なしのため棚卸し → 候補走査 → プローブ実測の順に実施した。

## 既存 WASM 資産の棚卸し (移植済み・候補から除外)

| クレート | 状態 | 呼び出し元 |
|---|---|---|
| pii-sanitizer | 移植・配線済み | pipeline (`processPrivacyPipelineStep` 経由 hybrid) |
| textrank | 移植・配線済み | `extractSentencesStep` 経由 hybrid |
| sentence-dedup | 移植・STAGED (未配線) | 唯一の呼び出し元が content-script 経路のため配線不能確定 (lessons-learned 実績) |
| tag-cooccur | 移植・配線済み | dashboard (`tagClusterDiff` / `panelFactories`) |
| js-strings | lib (共有セマンティクス) | 各クレートから利用 |

## 候補評価表 (TOP 5 + 却下記録)

| 優先度 | 現実装位置 | アルゴリズム概要 | 実測・根拠 | 統合コスト | リスク | 判定 |
|---|---|---|---|---|---|---|
| P1 | `src/utils/markdownFormatter.ts:resolveTimestamp` 経由の export render | 行ごと ICU 時刻整形 × 最大 10,000 行 | **10k 行 p50 339.2ms、うち toLocaleTimeString 275.5ms (81%)**。転送フロアは 5% (`bench/export-render-probe-result.json`、`bench/export-render-breakdown-probe-result.json`) | 低 (async 経路・dashboard) | ICU parity (Rust 再実装で崩れる) | **TS 側メモ化で対応。WASM 化しない** → PBI 2026-10-15-02 |
| ― | `src/dashboard/keywordExtractor.ts` | Intl.Segmenter + フィルタ (O(tokens)) | 計測不要と判断: 分割本体が ICU ネイティブ、後段は単一パス。Rust に JA 辞書を持ち込むと MB 級バンドル増 | ― | 辞書バンドル | 移植不適 (原則 1: ネイティブが最速) |
| ― | `src/dashboard/tagClusterLayout.ts` | force-directed 100iter × O(n^2) | n は数十ノード想定で 100×1770 ペア ≒ 1ms 未満。WASM マーシャリングが支配する | ― | なし | 移植不適 (小さすぎて leverage なし) |
| ― | `src/dashboard/revisitInsightsAggregate.ts` | 単一パス bucketing + 小規模 sort 群 | O(n log n) だが比較子は軽量。10k 行でも sort 支配は小さい | ― | なし | 移植不適 |
| ― | `src/dashboard/importLogsService.ts` | バッチ import (I/O 律速) | バッチ + DownloadPort 分離済み。計算律速区間なし | ― | なし | 移植不適 |

## 実装着手の判断

P1 (export render) は「WASM 化で勝てる見込み」が実測で弱い (転送 5%・支配 81% が ICU ネイティブ) ため、STEP 2 (Rust 実装) には進めない。md-sanitize / prompt-sanitize と同型の「やらない」確定である。正しい解 (分単位メモ化) は TS リファクタのため PBI 2026-10-15-02 として起票し、実装は本スキル範囲外 (arch-delivery-loop 側の守備範囲) とする。

## PBI 化の対象と RICE

| NN | PBI | 種別 | RICE | 備考 |
|---|---|---|---|---|
| 02 | [2026-10-15-02-refactor-export-timestamp-memoize.md](2026-10-15-02-refactor-export-timestamp-memoize.md) | refactor | 12.0 | ⬜ 未着手。RICE は本集合内の相対値 |

依存: なし。ファイル排他 (`markdownFormatter.ts` + テスト + ベンチ JSON)。
