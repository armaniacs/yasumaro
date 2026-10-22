# Backlog ― yasumaro棚卸し(2026-10-22)6候補の優先順位

由来: 2026-10-22の棚卸し応答(いいところ/わるいところ/超えると良いことA〜F)を `pbi-backlog-prioritizer` でPBI化した。採点はRICEを全候補同一基準で概算し、依存はスコアより優先した。

## 最終順位

| 順位 | PBI | 種別 | RICE | Effort | 根拠・依存 |
|---|---|---|---:|---|---|
| 01 | [2026-10-22-01-refactor-storage-catalog-ssot.md](2026-10-22-01-refactor-storage-catalog-ssot.md) | refactor | 800 | 2.0人週 | 土台。A/Dが依存するため先頭。wa-sqlite部分はゲート後 |
| 02 | [2026-10-22-02-feat-onboarding-light.md](2026-10-22-02-feat-onboarding-light.md) | feat | 480 | 1.0人週 | 入口改善。小さく即効。独立着手可 |
| 03 | [2026-10-22-03-feat-meta-summary-semantic-recall.md](2026-10-22-03-feat-meta-summary-semantic-recall.md) | feat | 427 | 3.0人週 | 体感価値最大。PBI 01に依存 |
| 04 | [2026-10-22-04-feat-session-timeline-reminders.md](2026-10-22-04-feat-session-timeline-reminders.md) | feat | 320 | 2.5人週 | Dと同点。到達が広いため先。独立着手可 |
| 05 | [2026-10-22-05-feat-webhook-export.md](2026-10-22-05-feat-webhook-export.md) | feat | 320 | 1.0人週 | パワーユーザー層。PBI 01のegress作法に従う |
| 06 | [2026-10-22-06-feat-capture-expansion.md](2026-10-22-06-feat-capture-expansion.md) | feat | 200 | 3.0人週 | 需要は広いが確信度0.5。段階着手 |

RICE = (Reach × Impact × Confidence) / Effort。Impactは3/2/1/0.5/0.25の目安に合わせた。絶対値より相対比較を重視する。

## なぜなぜ分析の要点

- 疑問「AのImpactを推定できない」→ なぜ振り返れないのか → 5行残っても束ねられない → 裏ニーズは振り返り自動化 → PBIは想起の自動化として記述した
- 疑問「EのEffortが読めない」→ ゲート待ちと計測設計が混在 → sunset実行と計測設計を分離し、ゲート前着手禁止を明記して解いた
- 疑問「Cの範囲が広すぎる」→ 壁(CSP/権限/審査)が不確実 → 全部一括にせず理由可視化から段階化して解いた

## 運用

- ファイル名のNNが着手順。着手は01→02の順を推奨するが、02/04は01と独立のため並列着手可。03/05は01の作法確定後に着手する
- 新規PBI作成・完了時は `pbi/00-INDEX.md` を更新し、完了分は `dev-docs/archived/pbi/` へ移す
