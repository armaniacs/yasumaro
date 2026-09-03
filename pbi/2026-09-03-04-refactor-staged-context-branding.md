# PBI: StagedContext branding を seam で通すか削除する

## ユーザーストーリー
エンジニアとして、dead branding が残らないほしい、なぜなら StagedContext が compile 時順序保証を謳うのに seam(PipelineStep.execute)が unbranded RecordingContext を受け取り、約束された compile error が一度も発火しないから

## 優先度
- 順位: 4 / 7
- RICEスコア: 4.8（Reach=1 / Impact=2 / Confidence=80% / Effort=0.25）
- 根拠: PBI 03 完了後に着手（PipelineStep 型を変えるため依存）

## BDD受け入れシナリオ
Scenario: 順序違反が compile error
  Given PipelineStep<privacy, formatted> を実装する step
  When  未整形 markdown に直接アクセスする
  Then  type-check が失敗する

## 受け入れ基準
- [ ] PipelineStep<S,Next> に branding を通す、または branding を削除
- [ ] type-check green

## テスト戦略
- 型: compile-time assertion

## 見積もり
0.25 人週

## Definition of Done
- [ ] type-check green、dead code が残らない
