# PBI: Issue報告モーダルの状態をcontrollerオブジェクトへ集約

## ユーザーストーリー
拡張機能の開発者として、issue報告モーダルの共有状態（`pendingUrl`・`modalWiredTo`）を module-scoped 変数ではなく専用のcontrollerオブジェクトに持たせたい、なぜなら現在 `wireIssueReportButton()` は「ボタンを配線するだけ」に見える関数シグネチャの裏で、2箇所（診断パネル・サイドバー）から呼ばれる前提の再入防止ガードを隠し持っており、呼び出し順序に意味があることが実装を読まないと分からないため。

## 優先度
- 順位: 04 / 4（最後に着手）
- RICEスコア: 0.4（Reach=開発者のみ(低頻度変更) × Impact=0.5 × Confidence=80% / Effort=1人日）
- 根拠: 既存の147行の配線テストが既に保険として機能しており緊急性は低い。他候補と比べ相対的にリスク軽減効果が小さいため最後に配置。依存関係なし。

## 制約
- 診断パネル・サイドバーの2箇所からの呼び出し方（呼び出しAPI）は変更しない、または変更する場合は両呼び出し元を同時に更新する
- 共有モーダルの表示・Cancel/Close/Open の既存動作は変えない

## BDD受け入れシナリオ

```gherkin
Scenario: 2つのボタンが同一のcontrollerインスタンスを共有する
  Given IssueReportModalController が1つ生成されている
  When 診断パネルのボタンとサイドバーのボタンそれぞれで attachTrigger(btn) を呼ぶ
  Then 両ボタンとも同じモーダルを正しく開閉できる

Scenario: 2回目のattachTriggerでリスナーが二重登録されない
  Given controller が既に1つのボタンにアタッチ済み
  When 2つ目のボタンに attachTrigger(btn) を呼ぶ
  Then モーダルのCancel/Close/Openリスナーは1セットのみ存在する

Scenario: 既存の配線テストがcontroller化後も意味を持つ
  Given issueReportLink.wire.test.ts が存在する
  When controller化後のコードに対してテストを実行する
  Then 再入防止の検証が引き続き意味のあるテストとして通過する（または縮小されたテストに置き換わる）
```

## 受け入れ基準
- [x] `createIssueReportModalController(modalEls, collectSnapshot)` が `{ attachTrigger(btn) }` を返すオブジェクトとして実装される
- [x] `pendingUrl`・`modalWiredTo` の module-scoped 変数がcontroller内部の状態に置き換わる
- [x] `dashboard.ts` でcontrollerを1度だけ生成し、診断パネル・サイドバー双方の配線に使い回す
- [x] 既存の `issueReportLink.wire.test.ts`（147行）が新しい構造に合わせて見直され、再入防止の保証がテストで示される（全15件green）

## テスト戦略
- E2E: 既存のissue報告導線E2E（PBI 51）をそのまま再実行し回帰がないことを確認
- 統合: 2つのボタンからのattachTrigger呼び出しでモーダル挙動が一致することを確認
- 単体: controller生成直後の初期状態、attachTrigger複数回呼び出し時のリスナー重複がないことの確認

## 見積もり
2ポイント（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
