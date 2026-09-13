# PBI: アクセシビリティ・i18n表示崩れのユーザビリティE2Eテストを追加

## ユーザーストーリー
拡張機能の開発者として、キーボードのみで主要タスクを完了できること、およびja/en切り替え時にレイアウト崩れや文言欠落が起きないことを自動テストで保証したい。なぜなら、スクリーンリーダー利用者やキーボード操作ユーザー、英語UIを使う海外ユーザーが取り残されないようにしたいから。

## 優先度
- 順位: 05 / 8
- RICEスコア: 11.2（Reach=8 × Impact=2 × Confidence=0.7 / Effort=1.0人日）
- 根拠: PBI 49と同点。既存の`a11y.spec.ts`（axe-core）と`release-checks/check-i18n.mjs`という土台が既にあり、実装確信度が高い。依存関係がなく独立して着手できる。

## BDD受け入れシナリオ

```gherkin
Scenario: 主要タスクをキーボードのみで完了できる
  Given ダッシュボードを開いている
  When ユーザーがTab/Enter/Escapeのみを使って「設定変更→保存」のタスクを実行する
  Then マウス操作なしでタスクが完了する
  And 各操作ステップでフォーカスが視覚的に識別可能な要素に当たっている

Scenario: 各パネルがWCAG AA基準に違反しない
  Given ダッシュボードの16パネルのいずれかを開いている
  When axe-coreによるアクセシビリティスキャンを実行する
  Then WCAG AA違反が0件である

Scenario: 日本語/英語切り替え時にレイアウトが崩れない
  Given chrome.i18nをjaまたはenに切り替えた状態でダッシュボードの各パネルを開く
  When 各要素の描画幅を計測する
  Then どの要素も scrollWidth が clientWidth を超えない（オーバーフローしない）

Scenario: 日本語/英語切り替え時に文言欠落がない
  Given chrome.i18nをjaまたはenに切り替えた状態でダッシュボードとポップアップを開く
  When 画面上のテキストを走査する
  Then i18nキー名がそのまま表示されている箇所が存在しない
```

## 受け入れ基準
- [ ] `testDir/e2e/usability/a11y-usability.spec.ts` が新規作成されている
- [ ] `testDir/e2e/usability/i18n-layout.spec.ts` が新規作成されている
- [ ] 主要タスク（設定変更、記録開始、検索）がキーボードのみで完了できることを検証している
- [ ] 各パネルでaxe-coreスキャンを実行しWCAG AA違反ゼロを確認している
- [ ] ja/en切り替え時のオーバーフロー検知が実装されている
- [ ] i18nキーがそのまま表示される文言欠落の検知が実装されている

## テスト戦略
- E2E: `testDir/e2e/usability/a11y-usability.spec.ts`、`i18n-layout.spec.ts`（`@usability`タグ、既存`a11y.spec.ts`の`AxeBuilder`パターンと`dashboard.fixture.ts`を再利用）
- 統合: なし（i18nキー網羅性自体は既存`release-checks/check-i18n.mjs`が担当。本PBIは見た目のレイアウト崩れ側を新規に担当）
- 単体: なし

## 見積もり
2pt（2シナリオファイル、既存axe-core/a11yプロジェクトの流用でリスクは低い）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run test:e2e:usability` で両ファイルがPASSする
- [ ] コードレビュー完了
