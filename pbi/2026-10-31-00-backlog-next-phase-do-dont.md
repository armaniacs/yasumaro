# 2026-10-31 次フェーズ やること/やらないこと バックログ

ブレインストーミング（仕様ギャップ × ユーザージャーニー × 類似ツール比較）で確定したやること候補 9 件の RICE 採点結果と PBI 一覧。

- 詳細な分析と根拠: docs/superpowers/specs/2026-10-31-next-phase-do-dont-design.md
- やらないこと候補（8 件）は個別 PBI の対象外。既存 N1 / N3 / N12 と同一の 4 件は確認済み、新規提案 3 件（read-it-later 化・チャットアシスタント化の拡張・Web Clipper 的テンプレート保存）とモバイル本格投資（N12 と同一）は PBI 04（ROADMAP 再同期）で裁定する

## RICE 採点

Reach の基準: 月あたり影響イベント推定（自分の利用実態ベース）。Effort: 人週相当。

| 順位 | 候補 | 種別 | Reach | Impact | Conf | Effort | RICE |
|---:|---|---|---:|---|---|---|---:|---:|
| 1 | 「記録されなかった理由」の可視化 | feat | 60 | 1 | 50% | 1.0 | 30.0 |
| 2 | パス許可の裁定（T4） | fix | 8 | 1 | 80% | 0.5 | 12.8 |
| 3 | 選択範囲の記録 | feat | 12 | 2 | 50% | 1.5 | 8.0 |
| 4 | ROADMAP.md の再同期 | docs | 1 | 2 | 80% | 0.25 | 6.4 |
| 5 | raw-owned keys 監査の完了 | test | 1 | 2 | 80% | 0.5 | 3.2 |
| 6 | DESIGN_SPECIFICATIONS.md の現行化 | docs | 1 | 1 | 80% | 0.25 | 3.2 |
| 7 | MCP ブリッジのレシピ文書化 | docs | 1 | 1 | 50% | 0.25 | 2.0 |
| 8 | Settings IA（29 パネル）の再編 | refactor | 4 | 1 | 50% | 1.5 | 1.3 |
| 9 | Obsidian Write 競合の影響調査 | investigate | 1 | 0.5 | 50% | 0.5 | 0.5 |

採点の補足:

- 順位 5 と 6 は同点（3.2）。リスク軽減効果（データ消失リスクの封じ込め）で監査を上位に
- 選択範囲の記録（順位 3）の軸との整合は自律解決済み: 手動記録（今すぐ記録ボタン）というユーザーアクション起点の前例が既にあり、選択範囲は既に収集している本文の部分集合なので軸 3（収集を増やさない）には反しない

## 実行順の推奨

RICE 順が基本。ただし**順位 4 の ROADMAP 再同期は、以後の提案裁定の土台（C2 / C5 / N11 の出荷済み機能との矛盾解消）なので、ラウンド冒頭に着手する実行順を推奨**（ユーザー承認済み）。

1. 04（ROADMAP 再同期。ラウンド冒頭）
2. 01（skip 理由の可視化。RICE 1 位）
3. 02（パス許可の裁定）
4. 03（選択範囲の記録）
5. 05（raw-owned keys 監査）
6. 06（DESIGN_SPECIFICATIONS 現行化）
7. 07（MCP ブリッジのレシピ）
8. 08（Settings IA の再編）
9. 09（Obsidian Write 競合の調査）

01 と 03 は依存なしで並列着手可。02 は裁定タスクが先。05 は新キーを触る機能（03 など）より先が安全。

## PBI ファイル

| NN | PBI | 種別 | RICE | SP | 根拠の要点 |
|---|---|---|---:|---:|---|
| 01 | [2026-10-31-01-feat-recording-skip-reason-visibility.md](2026-10-31-01-feat-recording-skip-reason-visibility.md) | feat | 30.0 | 2.0人週相当 | 条件未達の閲覧は経路を持たず、FAQ でしか答えられない。URL 非保存の形に限る |
| 02 | [2026-10-31-02-fix-path-allow-adjudication.md](2026-10-31-02-fix-path-allow-adjudication.md) | fix | 12.8 | 0.5人週相当 | UI「パス許可」vs 実装 hostname 正規化（既存 T4）。README と PRIVACY.md 同期 |
| 03 | [2026-10-31-03-feat-selection-capture-recording.md](2026-10-31-03-feat-selection-capture-recording.md) | feat | 8.0 | 1.5人週相当 | ハイライト相当の唯一の欠落（Web Clipper 比較）。軸整合は自律解決済み |
| 04 | [2026-10-31-04-docs-roadmap-resync.md](2026-10-31-04-docs-roadmap-resync.md) | docs | 6.4 | 0.25人週相当 | C2 / C5 / N11 が出荷済み機能と矛盾。ラウンド冒頭着手を推奨 |
| 05 | [2026-10-31-05-test-raw-owned-keys-audit.md](2026-10-31-05-test-raw-owned-keys-audit.md) | test | 3.2 | 0.5人週相当 | §5.1.1 自認の open work。分類漏れはマイグレーションでデータ消失 |
| 06 | [2026-10-31-06-docs-design-spec-refresh.md](2026-10-31-06-docs-design-spec-refresh.md) | docs | 3.2 | 0.25人週相当 | 見出し不一致・§5.2 の層の記述・フッタ v2.4 系のまま |
| 07 | [2026-10-31-07-docs-mcp-bridge-recipe.md](2026-10-31-07-docs-mcp-bridge-recipe.md) | docs | 2.0 | 0.25人週相当 | Memex の MCP 露出。既存 webhook 経由のレシピ文書。コード追加なし |
| 08 | [2026-10-31-08-refactor-settings-ia-reorg.md](2026-10-31-08-refactor-settings-ia-reorg.md) | refactor | 1.3 | 1.5人週相当 | 29 パネルの発見可能性。検索か再編の縦スライス |
| 09 | [2026-10-31-09-investigate-obsidian-write-conflict.md](2026-10-31-09-investigate-obsidian-write-conflict.md) | investigate | 0.5 | 0.5人週相当 | RMW 競合（README 自認）。hash 前提条件の要否判断材料 |
