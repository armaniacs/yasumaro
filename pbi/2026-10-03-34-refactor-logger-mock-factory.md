# PBI: logger モック共通 factory への移行

## ユーザーストーリー

テストの保守者として、~160 テストファイルに手作りされている logger 3 層モックを testDir 配下の共通 factory に集約したい。モック定義がファイルごとに散在していると、logger の形状変更時に大量の重複修正が発生し、モック間の微妙な差異が flaky の発生源になるからだ。

## 優先度

- 種別: test
- 順位: 19 / 20
- RICEスコア: 2.4（Reach=8 / Impact=1 / Confidence=0.9 / Effort=3.0）
- 根拠: 効果は大きいが対象 ~160 ファイルと膨大。機械的置換のみで実施するため信頼性は高いが工数が重い。
- 依存: 特になし（ただし実行は専用 solo wave）。

## 背景

- logger 3 層（`logger/types.js` 158 ファイル、`core.js` 164 ファイル、`api.js` 172 ファイル）それぞれに対する個別 `vi.mock` ブロックが ~160 テストファイルに重複している。
- `ErrorCode` のリテラル `{INTERNAL_ERROR:'INT_001'}` が 112 箇所に重複（例: `src/popup/__tests__/tabSeamNullPin.test.ts:46-57`、`src/popup/__tests__/statusPanel-extra.test.ts:87-98`）。
- 修正方針: `testDir/mocks/logger.ts` に共通 factory を用意し、既存ファイルを同一モック意味論のまま機械的に移行する。

## 警告

- 本 PBI は ~160 ファイルに触る。並列タスクと同時実行すると競合が大量発生するため、**専用の solo wave で単独実行する**こと。
- 移行は機械的置換のみ。モックの意味論変更・アサーション変更は行わない。

## BDD受け入れシナリオ

```gherkin
Scenario: 共通 factory を使ってもモックの意味論が変わらない
  Given testDir/mocks/logger.ts に logger 3 層の factory が定義されている
  When 既存テストファイルを factory 利用に機械的に置き換える
  Then 各テストのアサーション結果が移行前と一致する
  And npm run validate が成功する

Scenario: ErrorCode リテラルの重複が factory に集約される
  Given ErrorCode {INTERNAL_ERROR:'INT_001'} が 112 箇所に重複している
  When 共通定義へ置き換える
  Then テスト内のリテラル重複が消える
  And テスト結果に変化がない
```

## 受け入れ基準

- [ ] `testDir/mocks/logger.ts` に logger types/core/api 3 層の factory が実装されている。
- [ ] 移行対象 ~160 ファイルが factory 利用に置き換わり、個別 `vi.mock` ブロックの重複が消えている。
- [ ] ErrorCode リテラル 112 箇所が共通定義へ置き換わっている。
- [ ] 全移行が同一モック意味論の機械的置換であり、意味変更を含まない。
- [ ] 移行は専用 solo wave で単独実行され、並列タスクとの競合がない。
- [ ] `npm run validate` が成功している。
- [ ] テスト件数・結果が移行前と一致している。

## テスト戦略

### 単体テスト

- 移行前後で全テストの実行結果（件数・成功/失敗）を diff し、同一であることを確認する。
- factory 自体に対して、logger 3 層の形状を pin する検証を `testDir` 内に置く。

### 統合テスト

- `npm run validate` をゲートとし、段階バッチ（例: popup → dashboard → background）ごとに検証してから次へ進む。

## 見積もり

**3.0 SP**

~160 ファイルの機械的置換。工数は置換スクリプトの整備と段階検証が中心。

## Definition of Done

- [ ] testDir/mocks/logger.ts が実装されている。
- [ ] 対象ファイルの個別 vi.mock 重複が消えている。
- [ ] ErrorCode リテラル重複が消えている。
- [ ] solo wave での単独実行が守られている。
- [ ] `npm run validate` が成功している。
- [ ] テスト件数・結果の移行前後一致を確認している。
