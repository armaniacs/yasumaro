# PBI: unhandled rejection と偽成功表示の解消（7 箇所）

## ユーザーストーリー

設定画面を使っているユーザーとして、保存操作が失敗したときに「成功」と表示されたり、何も表示されず画面が固まったりしないことがほしい、なぜなら async ハンドラの reject が unhandled rejection になると本番で気づけず、偽成功表示は失敗を隠すから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（成功表示のタイミングが await 後へ移るため、成功パスを pin するテストで待ち合わせの追加が必要になる可能性）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 3。なぜなぜ分析 /tmp/whywhy/outofscope-A.md（分析 7-13・現在地実測）2026-10-21

## 実装内容（現在地は実測・実装時に再確認）

1. customPromptManager handleSavePrompt: success 表示を await の後へ移動し、try/catch で失敗を表示する（async 関数の直接 addEventListener も是正）
2. markdownTemplateManager handleSaveClick: try/catch + showFieldError を追加する（reject で closeEditor / renderTemplateList 未実行の silent failure 解消）
3. trustSettings saveTrustSettings と void ハンドラ群: catch を追加する（PBI 14 で確立した safeLog + logError の seam 規約に合わせる）
4. onboardingWizard: try/catch/finally で closeWizard を finally へ移動する（reject でフォーカストラップが残るのを防ぐ。同ファイル内に正しいパターンが既にある）
5. service-worker の alarm リスナに guard を適用する（同一ブロックの他リスナはすべて適用済み）
6. flushScheduler: alarm listener に catch、onSuspend は race 全体を catch する（console.error 直呼びは logger 循環回避の意図的例外として維持。SUSPEND_FLUSH_TIMEOUT_MS は PBI 04 で定数化済み）
7. entrypoints/content/index.ts の動的 import に catch を付ける（2026-04-15 の web_accessible_resources 漏れバグがまさにこの経路）

## 受け入れ基準（BDD）

```gherkin
Scenario: 保存失敗が偽成功にならない
  Given 保存処理が reject する
  When ユーザーが保存を実行する
  Then 失敗が表示される
    And 「成功」は表示されない

Scenario: 失敗しても画面が固まらない
  Given ウィザードの完了処理が reject する
  When ユーザーが完了を実行する
  Then ウィザードは閉じられ、フォーカストラップは解除される
```

## テスト戦略

- 失敗パスのテストを新規追加する（現状 pin なしの箇所が多い）
- 成功パスを pin する既存テストで、表示タイミング移動による待ち合わせの追加が必要かを確認する（固定時間待ちは禁止・waitForMock を使う）

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 3・処理記録）
- dev-docs/archived/pbi/2026-10-20-14-refactor-silent-catch-visualization.md（safeLog + logError の seam 規約）
