# handoff: 05 Obsidian 412 競合の利用者通知

## 状態
実装済み。`1124a` のコミット `f3b8df983` に取り込み済み。`npm run validate` は緑(1363 ファイル、19176 テスト)。

## 実装内容
- 再書き込み後も 412 が続いたときだけ競合専用の通知を 1 回出し、保留一覧に理由 `obsidian-write-conflict` で登録する
- 判定は既存の `isPreconditionConflict(resolveFailure(error))` を使用。`MAX_CONFLICT_REWRITES = 1` の挙動は不変
- 通知タイトルは `sanitizePageTitleForNotification` を通す。通知・ログ・保留にノート本文・ETag・API キーを含めない
- regenerate(`targetEntryId` あり)は通知のみで保留登録なし(`decideRecoveryOwner` に従う)
- 保留理由は新設(`obsidian-write-failed` の意味は変えない)。`isPrivacyPendingReason` には入れず再試行対象のまま
- `captureFailureReasons.ts` の新規行 `obsidian-write-conflict`(`category: storage`)の `i18nKey` はロケールに追加せず既存行と同一の扱いにした。`diagnosticsPanel` は `getMessageOr(entry.i18nKey, code)` で未登録キーをコード表示に縮退させるため、表の既存行(`captureFailure_domainBlocked` 以外はすべてロケール未登録)と統一するのが一貫すると判断した

## 作業記録
- `impl-obsidian-conflict-notice` ブランチの worktree(`/tmp/yasu-obs-conflict`、`1124a` 基点)でサブエージェントが実装。コミット `2e8847b37` を `1124a` に cherry-pick して取り込み
- worktree と作業ブランチは片付け済み(`git cherry 1124a` で `-` のみを確認してから削除)

## 残りの手順
- なし(コード側は完了)。PBI の受け入れ基準のうち E2E は追加しない方針のため、08(実機スモーク)の確認項目に「Obsidian 側で同じノートを編集しながら記録する手順」を加えること(PBI に記載済み)
- 07(監査 run-3)の対象に本変更が含まれる

## 要確認
- なし。本 PBI に関する owner の判断待ちは無い
