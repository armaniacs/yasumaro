# PBI: attachTriggerに多重登録防止ガードを追加

## ユーザーストーリー
拡張機能の開発者として、`createIssueReportModalController`の`attachTrigger`メソッド自身に同一ボタンへの多重登録防止ガードを持たせたい、なぜなら現在は`NavigationRegistry`の`mountedPanels`によるmount-once保証に安全性を委ねる暗黙の依存があり、そちらの実装が変わればクリック1回で`chrome.tabs.create`が複数回呼ばれ複数タブが開く事故に直結するため。

## 優先度
- 順位: 01 / 4
- RICEスコア: 16.0（Reach=開発者(月数回の変更頻度) × Impact=2 × Confidence=100% / Effort=0.5人日）
- 根拠: adversarial-code-reviewで裏取り済み（issueReportLink.ts:131-141にガードなしを確認、NavigationRegistry.ts:77-83のmountedPanelsガードが現状の唯一の防御と確認）。実装コストが最小で恒久的にリスクを解消できる。依存関係なし。

## 制約
- `diagnosticsPanel.ts`・`dashboard.ts`からの既存呼び出しAPI（`attachTrigger(btn)`のシグネチャ）は変更しない
- 共有モーダルのCancel/Close/Openの既存動作は変えない
- 「異なるボタンを渡すケース」（診断パネル・サイドバー双方への配線）は引き続き正しく動作させる

## BDD受け入れシナリオ

```gherkin
Scenario: 同一ボタンに対しattachTriggerを複数回呼んでもリスナーは1つだけ登録される
  Given controller が生成されている
  When 同一のreportBtn要素に対して attachTrigger(btn) を2回呼ぶ
  Then そのボタンのクリックで chrome.tabs.create が1回だけ呼ばれる

Scenario: 異なる2つのボタンにattachTriggerした場合は両方とも正しく動作する
  Given controller が生成されている
  When 診断パネルのボタンとサイドバーのボタンにそれぞれ attachTrigger(btn) を呼ぶ
  Then 両方のボタンのクリックがそれぞれ独立して chrome.tabs.create を1回ずつ呼ぶ

Scenario: reportBtnがnullの場合は何もしない
  Given controller が生成されている
  When attachTrigger(null) を呼ぶ
  Then 例外を投げずに何もしない
```

## 受け入れ基準
- [ ] `attachTrigger`が、渡された`reportBtn`要素を内部の`WeakSet`（または同等の仕組み）で記録し、既に配線済みのボタンに対する再呼び出しでは`addEventListener`をスキップする
- [ ] 異なるボタン要素への`attachTrigger`は引き続き独立して正しく配線される（診断パネル・サイドバーの2箇所を壊さない）
- [ ] `issueReportLink.wire.test.ts`に「同一ボタンへの複数回`attachTrigger`」の直接テストを追加する（既存の`reentrancy guard`テストは実際には異なるボタンを検証しているだけだったため、名称と実装を一致させる）
- [ ] `NavigationRegistry`のmount-once保証に依存しない、`attachTrigger`自身の防御であることをテストで示す

## テスト戦略
- E2E: 既存のissue報告導線E2E（`dashboard-issue-report.spec.ts`）をそのまま再実行し回帰がないことを確認
- 統合: なし（controller単体のユニットテストで代替）
- 単体: 同一ボタンへの複数回`attachTrigger`でリスナーが1つだけ登録されること、異なるボタンへの複数回`attachTrigger`が独立して動作すること、null安全性

## 見積もり
1ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
