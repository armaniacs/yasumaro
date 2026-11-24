# handoff: 02 開発中 4 機能の正式版での扱いの判定

## 状態
完了。owner の裁定済み。ADR を採用済みに更新した。

## 作業記録(2026-11-24)

- `grad-materials` ブランチの worktree(`/tmp/yasu-ga-grad`、`1124a` 基点)でサブエージェントが材料を棚卸し。コード変更・コミットなし
- 単体テストは worktree で実行しすべて緑(保存 75 件、履歴に聞く 55 件、レポート 58 件、webhook 86 件)
- E2E は `1124a` 上で `OW_E2E_PROBE=1` ビルドの `dist/chromium-mv3` に対し `--project=extension` で本体が実行し、13 件すべて緑(保存 5、履歴に聞く 5、レポート 2、webhook 3)
- PRIVACY.md / PERMISSIONS.md / SECURITY.md に 3 機能名(保存済みコレクション・履歴に聞く・調査レポート)での言及がないことを grep で確認(webhook は記載あり)
- 上記をもとに本体が ADR を作成し、一覧に登録した
- worktree と作業ブランチは片付け予定(コミットがないことを確認してから削除)

## 残りの手順
- なし。04 は「4 機能とも開発中のまま」を前提に掲載文と README を書く。09 の見送りを 04 に引き渡す

## 裁定結果(2026-11-24、owner)
- 保存済みコレクション、履歴に聞く、調査レポート、webhook export: すべて開発中のまま
- 09 host_permissions 最小化: 見送る
