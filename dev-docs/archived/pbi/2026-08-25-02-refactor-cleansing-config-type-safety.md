# PBI-02: CleansingConfig `as unknown` 3箇所の型安全化

優先度: 2位 / RICE 32.0 (Reach 4 × Impact 1 × Conf 80% / Effort 0.10w)
種別: refactor
依存: —
ファイル触接: `src/content/pageState.ts:22`, `src/content/extractor.ts:154-175`
Effort: 0.10w (S)

## 背景

`CleansingConfig`が`CleansingConfigRuleFlags` 33キー + 11固定キーのexact型のため、`for (const t of THRESHOLD_RULES) cfg[t.prop]=...`が型エラーになり3箇所で`as unknown as Record<string,boolean/number>`で回避。`THRESHOLD_RULES_FACADE`と`rules.ts`二重管理の型保証も`as`で潰されている。`THRESHOLD_RULES`の`prop`が`ThresholdProp` unionで`CleansingConfig`のkeyと一致する保証が型レベルでなく実行時detectorのみ。

## 目的

`CleansingConfig`に`Record<ThresholdProp, number>`交差を追加し`ThresholdProp`を`keyof CleansingConfig`として再定義、3箇所の`as unknown`を0にする。

## なぜなぜ分析

1. なぜ`as unknown` 3箇所か → `CleansingConfig`がexact型で`THRESHOLD_RULES`の`prop`代入が型エラーになるため
2. なぜexact型か → `CleansingConfig`が`CleansingConfigRuleFlags` 33キー + 11固定キーの手書きexactで、Threshold 7キーは`CleansingConfig`のサブセットだが型レベルで`Record`交差がなかったため
3. なぜ交差がなかったか → `THRESHOLD_RULES`の`prop`が`ThresholdProp` unionで`CleansingConfig`のkeyと一致することは自明に見え、`as`で回避すれば短期的には動いたため
4. なぜ短期的には動いたか → `Boolean(s[key])`/`Number(s[key])`でランタイムは正しく、型エラーは`as unknown`で抑えられたためテストで検出されなかったため

→ 解: `CleansingConfig`を`Record<ThresholdProp,number>`で交差させ`ThresholdProp`を`keyof`として再定義、3ループを型安全に。

## 受け入れ基準 (BDD)

### Scenario 1: 型安全な代入（ハッピーパス）

- **Given** `CleansingConfig`が`Record<ThresholdProp, number>`を含む
- **When** `for (const t of THRESHOLD_RULES) cfg[t.prop] = clamp(...)`を実行する
- **Then** `tsc --noEmit`が型エラーなく通過する
- **And** `as unknown`が0件になる

### Scenario 2: 既存テストの維持

- **Given** 既存の`extractor`/`pageState`テストが存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSする

## DoD

- [ ] `CleansingConfig`に`Record<ThresholdProp, number>`交差が追加され`ThresholdProp`が`keyof CleansingConfig`として再定義されている
- [ ] `src/content/extractor.ts:154-175`と`src/utils/storage/SettingsRepository.ts:34-84`の`as unknown` 3箇所が0件になっている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS

## 技術メモ

- `src/content/pageState.ts:22`の`CleansingConfig`定義を`extends CleansingConfigRuleFlags & Record<ThresholdProp, number>`等に変更し、`ThresholdProp`を`src/utils/aiSummaryCleaner/rules.ts:101`の`ThresholdProp` unionと一致させる。
- `grep -rn "as unknown" src/content/`で0件を確認。
