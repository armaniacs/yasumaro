# PBI: issue報告導線のE2E検証を追加

## ユーザーストーリー
拡張機能の開発者として、「不具合を報告」ボタンから実際にGitHub issueページが正しい内容で開くこと、かつAPIキー等の機密情報が絶対に混入しないことを自動テストで継続的に保証したい。なぜなら、UIの変更や診断情報の構造変更によって機密情報漏洩やリンク破損が再発するリスクを防ぎたいから。

## 優先度
- 順位: 03 / 8
- RICEスコア: 9.6（Reach=6 × Impact=1 × Confidence=0.8 / Effort=0.5人日）
- 根拠: PBI 45（issueReportLink実装）とPBI 46（テンプレート/PRIVACY.md）に依存するため、単純なRICE値では中位でもこの2件の直後に実行する必要がある。

## 制約
- PBI 45（`src/dashboard/panels/diagnostic/issueReportLink.ts`）とPBI 46（`.github/ISSUE_TEMPLATE/bug_report.md`）の実装完了が前提
- 既存の `testDir/e2e/fixtures/dashboard.fixture.ts` のpersistent context起動パターンを再利用する

## BDD受け入れシナリオ

```gherkin
Scenario: E2Eで不具合報告ボタンからプレビューを経てissueページが開く
  Given ダッシュボードを開いており、AIプロバイダーにAPIキー "test-secret-key" が設定されている
  When 診断パネルの「不具合を報告」ボタンをクリックする
  Then 本文プレビューダイアログが表示される
  And プレビュー内のテキストに "test-secret-key" という文字列が含まれない
  When 「開く」ボタンをクリックする
  Then chrome.tabs.create が "https://github.com/armaniacs/yasumaro/issues/new" を含むURLで呼ばれたことが検証できる

Scenario: プレビューをキャンセルした場合はタブが開かない
  Given 診断パネルの「不具合を報告」ボタンを押しプレビューダイアログが表示されている
  When ユーザーがキャンセル操作を行う
  Then chrome.tabs.create は呼ばれない
  And プレビューダイアログが閉じる
```

## 受け入れ基準
- [x] `testDir/e2e/usability/dashboard-issue-report.spec.ts` が新規作成されている
- [x] プレビュー本文にAPIキー・baseUrl・dailyPathの値が一切含まれないことをテキスト検証している
- [x] `chrome.tabs.create` が正しいissue URL（`armaniacs/yasumaro/issues/new`起点）で呼ばれることを検証している
- [x] キャンセル時にタブが開かないことも検証している

## テスト戦略
- E2E: `testDir/e2e/usability/dashboard-issue-report.spec.ts`（新設の`usability`プロジェクト、`@usability`タグ）
- 統合: なし
- 単体: なし（単体レベルの機密除外検証はPBI 45の`issueReportBody.test.ts`が担当済み）

## 見積もり
1pt（既存fixtureパターンの再利用による1シナリオファイルの追加）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run test:e2e:usability` で本テストがPASSする
- [x] コードレビュー完了
