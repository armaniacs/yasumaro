# PBI: 診断パネルへのGitHub issue報告導線を実装

## ユーザーストーリー
拡張機能のユーザーとして、設定画面の診断パネルから「不具合を報告」ボタンを押すだけで、必要な診断情報（APIキー等の機密情報を除く）が入った状態でGitHub issueページを開けるようにしたい。なぜなら、不具合に遭遇したときに開発者へ的確な情報を伝える手間を減らし、報告のハードルを下げたいから。

## 優先度
- 順位: 02 / 8
- RICEスコア: 16.0（Reach=10 × Impact=2 × Confidence=0.8 / Effort=1.0人日）
- 根拠: PBI 46（issueテンプレート/PRIVACY.md）に次いで実装すべき中核機能。後続のE2E検証（PBI 51）が本PBIの実装完了を前提とするため、これより後回しにはできない。

## 制約
- 診断情報の自動送信は行わない。ユーザーが内容を確認し、明示的にボタンを押してタブを開く操作を挟む
- `apiKey`・`baseUrl`・Obsidianの`dailyPath`・ログ本文（コード種別と件数のみ可、本文は不可）は本文生成関数の時点で除外する
- `DiagnosticsCollector`の生データを直接使わず、専用のサニタイズ関数（`buildIssueReportBody()`）を経由させる
- 外部タブを開く実装は既存パターン（`chrome.tabs.create({ url })`、`privacyConsentController.ts:291`と同じ書き方）に倣う

## BDD受け入れシナリオ

```gherkin
Scenario: ユーザーが診断パネルから不具合報告リンクを開く
  Given ユーザーが設定画面の診断パネル（panel-diagnostics）を開いている
  And AIプロバイダーにAPIキーが設定されている
  When ユーザーが「不具合を報告」ボタンを押す
  Then 生成されたissue本文のプレビューダイアログが表示される
  And プレビュー内容に拡張機能バージョン・ブラウザ情報・SQLite初期化状態・直近のエラーコード種別と件数が含まれる
  And プレビュー内容に apiKey・baseUrl・dailyPath の値が一切含まれない

Scenario: ユーザーがプレビューを確認したうえでissueページを開く
  Given ユーザーが不具合報告のプレビューダイアログを見ている
  When ユーザーが「開く」ボタンを押す
  Then chrome.tabs.create が正しいGitHub issue URL（armaniacs/yasumaro/issues/new起点、bug_reportテンプレート指定）で呼ばれ新規タブが開く
  And プレビューダイアログは閉じる

Scenario: 診断情報に機密情報が含まれる状態でもサニタイズされる
  Given AIプロバイダー設定に apiKey="secret-value" が保存されている
  And Obsidian接続設定に dailyPath="/Users/private/vault" が保存されている
  When buildIssueReportBody(snapshot) を呼び出す
  Then 戻り値の文字列に "secret-value" も "/Users/private/vault" も含まれない
  And 戻り値にはAIプロバイダーの種別名とObsidianのprotocol/portのみが含まれる
```

## 受け入れ基準
- [x] `src/dashboard/panels/diagnostic/issueReportLink.ts` が新規作成され、`buildIssueReportBody(snapshot)` を実装している
- [x] `panel-diagnostics` に「不具合を報告」ボタンとプレビュー確認ダイアログが追加されている
- [x] `apiKey`、`baseUrl`、`dailyPath`、ログ本文がissue本文に一切含まれないことがテストで保証されている
- [x] issueリンクは `chrome.tabs.create({ url })` で新規タブとして開く
- [x] URLの長さ制限を考慮し、本文が要点のみに絞られている

## テスト戦略
- E2E: 本PBIでは実装のみ。E2E検証は依存先のPBI 51（`dashboard-issue-report.spec.ts`）で実施
- 統合: なし（診断情報収集自体は既存の`DiagnosticsCollector`を再利用するため新規統合テストは不要）
- 単体: `src/dashboard/panels/diagnostic/__tests__/issueReportLink.test.ts` をTDDで先に書き、`buildIssueReportBody()` の実装をこのテストに追わせる（vitestの`include`パターンは`**/__tests__/**/*.test.ts`のみのため、`testDir/unit/`配下ではなく既存の`__tests__`配置に従う）。境界値（apiKey未設定、null/undefinedフィールド）も網羅する

## 見積もり
3pt（新規モジュール実装＋TDDでのサニタイズロジック＋UI組み込み）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `issueReportBody.test.ts` が診断スナップショットのあらゆるフィールド変化に対してAPIキー等を漏らさないことを確認している
- [x] コードレビュー完了
- [x] ドキュメント更新済み（PBI 46で追記したPRIVACY.mdとの整合性を再確認）
