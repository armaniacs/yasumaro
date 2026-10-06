# PBI: bench fixture の独自 launcher を正規に委譲する

## ユーザーストーリー

bench の保守担当者として、起動器を E2E と統一したい。bench が独自 tryLaunch を持つため、E2E 側の起動修正が bench に届かず、計測対象の起動状態が系統的にずれるから。

## 優先度

- 順位: 13/23
- RICE: 2.4（R4 / I1 / C0.8 / E1）
- 根拠: 委譲置換のみ。NN14 の着地後（委譲先の確定）
- 依存: NN14

## 背景（file:line 現状）

- `bench/e2e/_fixtures.ts:16`（独自 EXTENSION_PATH）、`:28-54`（独自 tryLaunch: resolver/cert/serviceWorkers 設定なし、SW ポーリング `:39-47`）、`:56-71`（context/extensionId 定義）、`:73-84`（benchPage/cdp は bench 固有で残す）
- 正規品: `testDir/e2e/fixtures/launchExtensionContext.ts:164-217`
- 乖離: bench は consent 未 seed・TLS fixture 解決なしの別条件。`extensionId` 取得もフォールバック直呼びで二重管理
- 維持: `test.skip` へのフォールバック行（`:59-62`）

## BDD受け入れシナリオ

```gherkin
Scenario: 起動が正規に委譲される
  Given bench の起動
  When 実行する
  Then launchExtensionContext（consent seed 付き）+ resolveExtensionId を経由する

Scenario: bench 固有部が残る
  Given benchPage / cdp / throttleCpu
  When 実行する
  Then 従来どおり動作する
```

## 受け入れ基準

- [x] `tryLaunch` 本体が委譲に置換され、`benchPage/cdp/throttleCpu` だけ残っている
- [x] `test.skip` フォールバック行が維持されている
- [x] 振る舞いは E2E 側に寄る（意図的統一）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- bench 実行は環境要のため CI 範囲。静的検証は validate で確認
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `bench/e2e/_fixtures.ts` のみ（委譲置換。bench 固有部と skip フォールバックは維持）
- ゲート: eslint PASS / type-check PASS（全体）/ lint 0 errors。bench 実行は CI 範囲
