# PBI 2026-09-12-02 — archivePanel 復元→セッション引継ぎの修正（復元後セッションが空のまま）

- **種別**: 🔧非機能追加（fix・実バグ修正）
- **優先度**: 2 位 / RICE **28.8**（R6 × I3 × C80% / E0.5人日）
- **出典**: round 9 診断 候補 02・直接検証済み

## 背景（なぜ）

復元フロー（`archivePanel.ts:434-492`）は `restoreStagingName` を設定し（:448）、`archiveRestorePreview` 後に fire-and-forget で `archiveOpen(restoreStagingName)` + `renderSessionList()` を実行する（:479-484）。しかし `sessionStaging`（:215）は `archiveOpen` 成功後も設定されないため、`renderSessionList` の guard（:218 `if (!sessionStaging) return`）で一覧が空のまま。sessionSaveBtn / sessionCloseBtn（:394 / :409、同一 guard）も remount して `archiveStatus()` が再同期（:367-380）されるまで死んだ状態。さらに open+render が `setBusy` スコープ外の `void (async…)()` で走るため、連続 file pick が OPFS 書込と interleave し得る。

## スコープ

- `archiveOpen` 成功後に `sessionStaging = restoreStagingName` を設定
- open + renderSessionList を setBusy スコープ内の await に移動（fire-and-forget 解消・失敗は既存 catch で status 表示）

## 受け入れ基準（BDD）

### シナリオ 1: 復元プレビュー確認後にセッションが表示される（ハッピーパス）
```gherkin
Given 復元ファイル選択から archiveRestorePreview が成功している
When archiveOpen が成功する
Then sessionStaging が復元 staging 名に設定される
And renderSessionList が staging の行一覧を表示する
And sessionSaveBtn / sessionCloseBtn が操作可能になる
```

### シナリオ 2: open 失敗時はエラー表示で busy が解除される（エラー）
```gherkin
Given archiveOpen がエラーを返す
When 復元プレビュー確認後の open が完了する
Then status にエラーメッセージが表示される
And setBusy(false) が実行され二重 file pick が排除されている
```

## DoD

- [x] handoff 修正 + busy スコープ移動
- [x] 回帰 pin テスト（復元→セッション表示）
- [x] dashboard archive テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし

## 実装メモ（2026-09-12）

- `archiveOpen` 成功後に `sessionStaging = restoreStagingName` を設定し、open + renderSessionList を setBusy スコープ内の await に移動（fire-and-forget `void (async…)()` を解消）。open 失敗時は外側 catch がエラー表示 + finally で setBusy(false) する既存経路に乗る
- 回帰テスト: 復元プレビュー → open → セッション行 1 件 render + `archiveQuery` が復元 staging 名で呼ばれることを pin（修正前は guard で空のまま）
