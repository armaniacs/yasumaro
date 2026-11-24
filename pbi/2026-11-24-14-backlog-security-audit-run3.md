# 台帳: セキュリティ監査 run-3 (standard-scaled、完走)

出所: security-audit スキル相当の手順をサブエージェント 4 名(領域別 3 名 + 文書洗い出し 1 名)と本体の批評・検証で実施。skill ツールは環境で無効のため、run-1 の成果物構成(REPORT/FINDINGS-DETAIL/NEEDS-VALIDATION/findings.json/coverage-ledger.json/architecture.md/run-metadata.json)を踏襲した。
source ref `d3eea2533`(1124a 先頭)。差分の起点は `a1e3ffb23`(run-1 台帳コミット。run-1 の source ref `4790f224` は本リポジトリの履歴に無いため代用)。
結果: confirmed 6 件 / needs_validation 2 件(いずれも owner の製品判断待ち) / rejected 13 件。
検証: node の Headers プローブとコード再読で 3 件を解決済み(下記)。

## 成果物の恒久置き場 (run-1 と同前例)

- `./security-audit-yasumaro-run-3/` (REPORT.md / FINDINGS-DETAIL.md / NEEDS-VALIDATION.md / findings.json / coverage-ledger.json / architecture.md / run-metadata.json)
- `.gitignore` に `security-audit-yasumaro-run-*/` を追加済みで追跡外。台帳である本ファイルだけ追跡する
- workspace 内のため端末移行時は別途持ち出しが必要

## confirmed 6 件と対応

| # | 概要 | 対応 |
|---|---|---|
| C-1 | webhook 宛先 URL の平文保存と content script 可読 | 修正 PBI [15](2026-11-24-15-fix-webhook-token-plaintext-storage.md) |
| C-2 | payload の page URL(query 含む)が非マスク | owner の製品判断待ち(下記) |
| C-3 | regenerate の Obsidian 書き込み失敗が無音の成功になる | 修正 PBI [16](2026-11-24-16-fix-obsidian-failure-surfacing.md) |
| C-4 | 競合の誤分類(regenerate の通知文と offline handover の理由) | 修正 PBI [16](2026-11-24-16-fix-obsidian-failure-surfacing.md) |
| C-5 | content script が settings blob 全体を読む | 修正 PBI [17](2026-11-24-17-fix-blob-tier-trust.md) |
| C-6 | blob-first と top-level mode の世代ずれが許容側に倒れる | 修正 PBI [17](2026-11-24-17-fix-blob-tier-trust.md) |

## needs_validation 2 件(いずれも owner の製品判断)

- NV-1: 許可リスト内の第三者エンドポイント(AI プロバイダ、`api.github.com`)への送信路。仕組みはソースで確定。狭めるか残余リスクとして文書化するか
- NV-2: `ai_domain_policy` の不明値が `allowed` に正規化される。意図的な availability 優先。fail-closed に変えるか受容して文書化するか
- 解決済み(記録のみ): resend の `isPrivate:false` は文書化された意図的設計(明示選択が consent)として受容。ETag の無条件 PUT 後退は文書化された tradeoff として受容。不正 ETag の `Headers.set` 例外は node プローブとソースで fail-safe を確認し棄却

## 文書の更新(run-3 で実施)

- `dev-docs/SECURITY_REVIEW_GUIDE.md` に webhook の脅威モデル節を追加し、Threat Model Overview の表に webhook の行を追加
- 旧方式の説明を洗い出して修正: `PERMISSIONS.md` Reviewer Notes 2、`SECURITY.md:34`、`entrypoints/options/index.html` の `webhookExportDescription` 既定文と `messages.json`(en/ja)、`docs/MCP_BRIDGE_RECIPE.md`、`ROADMAP.md:120`

## 次のアクション

- [ ] owner の製品判断 3 件(C-2、NV-1、NV-2)に回答する
- [ ] 判断に応じて修正 PBI 15〜17 を実装する(発火デモ必須)
- [ ] 修正完了後に 2026-11-24-08(実機スモーク)へ進む。2026-11-24-04 の採番は修正完了の後に限る

## 引き継ぎ
状態: 監査完走。修正 PBI は未着手。owner の製品判断 3 件が残っている。進捗と引き継ぎ情報は [handoff/2026-11-24-07-release-ga-security-audit-run3.md](handoff/2026-11-24-07-release-ga-security-audit-run3.md) に記録する。
