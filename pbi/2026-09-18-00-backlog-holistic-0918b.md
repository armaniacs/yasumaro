# バックログ台帳: 大局的コード改善 0918b（holistic-0918b）

2026-09-18 第2ラウンド。前ラウンド（holistic-0918, 05-10）で未踏の領域（sync・alarm・queue・backup・dashboard view）を4観点でレビューし、実コード裏取りで抽出した3候補 + 台帳送り1件を集約する。

## 採点基準（既存ラウンドと同一）

```
Reach: 今後1年の保守作業での関与頻度（相対1-10）
Impact: 3=実害解消 / 2=大きい / 1=中（重複削減・規範化）/ 0.5=小（混乱削減）
Confidence: 1.0=コードで確定 / 0.8=設計判断が残る
Effort: ストーリーポイント
```

## RICE スコア表

| スコア順 | 候補 | R | I | C | E | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| — | reviewSummaryAlarm デッドコード削除 | 4 | 1 | 1.0 | 0.5 | 8.0 | → PBI 11 |
| — | errorMessage 迂回残存の置換 | 6 | 1 | 1.0 | 1 | 6.0 | → PBI 12 |
| — | restorableSettings 並列テーブル統合 | 3 | 1 | 1.0 | 1 | 3.0 | → PBI 13 |
| 台帳 | formatBytes 双子統合 | 2 | 0.5 | 0.8 | 0.5 | 1.6 | 台帳送り |

## 実行順

```
11（デッドコード削除）→ 12（errorMessage採用完了）→ 13（specテーブル統合）
```

純 RICE 降順からの逸脱理由: 12（6.0）を 11（8.0）より先にしない。逆である。ユーザー確認で「C3 → C1 → C2」を採用。理由: 11 は削除のみの最小差分で先行価値が高く、12 は約20サイト・17ファイルの機械置換で作業量が最大のため後半に置く。13 は設計判断を含まないが検証範囲が広い（4テーブル→1テーブル + drift テスト）。

## 依存マップ・バッチ計画

- 11: 対象 `reviewSummaryAlarm.ts` + `reviewSummaryAlarm.test.ts` + `service-worker.test.ts`（mock・形骸テスト除去）。依存なし
- 12: 対象 17ファイル・約20サイト（`utils/errorUtils.ts` の errorMessage SSOT への機械置換）。依存なし。11 とファイル非重複
- 13: 対象 `utils/storage/restorableSettings.ts` + 同テスト。依存なし。11・12 とファイル非重複
- 3件とも相互にファイル非重複・解の前提関係なし → **1バッチで並列可**

## 台帳送り

- **formatBytes 双子**（`dashboard/cleansingStatsView.ts` の4桁有効数字・GB/MB/KB 版と `dashboard/panels/asyncData/entryByteDelta.ts` の toFixed(1)・MB/KB/B 版）。entryByteDelta 側コメントが「the single unit table」と主張するが SSOT は存在しない。出力差（丸め・単位集合）に意味がある可能性があり、統一は意図的 UI 変更になる。**再検討トリガー**: UI 出力統一の要望、またはいずれかの形式変更が必要になったとき

## 5 Whys サマリー

- 11: なぜ残ったか → alarmRegistry 移行時に新実装へ install ロジックと schedule helper が複写され、旧経路の削除が漏れた。→ 解: 死モジュール3ファイルの削除
- 12: なぜ迂回が残るか → SSOT 化 PBI（2026-08-12-07）で約58サイトを置換したが、その後の新規コード・見落とし分が許容された。→ 解: 残存約20サイトを機械置換し byte-identical を保つ
- 13: なぜ4テーブルか → 型検査とクレンジング特別扱いが時期を分けて追加された。→ 解: key → { type?, range? } の単一 spec テーブルに統合し allowlist を派生、drift を構造的に不可能にする
