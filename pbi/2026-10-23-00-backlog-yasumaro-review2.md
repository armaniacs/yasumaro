# Backlog ― yasumaro棚卸し第2弾(2026-10-23)5候補の優先順位

由来: 2026-10-23の棚卸し第2弾応答(G〜L)のうち、選択されたG/H/I/J/Kを `pbi-backlog-prioritizer` でPBI化した。L(計測基盤)は今回見送り。採点はRICEを全候補同一基準で概算し、依存はスコアより優先した。前弾(2026-10-22のA〜F)とは独立した追加分である。

## 最終順位

| 順位 | PBI | 種別 | RICE | Effort | 根拠・依存 |
|---|---|---|---:|---|---|
| 01 | [2026-10-23-01-feat-egress-ledger.md](../dev-docs/archived/pbi/2026-10-23-01-feat-egress-ledger.md) | feat | 1066 | 1.5人週 | 信頼の土台。Hが作法に従う（✅ 完了・アーカイブ済み 2026-10-30） |
| 02 | [2026-10-23-02-feat-adaptive-recording.md](../dev-docs/archived/pbi/2026-10-23-02-feat-adaptive-recording.md) | feat | 576 | 2.5人週 | 記録の入口。Hと独立（✅ 完了・アーカイブ済み） |
| 03 | [2026-10-23-03-feat-ai-cascade.md](../dev-docs/archived/pbi/2026-10-23-03-feat-ai-cascade.md) | feat | 560 | 2.0人週 | 枯渇・NDA対応。01の作法に従う（✅ 完了・アーカイブ済み） |
| 04 | [2026-10-23-04-feat-portability-moat.md](../dev-docs/archived/pbi/2026-10-23-04-feat-portability-moat.md) | feat | 267 | 1.5人週 | 戦略価値。確信度0.5（✅ 完了・アーカイブ済み） |
| 05 | [2026-10-23-05-refactor-sustainable-maintenance.md](../dev-docs/archived/pbi/2026-10-23-05-refactor-sustainable-maintenance.md) | refactor | 160 | 1.5人週 | 間接効果でImpact 1（✅ 完了・アーカイブ済み） |

RICE = (Reach × Impact × Confidence) / Effort。Impactは3/2/1/0.5/0.25の目安に合わせた。絶対値より相対比較を重視する。

## なぜなぜ分析の要点

- 疑問「Kの範囲が読めない」→ なぜ持ち出せないのか → 正規形と列定義がない → 移行可能性として書けば動ける → archive正規形+3形式exportに絞って解いた
- 疑問「Jが広すぎる」→ 関門と肥大が混在 → いま動ける縮小(ダイジェスト・折りたたみ・タグ提案)に絞り、ラダー全体は含めないことで解いた
- 疑問「Iと監査ログの関係」→ 7日固定・フォールバック不可が制約 → 最小形(時刻・送信先・文字数・判定)の台帳に絞り、長期化を含めないことで解いた

## 運用

- ファイル名のNNが着手順。01→02の順を推奨するが、02/04/05は01と独立のため並列着手可。03は01の作法確定後に着手する
- 前弾の backlog は [2026-10-22-00-backlog-yasumaro-review.md](2026-10-22-00-backlog-yasumaro-review.md) を参照する
- 新規PBI作成・完了時は `pbi/00-INDEX.md` を更新し、完了分は `dev-docs/archived/pbi/` へ移す
