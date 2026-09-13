# PBI: GitHub issueテンプレート新設とPRIVACY.md追記

## ユーザーストーリー
拡張機能の開発者として、ユーザーが不具合報告する際に必要な情報を漏れなく書いてもらえるissueテンプレートがほしい。また、ユーザーとして、診断情報の一部がGitHubへ送信される場合があることをプライバシーポリシーで事前に把握できるようにしたい。なぜなら、issue報告導線（PBI 45/51）を実装する前提として、送信先テンプレートとプライバシー上の告知が先に揃っている必要があるため。

## 優先度
- 順位: 01 / 8（実行順の先頭。RICEスコア最高かつ他候補への依存なし）
- RICEスコア: 36.0（Reach=10 × Impact=1 × Confidence=0.9 / Effort=0.25人日）
- 根拠: ドキュメントのみの変更で工数が極小、かつ後続のissue報告導線（PBI 45・51）が参照する土台になるため最優先。実装コードへの依存が一切ない独立候補。

## BDD受け入れシナリオ

```gherkin
Scenario: ユーザーがissueテンプレートに沿って不具合を報告する
  Given ユーザーが GitHub の New Issue ページ (?template=bug_report.md 付き) を開いている
  When テンプレートが読み込まれる
  Then 「発生した問題」「再現手順」「拡張機能バージョン」「ブラウザ情報」の入力欄が表示される
  And 既存の .github/pull_request_template.md と一貫したMarkdown構成になっている

Scenario: ユーザーがプライバシーポリシーでissue報告時の情報送信範囲を確認する
  Given ユーザーが public/PRIVACY.md または docs/PRIVACY.md を開いている
  When "Third-Party Services" セクションを読む
  Then 「バグ報告機能でユーザーが選択した場合のみ診断情報の一部がGitHubへ送信される」旨が明記されている
  And public/PRIVACY.md と docs/PRIVACY.md の記述が完全に一致している
```

## 受け入れ基準
- [x] `.github/ISSUE_TEMPLATE/bug_report.md` が新規作成され、既存 `.github/pull_request_template.md` と同様のMarkdown構成に準拠している
- [x] `public/PRIVACY.md` の「Third-Party Services」セクションにissue報告機能の記述が追加されている
- [x] `docs/PRIVACY.md` に同一内容が反映されている（CLAUDE.md記載のPRIVACY.md同期ルール順守）
- [x] 自動送信ではなくユーザーの明示的操作が必要である旨が明記されている

## テスト戦略
- E2E: なし（本PBIはドキュメントのみ。E2E検証はPBI 51の `dashboard-issue-report.spec.ts` で行う）
- 統合: `docs/PRIVACY.md` と `public/PRIVACY.md` の差分がないことを確認するスクリプト実行（既存の同期チェックがあれば流用、なければ `diff` コマンドで手動確認）
- 単体: なし

## 見積もり
1pt（ドキュメント作成のみ、コード変更なし）

## Definition of Done
- [x] 全BDDシナリオの内容が実際のファイルに反映されている
- [x] `public/PRIVACY.md` と `docs/PRIVACY.md` が完全一致している
- [x] コードレビュー完了
