# PBI: restorableSettings の並列テーブル統合（refactor）

優先度: 台帳 RICE 3.0（Reach 3 / Impact 1 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918b.md](2026-09-18-00-backlog-holistic-0918b.md)（台帳、候補 C2）
依存: なし

## ユーザーストーリー

暗号化バックアップを保守する開発者として、復元可能キーの許可リストと型・範囲検査を1つの spec テーブルに統合してほしい、なぜなら現在は4つの手動並列テーブルが存在し、キー追加時に1つでも更新を忘れると型検査を素通りする抜けが構造上可能だから。

## 背景（現状と課題）

`src/utils/storage/restorableSettings.ts` に以下の並列テーブルがある（着手時に行番号を再確認すること）:

1. `RESTORABLE_KEYS`（Set、110キー）— 許可リスト
2. `KEY_TYPES`（Record）— 基本型検査
3. `CLEANSING_BOOLEAN_KEYS`（Array）— クレンジング boolean 特別検査
4. `CLEANSING_NUMERIC_KEYS`（Record of {min,max}）— 数値範囲検査

実測（作成時点）: allowlist・types・boolean・numeric の間に drift は存在しない。だが整合は手動であり、drift テストもない。`validateRestorableSettings` の検査順序は allowlist → KEY_TYPES 型検査 → CLEANSING_BOOLEAN boolean 検査 → 範囲検査。重要な挙動: **CLEANSING_NUMERIC_KEYS は型検査を持たず、範囲検査は `typeof value === 'number'` のときのみ適用される**（非数値は素通しする現行挙動を維持すること）。

対応方針: key → `{ type?, range? }` の単一 spec テーブル `RESTORABLE_KEY_SPECS` に統合し、`RESTORABLE_KEYS` を `Object.keys` から派生する。`type` 省略 = 型検査なし（数値クレンジングキーの現行挙動を保持）。検査順序・スキップ時のログ文言・`skippedKeys` 契約は不変。

## BDD受け入れシナリオ

```gherkin
Scenario: 統合後も検証結果が byte-identical である
  Given 型一致・型不一致・範囲外・範囲内・非数値の数値クレンジングキー値を含む payload
  When validateRestorableSettings を呼ぶ
  Then sanitized と skippedKeys は統合前と同一である

Scenario: 許可リストと spec テーブルの drift が構造的に不可能である
  Given RESTORABLE_KEY_SPECS から派生した RESTORABLE_KEYS
  When 網羅性テストを実行する
  Then 派生関係・API_KEY_FIELDS 非包含・クレンジングキー包含が pin される
```

## 受け入れ基準

- [x] `RESTORABLE_KEY_SPECS`（key → `{ type?, range? }`）が定義されている
- [x] `RESTORABLE_KEYS` が spec テーブルから派生している
- [x] 数値クレンジングキーの「非数値を素通しする」現行挙動が維持されている（type 省略で表現）
- [x] 検査順序・ログ文言・`skippedKeys` 契約が統合前と同一
- [x] 網羅性テスト（派生関係・API_KEY_FIELDS 非包含）が新設されている
- [x] 既存 `restorableSettings.test.ts` が無修正でパス
- [x] `npm run type-check` が green

## テスト戦略

- 既存テスト10件が無修正でパスすること = 挙動不変の parity 証明
- 新規テスト: spec テーブルと RESTORABLE_KEYS の派生整合・API key 非包含・クレンジングキー（boolean 全件・numeric 全件）の spec 存在

## 見積もり

1pt（4テーブル→1テーブル統合 + drift テスト。検証ロジックは薄い委譲に）。

## 実装ガイド

- 着手時点での確認ポイント: `restorableSettings.ts` の4テーブル定義位置、`utils/storage/apiKeyFields.ts` の API_KEY_FIELDS、既存テストの期待値
- 非数値素通しの維持は本 PBI の最重要点。統合に乗じて型検査を強化しないこと（強化するなら別 PBI で意図的変更として）
- git 操作・pbi 編集は統合側が行う
