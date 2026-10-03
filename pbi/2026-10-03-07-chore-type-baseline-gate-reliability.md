# PBI: テスト型 baseline ゲートの信頼性（CI 未配線・fake green・総数比較の限界）

## ユーザーストーリー

CI を信頼してマージしたい保守担当者として、テスト型エラーの baseline ゲートが実際に機能してほしい。現状は CI で未実行・tsc クラッシュで fake green・総数比較で相殺変更がすり抜ける。

## 優先度

- 順位: 07/15
- RICE: 4.0（R2 / I2 / C1.0 / E1.0）
- 根拠: 実検証済みの欠陥 3 件（CI 未配線・crash で PASS・相殺変更 PASS）+ stale な CHANGELOG 記載。スクリプト/配線の小変更で対処可能（C1.0・E1.0）
- 依存: なし（`.github/workflows/ci.yml`・`scripts/check-type-test-baseline.mjs`・`testDir/`・`CHANGELOG.md`）

## 現状（証拠・3 件の実検証済み欠陥）

- (a) `.github/workflows/ci.yml:133-148` は type-check（src のみ）+ test:perf を実行するが `type-check:test:baseline` を実行しない。6 workflows を走査したが validate も baseline も実行する workflow が無い → テスト型エラーは CI で無上限
- (b) `scripts/check-type-test-baseline.mjs:53-56` の catch は stdout+stderr を返す → tsc crash / npx 失敗時に TS エラー行 0 件 → count 0 < 489 で **PASS（fake green）**。tsc が実際に走ったことの健全性チェックが無い。`testDir/__tests__/type-test-baseline.test.ts:72-75` は stub 空出力のみカバー
- (c) `evaluateBaseline`（`scripts/check-type-test-baseline.mjs:28-42`）は総数比較のみ → 相殺変更（旧 1 件削除 + 新 1 件追加）が PASS。`testDir/tsconfig.json` の include 縮小でも count 低下 → PASS。include set を pin するテストが無い
- stale: `CHANGELOG.md:1192` は「テストコードに型エラーを持ち込むと CI が落ちる」と主張（現状と矛盾）

## BDD受け入れシナリオ

```gherkin
Scenario: tsc クラッシュで fake green にならない
  Given npx tsc が異常終了する
  When check-type-test-baseline が実行される
  Then TS エラー行数 0 を根拠に PASS しない（tsc が走った証拠が無い場合は失敗する）

Scenario: baseline が CI で機能する（配線する裁定の場合）
  Given CI がテスト型チェックを実行する
  When テスト型エラーが pinned 上限を超える
  Then CI が失敗する

Scenario: local-only の裁定は正直に文書化される
  Given baseline を CI に配線しない裁定をする
  When ドキュメントを確認する
  Then local-only である旨が明記され、CHANGELOG の stale 記載が現状と整合する
```

## 受け入れ基準

- [ ] 方式裁定（CI へ baseline 配線 / local-only として正直に文書化）が実装記録に 1 行残されている
- [ ] `scripts/check-type-test-baseline.mjs:53-56` の catch 経路に tsc 実行の健全性チェック（summary 行検出 / 異常終了の扱い）が追加され、crash → count 0 → PASS の fake green が構造的に起こらない
- [ ] `scripts/check-type-test-baseline.mjs:28-42`（evaluateBaseline）の総数比較の限界（相殺変更・`testDir/tsconfig.json` include 縮小）が文書化され、include set pin テストの要否が実装記録に残る
- [ ] `CHANGELOG.md:1192` の「テストコードに型エラーを持ち込むと CI が落ちる」の stale 記載が現状と整合する
- [ ] `testDir/__tests__/type-test-baseline.test.ts` に crash 経路のテストが追加されている（`:72-75` は stub 空出力のみ）

## テスト戦略

- 単体: `check-type-test-baseline.mjs` の catch 経路に crash の produce（空 stdout+stderr / 例外）を注入し、fake green にならないことを pin
- 単体: tsc-ran sanity の正負両経路（summary あり / なし）を stub で pin
- 既存テスト green 維持 + `npm run validate` が通ること

## 見積もり

1.0 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
