# PBI: no-tautology-expect ルールのテスト追加

## ユーザーストーリー

ESLint カスタムルールの保守者として、`no-tautology-expect.mjs` が error で有効でありながら `eslint/__tests__/` で唯一テストを持たない状態を解消したい。既存 8 ルールと同じ `createRepeatSafeRuleTester` パターンでルールテストを追加し、ルールのロジック改善を検証可能にしたい。

## 優先度

順位: 12 / 20
RICEスコア: 6.0（Reach=3 / Impact=1 / Confidence=1.0 / Effort=0.5 SP）
根拠: error 有効ルールが無検証のまま運用されており、ルール変更時に誤検知・見逃しの両リスクがある。追加コストは最小。
依存: なし（既存ルールテストパターンを参照するだけ）。

## 背景

- `eslint/rules/no-tautology-expect.mjs` が `eslint.config:174` で error として有効
- `eslint/__tests__/` 配下で唯一テストを持たないルール（他の 8 ルールはテスト済み）
- 既存ルールテストは `createRepeatSafeRuleTester`（`eslint/__tests__/repeatSafeRuleTester.ts`）を使用 — プレーンな `new RuleTester` は `vitest --repeats` の重複ケースレジストリ問題を避けられない（`dev-docs/ADR/2026-09-26-eslint-ruletester-vitest-repeats.md`）

## BDD受け入れシナリオ

```gherkin
Scenario: 全カスタムルールがテストを持つ
  Given no-tautology-expect.mjs は eslint/__tests__/ で唯一テストのないルールである
  When ルールテストを追加する
  Then 全 9 ルールがテストを持つ
  And 有効ルールと無検証ルールの差分がなくなる

Scenario: ルールテストがリピートセーフに実行される
  Given 既存ルールテストは createRepeatSafeRuleTester を使う
  When 新ルールテストを追加する
  Then createRepeatSafeRuleTester を使用する
  And vitest --repeats で重複ケース衝突なく成功する
```

## 受け入れ基準

- [ ] `eslint/__tests__/` に no-tautology-expect のルールテストを追加する
- [ ] `createRepeatSafeRuleTester` を使用する（プレーンな `new RuleTester` を使わない）
- [ ] valid ケースと invalid ケースを両方カバーする
- [ ] tautology 判定のエッジケース（常に真になるアサーションの各パターン）を検証する
- [ ] 既存 8 ルールのテストパターンに沿った構成にする

## テスト戦略

- 既存ルールテスト（`eslint/__tests__/`）を 2〜3 件読み、構成・命名を踏襲する
- valid: tautology でない通常の expect、invalid: 常に真となる expect の代表パターン
- 実行: `npx vitest run eslint/__tests__ --repeats=20`（AGENTS.md の Definition of done に準拠）

## 見積もり

- 0.5 SP（1 ルール分のテスト追加のみ）

## DoD

- [ ] ルールテストが追加され、全 9 ルールがテスト済みになっている
- [ ] `npx vitest run eslint/__tests__ --repeats=20` が成功している
- [ ] `createRepeatSafeRuleTester` を使用している
- [ ] `npm run validate` が成功している
