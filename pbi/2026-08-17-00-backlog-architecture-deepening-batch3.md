# アーキテクチャ深深化 第3弾 バックログ（候補 A〜F）

アーキテクチャレビュー（2026-08-17, post-PBI-29〜34）由来の6候補をRICEで採点し、着手順を確定した一覧。
個別PBIは `2026-08-17-35` 〜 `2026-08-17-40` に対応する。

## RICE採点の前提

対象がすべて内部リファクタリングのため、RICEの各要素を以下の代理指標で評価した。
候補間の相対比較が目的であり、絶対値の正確さより全候補を同一基準で測る一貫性を優先している。

- **Reach**: 今後12ヶ月で当該モジュールに触れる見込みの変更回数（推定）。ユーザー数ではなく「開発者がこの領域を触る頻度」の代理。
- **Impact**: 将来のバグ率低減・開発速度向上への寄与（3=圧倒的 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小）
- **Confidence**: 問題・解法の確信度（レビューの Strong / Worth exploring 判定に対応）
- **Effort**: 実装コスト（人日）

## スコア表

| 順位 | 候補 | 判定 | Reach | Impact | Conf | Effort(人日) | RICE |
|---|---|---|---|---|---|---|---|
| 1 | A: Split messageHandlers.ts | Strong | 10 | 2 | 80% | 3 | 5.33 |
| 2 | B: Complete error classification | Strong | 6 | 2 | 80% | 2 | 4.80 |
| 3 | D: Unify OPFS WHERE builder | Worth exploring | 3 | 1 | 80% | 1 | 2.40 |
| 4 | C: Extract SSRF/IP policy | Worth exploring | 4 | 1 | 50% | 3 | 0.67 |
| 5 | E: Collapse dashboard boilerplate | Worth exploring | 5 | 1 | 50% | 4 | 0.63 |
| 6 | F: Extract trustDb ManagedStringList | Worth exploring | 3 | 1 | 50% | 3 | 0.50 |

## 最終順位と根拠

| 順位 | ファイル | 根拠 |
|---|---|---|
| 1 | `35-refactor-split-message-handlers` | レビュー最上位推奨。削除テストで290行の実ロジックが集中する最深モジュール。重複PBIなし。 |
| 2 | `36-refactor-complete-error-classification-consolidation` | Strong。PBI-20/21の「やり残し」（createErrorResponse移行＋サニタイズ統一）を完了。 |
| 3 | `37-refactor-unify-opfs-where-query-builder` | 1人日のクイックウィン。PBI-29の意図を完成する高確信・低コストの後続。 |
| 4 | `38-refactor-extract-ssrf-ip-policy` | Worth exploring。セキュリティ関心の分離は有用だが、既にSSRFは機能しておりモジュール性改善に留まる。 |
| 5 | `39-refactor-collapse-dashboard-sqlite-boilerplate` | Worth exploring。~450行削減だがTS総称設計にコスト、全19関数が単一パターンに収まるか不確実。 |
| 6 | `40-refactor-extract-managed-string-list-trustdb` | Worth exploring。PBI-27と強い重複のため、折り込み可否の調整を要する。 |

## 依存関係・既存PBIとの重複

| 候補 | 関係 | 内容 |
|---|---|---|
| A | 重複なし | 新規。messageHandlers分割は未着手PBIと衝突しない |
| B | PBI-20 / PBI-21 と重複 | PBI-20（エラー分類統一）・PBI-21（機密マスキング統一）の意図の「完了」に相当。両PBIが未着手の場合、本PBIがその残作業を担う。二重作業を避けるためスコープ調整すること |
| D | PBI-29 の後続 | PBI-29で `sqliteQueryBuilder` を作成済みだが `crudHandlers.ts` の移行が未実施。その残作業 |
| C | 重複なし | 新規。fetch/SSRFの分離は未着手PBIと衝突しない |
| E | 重複なし | PBI-15（dashboard handler deps平坦化）とは別関心 |
| F | PBI-27 と強い重複 | PBI-27（trustDbゴッドモジュール分解, 13pt, 未着手）のサブセット。本PBIはその狭い具体策（ManagedStringList + TrancoVersionTracker）。PBI-27へ折り込むか、先駆けとして小分け実施するか調整すること |

## 補足: ソフト依存（順位を覆すほどではない）

- B（エラー分類統合）をA（messageHandlers分割）より先に行うと、Aの分割時に `createErrorResponse` のimport移行が1ファイルで済む（A先だと分割後3ファイルで移行）。ただしハード依存ではないため、レビューの最上位推奨とRICEに従いAを1位とした。
