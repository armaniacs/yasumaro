# Backlog: 2026-08-27 レビュー詳細 findings 8件の一括対応

## 概要
2026-08-27 uncommitted review の Detailed Findings 8件を PBI 化し RICE で優先度付けしたバックログ。全てテスト包括スイートで導入された期待値/実装の不整合で、production コード変更は含まないが CI 安定性と将来の drift 防止に直結する。

## RICE スコア表
| 順位 | PBI | Reach | Impact | Confidence | Effort | RICE | 根拠 |
|------|-----|-------|--------|------------|--------|------|------|
| 1 | 01-fix-payloadguard-oom-allocation | 100 | 3 | 100% | 0.1 | 3000 | CI 全体をブロックする唯一の CRITICAL、Effort 極小で即効、依存なし |
| 2 | 02-fix-browsinglogcodec-nan-infinity | 50 | 2 | 90% | 0.1 | 900 | CHECK 違反で保存失敗、visit 毎に発生しうる |
| 3 | 03-fix-migrations-gist-index-error-handling | 30 | 2 | 80% | 0.1 | 480 | マイグレーション失敗黙殺は全インストールで不整合を隠す |
| 4 | 04-fix-fts-sanitizer-unification | 40 | 2 | 80% | 0.2 | 320 | 全文検索の主要機能、統一に設計判断が必要 |
| 5 | 05-fix-lrucache-capacity-zero | 10 | 1 | 80% | 0.05 | 160 | 稀だが不変条件違反をテストが固定している |
| 6 | 06-fix-storagefallback-id-waste-alias | 30 | 1.5 | 70% | 0.2 | 157.5 | ID 浪費 + alias drift、範囲広く確信度やや低 |
| 7 | 07-fix-offscreen-security-test-assertion | 10 | 0.5 | 100% | 0.05 | 100 | 偽陽性テスト、2 行で確実に修正 |
| 8 | 08-chore-remove-dead-code-imports | 10 | 0.5 | 100% | 0.05 | 100 | 未使用 import、削除のみでリスクなし |

同点 (07/08) はリスク軽減効果で 07 を先とした。

## 依存関係
- 01 は独立、最優先で単独実行可
- 02-06 は互いに独立、01 の後に並列実行可 (ファイルが重ならない)
- 04 は FTS 方針決定が他検索関連 PBI に波及するため 02/03 完了後に着手推奨だがブロッカーではない
- 07/08 は全 PBI 完了後にまとめて片付け可

## 推奨着手順 (ファイル名 NN がそのまま着手順)
- `01` → `02,03` 並列 → `04,05,06` 並列 → `07,08` 並列

## なぜなぜ分析サマリ
- 01 OOM: 長さだけを見る分岐を配列でテストしたため。length スタブで十分。
- 02 NaN: `Number()` の非有限値を `null` に正規化する発想が抜け、テストが誤期待を固定。
- 03 GIST: `already exists` を無視する意図で広い catch を書き、区別を忘れた。
- 04 FTS: 2 箇所で別実装し SSOT を決めずにテストを書いたため逆の期待がロックされた。
- 05 LruCache: `0>=0` の真で空 Map から undefined を evict、テストが違反を正常とした。
- 06 Fallback: ID 確保を存在チェック前に行い、alias も 2 箇所で二重実装した。
- 07 Security: `return false` 仕様をコメントで意図したが expect に落とし込まなかった。
- 08 Dead code: `type-check` が未使用 import を検出しないため残存した。

## 出力ファイル
- `pbi/2026-08-27-01-fix-payloadguard-oom-allocation.md`
- `pbi/2026-08-27-02-fix-browsinglogcodec-nan-infinity.md`
- `pbi/2026-08-27-03-fix-migrations-gist-index-error-handling.md`
- `pbi/2026-08-27-04-fix-fts-sanitizer-unification.md`
- `pbi/2026-08-27-05-fix-lrucache-capacity-zero.md`
- `pbi/2026-08-27-06-fix-storagefallback-id-waste-alias.md`
- `pbi/2026-08-27-07-fix-offscreen-security-test-assertion.md`
- `pbi/2026-08-27-08-chore-remove-dead-code-imports.md`
