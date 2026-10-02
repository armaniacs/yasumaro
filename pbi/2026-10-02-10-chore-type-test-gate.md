# PBI: 型・テストゲートの沈黙除外を解消する

種別: chore (C5, RICE #8)

## ユーザーストーリー

型エラーを早期に検知したい保守担当者として、`validate` ゲートが型エラーを確実に検出してほしい。除外で沈黙のままでは回帰が見逃されるから。

## 背景

`testDir/tsconfig.json` の除外設定と `package.json:35` の `validate` 配線により、型エラーがゲートで検出されない可能性がある。現状のエラー数を計測し、ゲート green 化か baseline 機構の復活かのいずれかで決着させる。

## スコープ (file:line)

- `testDir/tsconfig.json`
- `package.json:35` (validate 配線)

## BDD 受け入れシナリオ

```gherkin
Scenario: ゲートが green になる場合
  Given 現状の型エラー数が計測・記録されている
  When 除外の misalignment が修正される
  Then validate ゲートが green になる

Scenario: baseline を復活させる場合
  Given 即時の全件修正が非現実的である
  When baseline 機構が復活する
  Then エラー数が pin され、増加が検出できる
```

## 受け入れ基準 (file-scoped)

- [ ] 現状の型エラー数が計測され、数値が本 PBI に記録されている
- [ ] いずれかが実施されている: (a) misalignment 修正によりゲート green、または (b) baseline 機構の復活 + エラー数の pin
- [ ] (b) の場合、baseline 数値を上回るとゲートが失敗することがテストまたは CI 設定で担保されている
- [ ] 沈黙の除外 (検出なしにエラーを隠す設定) が残っていない

## テスト戦略

- 計測: type-check 実行による現状エラー数の記録
- 検証: `npm run validate` の green 確認、または baseline 超過で失敗することの確認
- 既存テスト green 維持

## 振る舞い変更ルール (chore)

- 本番コードの振る舞い変更を含めない (型・設定・ゲート配線のみ)
- 除外の追加は禁止し、除外の縮小のみ許可する (baseline 方式の場合、pin 数値の削減のみ許可)
- validate 配線の変更は `package.json:35` に限定し、他スクリプトへの波及をしない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する (または baseline 機構が意図通り失敗・成功を切り替えることを確認)
- [ ] コードレビュー完了
