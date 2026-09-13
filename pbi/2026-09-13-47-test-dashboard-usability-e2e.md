# PBI: ダッシュボードUIユーザビリティE2Eテストを追加

## ユーザーストーリー
拡張機能の開発者として、設定画面の16パネルへの到達性、設定変更タスクの完了、検索結果の実データ検証、タグクラウド描画、Markdownダウンロードの実行結果を自動テストで保証したい。なぜなら、これらは既存のe2eテストが表示・単発インタラクション確認にとどまっており、「ユーザーが実際に目的を達成できるか」を検証する層が存在しないため。

## 優先度
- 順位: 07 / 8
- RICEスコア: 5.6（Reach=8 × Impact=2 × Confidence=0.7 / Effort=2.0人日）
- 根拠: 独立候補群の中でEffortが最大（5シナリオを1PBIにまとめているため）。他の独立候補（PBI 48/49/50）より工数がかさむためRICEが下がり、実行順は最後から2番目になる。

## BDD受け入れシナリオ

```gherkin
Scenario: sidebarの16パネルすべてに到達できる
  Given ダッシュボードを開いている
  When 16個のdata-panelボタンを順にクリックする
  Then 対応するrole="tabpanel"が表示され、他のパネルは非表示になる
  And キーボードのみ（Tab/矢印キー）でも同じ到達性がある

Scenario: ドメインフィルタ追加タスクを最後まで完了できる
  Given ダッシュボードの設定画面を開いている
  When ユーザーがドメインフィルタを追加して保存する
  And ダッシュボードを再読み込みする
  Then 追加したドメインフィルタの設定が保持されている

Scenario: 検索結果が実データに基づいて正しく表示される
  Given 記録データが投入されたダッシュボードを開いている
  When ユーザーが検索キーワードを入力する
  Then 該当する結果一覧の件数と内容が期待通りに表示される
  And 該当しないキーワードでは適切な空状態メッセージが表示される

Scenario: タグクラウドがデータに応じて正しく描画される
  Given 十分な数のユニークタグを持つ記録データが投入されている
  When タグクラスタパネルを開く
  Then SVG/Canvas内の描画ノード数がユニークタグ数と一致する

Scenario: Markdownエクスポートが実際にダウンロードされる
  Given ダッシュボードにエクスポート対象のデータがある
  When ユーザーがエクスポートボタンを押す
  Then ダウンロードイベントが発生する
  And 保存されたファイルがMarkdown形式で想定内容を含む
```

## 受け入れ基準
- [ ] `testDir/e2e/usability/dashboard-navigation.spec.ts` が新規作成されている
- [ ] `testDir/e2e/usability/dashboard-task-flows.spec.ts` が新規作成されている
- [ ] `testDir/e2e/usability/dashboard-search-results.spec.ts` が新規作成されている
- [ ] `testDir/e2e/usability/dashboard-tag-cluster.spec.ts` が新規作成されている
- [ ] `testDir/e2e/usability/dashboard-markdown-export.spec.ts` が新規作成されている
- [ ] テストデータ投入用ヘルパー（既存パターンの流用または`seedRecords.ts`新規作成）が整備されている

## テスト戦略
- E2E: 上記5ファイル（`@extension`タグ、既存`dashboard.fixture.ts`パターンを再利用。データ投入は`dashboardSqliteHelpers.ts`の`seedRows`）。Markdownエクスポートは`page.waitForEvent('download')`でダウンロードイベントを捕捉
- 統合: なし
- 単体: 実装時に既存カバレッジを確認した結果、Markdownファイル名/内容生成ロジックは`src/dashboard/__tests__/markdownExport.test.ts`ほか3ファイルで、検索クエリ正規化はPBI 2026-09-12-42〜44（直前マージ済み）の多層防御テストで既にカバー済みと判明。重複するユニットテストの新規作成は行わず、E2Eレベルの検証のみで完結させた

## 見積もり
3pt（5つのE2Eシナリオファイル。当初想定のユニットテスト2件は既存カバレッジで充足のためスコープから除外）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npx playwright test --project=extension testDir/e2e/usability/dashboard-*.spec.ts` で5ファイルすべてがPASSする
- [ ] コードレビュー完了
