# PBI: applyI18n の data-i18n-args parse 失敗の fail-safe 化

## ユーザーストーリー

保守者として、i18n 属性の 1 つの壊れた JSON でパネル全体の翻訳と初期化が死なないようにしたい。なぜなら現在は `JSON.parse` の throw が mount 経路を貫通し、パネルが黙って無反応になるからである。

## ビジネス価値

- 1 個の不正属性でパネル全体が初期化不全になる故障モードを排除し、画面が無反応になるのを防ぐ。
- 同一ファイル内に guard 済みと未 guard の同型箇所が同居している不整合を解消する。
- popup 側との重複実装を共通 helper へ寄せ、i18n 引数解析の仕様を 1 箇所に集約する。
- 不正入力を黙って無視するのではなく構造化 logger で 1 度だけ warn することで、原因調査の可能性を残す。

## 優先度

- 種別: fix
- 順位: 4 / 17
- RICEスコア: 16.2（Reach=3 / Impact=3 / Confidence=90% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 壊れた data-i18n-args があってもパネルは初期化される
  Given パネル内に不正な JSON を持つ data-i18n-args 属性の要素がある
  When パネルの mount と applyI18n が実行される
  Then 例外は送出されず、panel.init() まで到達する
  And 不正な要素は置換なしで原文のまま残る
  And 他の正しい要素は翻訳される

Scenario: 置換なしの引数と複数形キーのフォールバックが従来どおり動く
  Given data-i18n-args がない要素と count を持たない複数形キーが存在する
  When applyI18n が実行される
  Then 引数なしの要素は key のみで解決される
  And count 欠落時のフォールバック文言が従来どおり返る

Scenario: 配列や数値や文字列の args は object として扱わない
  Given data-i18n-args に 5 や ["a"] や "text" が指定されている
  When applyI18n が実行される
  Then 値は null として扱われ、TypeError が発生しない

Scenario: 同じ不正値が複数要素に存在しても warn は 1 度だけ出る
  Given 不正な data-i18n-args を持つ要素が 2 つある
  When applyI18n が実行される
  Then 構造化 logger への warn が 1 回だけ記録される
```

## 受け入れ基準

- [ ] `parseI18nArgs` として、i18n 引数の解析が object 以外（null・配列・数値・文字列）で null を返す単一の helper に抽出されている。
- [ ] helper は try でガードしており、throw を外へ漏らさない。
- [ ] `src/utils/i18n-dom.ts:110` と `entrypoints/popup/i18n.ts:125` の非ガード `JSON.parse` が helper 経由に置き換わっている。
- [ ] 不正 args 検出時に、既存の構造化 logger で warn が 1 度だけ記録される。
- [ ] `resolvePluralKey`（`src/utils/i18n-dom.ts:18-19`）の `'count' in args` が非 object 値で TypeError を出さない。
- [ ] 複数形キーで `count` が欠落したときのフォールバック文言が現行挙動から変わらない。
- [ ] 更新対象テスト `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` の `expect(() => applyI18n()).toThrow()` が `not.toThrow()` へ更新され、`data-i18n-args="5"` のケースが追加されている。
- [ ] `npm run validate` が成功し、既存の翻訳・i18n 挙動に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「1 つの要素の置換引数が壊れていても、そのパネルが表示され操作できる」という観測点を確認する。
- 正しい要素が引き続き翻訳されることを確認し、新しいユーザー機能は追加しない。

### 統合テスト

- `src/dashboard/panels/NavigationRegistry.ts:93` の `await panel.mount(container)` 経由で不正 args が伝わっても mount 全体が成立することを検証する。
- `src/dashboard/recordingConditionsSettings.ts:34`、`src/dashboard/aiProviderCatalogView.ts:87`、`src/dashboard/models-dev-dialog.ts:190`、`src/privacy/privacy.ts:202`、`src/utils/ui/onboardingWizard.ts:105` の各呼び出し元が非ガードであることを前提に、helper 適用後に throw が出ないことを検証する。
- `entrypoints/popup/i18n.ts:121-127` 側の同型箇所が同じ helper を使うことを確認する。

### 単体テスト

- `parseI18nArgs` に有効な object、不正な JSON、数値、文字列、null、配列、属性なしを渡して、object 以外が null を返すことを検証する。
- `resolvePluralKey` が非 object の args で TypeError を出さないことを検証する。
- 更新対象テスト `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` の throw 期待を `not.toThrow` へ書き換える。
- 複数形キーで `count` 欠落時のフォールバック文言が変わっていないことを検証する。

## 実装アプローチ

- **Outside-In**: まず「不正な data-i18n-args 1 個でパネルが初期化不全になる」という外部観測点を failing として書き、Green にする形で helper 抽出へ進む。
- **Red-Green-Refactor**: `expect(() => applyI18n()).toThrow()` の現状を Red として確認し、helper 適用で Green にする。最後に warn を 一度だけにするやめに整える。
- **helper 単一化**: `parseI18nArgs` を i18n 系 util に置き、`src/utils/i18n-dom.ts` と `entrypoints/popup/i18n.ts` の 2 箇所で共有する。
- **fail-safe の明示**: throw を握りつぶすのではなく、不正 args を null（無置換）へ落とし、構造化 logger で 1 度だけ warn する。fail-closed ではなく fail-safe を選ぶ。
- **型安全性**: `JSON.parse` の戻り値を `any` として扱わず、`Record<string, unknown> | null` として narrow してから `resolvePluralKey` へ渡す。

## 見積もり

**0.5 SP**

`parseI18nArgs` の抽出、2 箇所の置換、テストの更新が主体である。i18n メッセージの追加や翻訳データの変更は不要。

## 技術的考慮事項

- `src/utils/i18n-dom.ts:110` は `const args = substitutions ? JSON.parse(substitutions) : null;` であり try でガードされていない。
- 同一ファイルの `src/utils/i18n-dom.ts:84` は同型の `JSON.parse` を try でガード済みであり、同一ファイル内に不整合がある。
- `JSON.parse` の戻り値は any である。`resolvePluralKey`（`src/utils/i18n-dom.ts:18-19`）が `'count' in args` を行うため、`data-i18n-args="5"` のような非 object 値で TypeError になる。
- throw は `src/utils/i18n-dom.ts:123-125` の `translateOptions` / `translateButtonLabels` / `translateHelpText` より前に飛ぶため、全 pass が死ぬ。
- 呼び出し元は非ガードである: `src/dashboard/recordingConditionsSettings.ts:34`、`src/dashboard/aiProviderCatalogView.ts:87`、`src/dashboard/models-dev-dialog.ts:190`、`src/privacy/privacy.ts:202`、`src/utils/ui/onboardingWizard.ts:105`。
- mount 経路は `src/dashboard/panels/NavigationRegistry.ts:93` の `await panel.mount(container)` であり非ガードである。
- `src/dashboard/panels/registryContext.ts:32-38` の `tryNavigate` は throw を握むため、パネルは `.active`（`:84`）になるが `panel.init()`（`:108`）が走らず、ログも出ない。
- 更新対象テストは `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` の `expect(() => applyI18n()).toThrow()` である。
- 同型の重複は `entrypoints/popup/i18n.ts:121-127` にもある。`getMessage(key, args)` を直呼びしており、同じ helper を適用する。
- `src/utils/i18n-dom.ts:90` は `resolvePluralKey` を使うが、`entrypoints/popup/i18n.ts:126` は `getMessage(key, args)` を直呼びで `resolvePluralKey` を使わない。helper の引数形に注意する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/i18n-dom.ts:80-88` は `[data-i18n]` 要素のループで、`substitutions` を `getAttribute('data-i18n-args')` から取り、`try { JSON.parse } catch` でガードしている。ここが helper 化のモデルになる。
- `src/utils/i18n-dom.ts:104-113` は `[data-i18n-input-placeholder]` のパスで、`:110` に非ガードの `JSON.parse` がある。ここが主な修正対象。
- `src/utils/i18n-dom.ts:18-19` の `resolvePluralKey` は `args` に `'count'` キーが含まれるかを調べる。`args` が `any` のため、非 object で `in` 演算子が TypeError を投げる。
- `entrypoints/popup/i18n.ts:119-128` は同じ `[data-i18n-input-placeholder]` のパスで、`:125` に非ガードの `JSON.parse` がある。`:126` は `getMessage(key, args)` を直接呼ぶ。
- `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` は不正 JSON で `applyI18n` が throw することを期待する現状挙動を pin している。
- `src/dashboard/panels/NavigationRegistry.ts:93` は `await panel.mount(container)` をそのまま呼ぶ。`src/dashboard/panels/registryContext.ts:32-38` の `tryNavigate` が例外を握るため、panel 側のログが出ない。

### 実装手順

1. 更新対象テスト `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` の `toThrow()` を暫定的にそのままにして、不正 args でパネルが初期化不全になる Red を確認する。
2. `parseI18nArgs` を `src/utils/i18n-dom.ts`（またはその隣の i18n util）に抽出する。属性値が空なら null、JSON.parse が失敗したら null、配列なら null、object 以外なら null を返す。
3. `src/utils/i18n-dom.ts:110` を helper 経由へ置き換える。
4. `src/utils/i18n-dom.ts:80-88` のガード済みコードも helper へ寄せ、重複を無くす。
5. `entrypoints/popup/i18n.ts:125` を同じ helper へ置き換える。`:126` の `getMessage(key, args)` 直呼びの引数形を確認する。
6. `resolvePluralKey` へ渡す `args` が `Record<string, unknown> | null` であることを型で保証し、`'count' in args` が安全であることを確認する。
7. 不正 args を検出した場合に、既存の構造化 logger で warn を 1 度だけ記録する。同一 pass で複数の不正要素があっても warn は 1 度にする。
8. `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` を `not.toThrow()` へ更新し、`data-i18n-args="5"` のケースと配列・文字列のケースを追加する。
9. 複数形キーで `count` 欠落時のフォールバック文言が変わっていないことを確認する。
10. `npm run validate` を実行する。

### 落とし穴

- fail-closed（不正 JSON で applyI18n 全体を中断）ではなく fail-safe（その要素だけ無置換）を選ぶ。画面全体が黙って無反応になることは本 PBI が防ぐ対象そのものである。
- `parseI18nArgs` が配列を object と判定すると、`'count' in args` は通るが `args` の型が壊れる。配列は明示的に null へ落とす。
- warn を要素ごとに出すと、1 画面内の不正要素数だけログが増える。1 pass に 1 度だけにする。
- 複数形キーで `count` が欠落したときに `getMessage` が返すフォールバック文言は現行の仕様である。helper 化で文言を変えない。
- popup 側は `resolvePluralKey` を使わないため、helper から `resolvePluralKey` 済みの key を返す設計にすると popup 側で二重解決になる。helper は args の解析だけを返す。
- `src/dashboard/panels/registryContext.ts:32-38` の `tryNavigate` が throw を握むため、`NavigationRegistry.ts:93` 側だけを直しても他の panel mount 経路が残る。helper 側で throw を出さないことが根本対策である。

## 決定事項

1. 1 個の不正 JSON でパネル全体が初期化不全になる理由は、`src/utils/i18n-dom.ts:110` の `JSON.parse` が try でガードされておらず、例外が `translateOptions` 以降の pass へ到達しないためである。
2. 同一ファイルにガード済みの同型コードが存在する理由は、`:84` の `[data-i18n]` パスだけ個別に try を足され、`:110` の `[data-i18n-input-placeholder]` パスは共有化されなかったためである。
3. パネルが無反応という最悪の障害になる理由は、`src/dashboard/panels/registryContext.ts:32-38` の `tryNavigate` が throw を握って握み、ログも出さないためである。
4. 今是正する必要が立っている理由は、HTML 属性というユーザーが編集可能な入力に対して fail-closed 型の障害になっているためである。
5. `parseI18nArgs` を単一 helper として抽出し、`src/utils/i18n-dom.ts` と `entrypoints/popup/i18n.ts` の 2 箇所で共有する。
6. helper の戻り値は `Record<string, unknown> | null` とし、object 以外（null・配列・数値・文字列）と parse 失敗はすべて null に落とす。
7. fail-closed ではなく fail-safe を選ぶ。不正 args はその要素だけ無置換とし、構造化 logger で 1 pass に 1 度だけ warn する。
8. 複数形キーの `count` 欠落時に `getMessage` が返すフォールバック文言は現行仕様として維持する。
9. 更新対象テスト `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` は throw 期待から `not.toThrow` 期待へ変更し、`data-i18n-args="5"` のケースを追加する。
10. `resolvePluralKey`（`src/utils/i18n-dom.ts:18-19`）の `'count' in args` は非 object 値で TypeError を投げないことを型で保証する。

## Definition of Done

- [ ] `parseI18nArgs` が object 以外と parse 失敗に対して null を返す helper として実装されている。
- [ ] `src/utils/i18n-dom.ts:110` と `entrypoints/popup/i18n.ts:125` が helper 経由に置き換わっている。
- [ ] `src/utils/i18n-dom.ts:80-88` のガード済みコードも helper へ寄せ、重複が解消されている。
- [ ] `resolvePluralKey` へ非 object が渡らず、TypeError が発生しないことをテストしている。
- [ ] 不正 args 検出時に構造化 logger へ warn が 1 pass に 1 度だけ記録されることをテストしている。
- [ ] 更新対象テスト `src/utils/__tests__/i18n-dom-branch.test.ts:274-281` が `not.toThrow()` へ更新され、`data-i18n-args="5"` のケースが追加されている。
- [ ] 複数形キーの `count` 欠落時のフォールバック文言が変わっていない。
- [ ] 正しい要素の翻訳、panel.init() の到達、パネルの `.active` 化に回帰がない。
- [ ] `npm run validate` が成功している。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
