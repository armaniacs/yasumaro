# PBI: ユーザーの迷い定量化基盤とCI回帰防止の組み込み

## ユーザーストーリー
拡張機能の開発者として、主要タスク（設定変更・検索・エクスポート・issue報告）ごとのクリック数・入力ステップ数を計測し、UI変更によって操作が複雑化（＝ユーザーが迷いやすく）していないかをCIで自動検知したい。なぜなら、個別のユーザビリティテストがPASSするだけでは「使いやすさが劣化していないか」の継続的な監視にならないため。

## 優先度
- 順位: 08 / 8（最後に実行）
- RICEスコア: 4.8（Reach=6 × Impact=2 × Confidence=0.6 / Effort=1.5人日）
- 根拠: PBI 47・48・49・50で実装される全E2Eシナリオが先に揃っていないと、それらのタスクフローに対するクリック数・ステップ数の初期基準値を計測・記録できない。そのため依存関係上、実行順は必ず最後になる。

## 制約
- PBI 47（ダッシュボード）・48（エラー系）・49（ポップアップ）・50（a11y/i18n）の実装完了が前提
- 初回実行時は現状の実測値を基準値として記録し、以降は「悪化のみ」を検知する運用にする（厳しすぎる初期値による誤検知を避ける）

## BDD受け入れシナリオ

```gherkin
Scenario: 主要タスクのクリック数・ステップ数が計測される
  Given frictionMeterでラップされたPlaywrightページ操作がある
  When 設定変更・検索・エクスポート・issue報告の各タスクを実行する
  Then 各タスクのクリック数・入力ステップ数が記録される

Scenario: 初回実行で基準値が記録される
  Given usability-budget.json が空または存在しない
  When task-friction-metrics.spec.ts を初回実行する
  Then 現在の実測値が基準値としてusability-budget.jsonに記録される

Scenario: UI変更によりステップ数が増加した場合にCIが検知する
  Given usability-budget.json に既存の基準値が記録されている
  When UI変更後にtask-friction-metrics.spec.ts を実行し、いずれかのタスクのステップ数が基準値を超える
  Then CIが失敗し、悪化したタスク名としきい値超過の詳細が報告される

Scenario: ステップ数が基準値以下であれば問題なく通過する
  Given usability-budget.json に既存の基準値が記録されている
  When UI変更後にtask-friction-metrics.spec.ts を実行し、すべてのタスクのステップ数が基準値以下である
  Then CIはPASSする
```

## 受け入れ基準
- [ ] `testDir/e2e/usability/support/frictionMeter.ts` が新規作成され、`page.click`/`page.fill`をラップしてステップ数をカウントする
- [ ] `testDir/e2e/usability/support/usability-budget.json` が新規作成され、タスクごとの許容クリック数/ステップ数のしきい値を保持する
- [ ] `testDir/e2e/usability/task-friction-metrics.spec.ts` が新規作成され、主要タスクごとの計測としきい値比較を行う
- [ ] `testDir/playwright.config.ts` に`usability`プロジェクト（`@usability`タグ）が追加されている
- [ ] `package.json` に `test:e2e:usability` スクリプトが追加されている
- [ ] CIワークフロー（`.github/workflows/`）に `test:e2e:usability` の実行が組み込まれている

## テスト戦略
- E2E: `testDir/e2e/usability/task-friction-metrics.spec.ts`（`@usability`タグ）。PBI 47〜50の全シナリオに対してfrictionMeterを適用する形で計測
- 統合: CIワークフロー上での`usability`プロジェクト実行そのものが統合検証を兼ねる
- 単体: なし（frictionMeterのカウントロジック自体は単純なラッパーのため、E2E実行内での動作確認で足りる）

## 見積もり
3pt（新規計測基盤の実装＋CI組み込み＋既存4PBI分のタスクフローへの適用）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run test:e2e:usability` で`task-friction-metrics.spec.ts`を含む全ファイルがPASSする
- [ ] CIワークフローに `test:e2e:usability` が組み込まれ、PRで自動実行される
- [ ] コードレビュー完了
