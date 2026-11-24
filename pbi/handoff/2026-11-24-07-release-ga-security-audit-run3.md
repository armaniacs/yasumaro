# handoff: 07 正式版前のセキュリティ監査 run-3

## 状態
監査完走。修正 PBI 15〜17 を起票済み。owner の製品判断 3 件が残っている。

## 作業記録(2026-11-24)

- skill ツールが環境で無効のため、run-1 の成果物構成を踏襲して本体が直接実施した
- サブエージェント 4 名が `1124a` 基点の worktree でソース検査のみ実施(拡張の実行・テスト・ビルドなし)。本体が批評として全 confirmed の trace を再読し、node の Headers プローブと grep で 3 件を解決した
- 成果物は `./security-audit-yasumaro-run-3/`(追跡外、`.gitignore` の `security-audit-yasumaro-run-*/` で除外)。台帳は `pbi/2026-11-24-14-backlog-security-audit-run3.md`
- 差分の起点は `a1e3ffb23`(run-1 の source ref `4790f224` は本リポジトリの履歴に無い)。差分 583 ファイル、+12653/-1798
- 結果: confirmed 6 件 / needs_validation 2 件(製品判断待ち) / rejected 13 件
- 文書の更新まで実施: `dev-docs/SECURITY_REVIEW_GUIDE.md` に webhook 脅威モデル節と表の行を追加。旧方式の説明を修正(`PERMISSIONS.md` Reviewer Notes 2、`SECURITY.md:34`、`entrypoints/options/index.html` 既定文と `messages.json` en/ja、`docs/MCP_BRIDGE_RECIPE.md`、`ROADMAP.md:120`)
- worktree 4 件と作業ブランチは片付け予定(コミットがないことを確認してから削除)

## 残りの手順
- owner の製品判断 3 件(C-2 payload URL、NV-1 第三者送信路、NV-2 ai fail-open)に回答する
- 判断に応じて修正 PBI 15〜17 を実装する(発火デモ必須)
- 修正完了後に 08(実機スモーク)へ進む。04 の採番は修正完了の後に限る

## 要確認(owner の判断待ち)
- C-2: payload の URL から query を除くか、受容して文書化するか
- NV-1: 許可リストを webhook 専用ホストに狭めるか、残余リスクとして文書化するか(文書化は実施済み)
- NV-2: `ai_domain_policy` の不明値を fail-closed に変えるか、受容して文書化するか
