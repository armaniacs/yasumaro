# PBI: sensitiveDataMask の再帰マスキングに循環検出と null-proto アキュムレータが無い

## ユーザーストーリー

ログ・エラー整形の保守担当者として、再帰マスキングの防御を `logger/sanitize` と同等にしたい。同一関心の実装 2 本のうちログ経路だけが防御済みという非対称があり、循環グラフで膨張し得るうえ `__proto__` キーで prototype が触れられるから。

## 優先度

- 順位: 10/32
- RICE: 6.0（R3 / I2 / C1.0 / E1）
- 根拠: 防御の非対称を実測で確認。循環膨張と `__proto__` 設定の 2 点
- 依存: なし

## 背景（file:line 現状）

- `src/utils/sensitiveDataMask.ts` の `maskSensitiveData`（:149-176）: `:153` の深度 100 打ち切りのみ、`:162-173` に visited WeakSet なし、`:166` が `const result: Record<string, unknown> = {}`（素のオブジェクト）
- 対照 `src/utils/logger/sanitize.ts:36-46`: WeakSet による循環検出、`:40-42` の深度マーカー、`:65` の `Object.create(null)`（同ファイルコメントが VULN-003「`__proto__` キーの代入で prototype が再設定される問題」への対策と明記）
- 影響: (a) 同一オブジェクトを複数のキーが指す循環グラフでは走査が分岐数^深度 で膨張し得る (b) `result[key] = ...` は plain object への代入なので `__proto__` キーが来たとき `sanitize.ts:60-65` が指摘するのと同条件で prototype が触れられる
- 呼び出し: `src/utils/errorClassification.ts:297-308`、`src/utils/obsidianConfigBuilder.ts:83-85`、`src/utils/redaction.ts:20-22`

## BDD受け入れシナリオ

```gherkin
Scenario: 循環オブジェクトが安全に処理される
  Given 自分自身を指す循環オブジェクト
  When maskSensitiveData に渡す
  Then 発散せず、既存の深度時と同じマスク文字列で打ち切られる

Scenario: __proto__ キーが prototype を書き換えない
  Given __proto__ キーを含むオブジェクト
  When maskSensitiveData に渡す
  Then 返却値の prototype は書き換わらず、キーは own-property として保持される

Scenario: 既存呼び出しの挙動が変わらない
  Given errorClassification / obsidianConfigBuilder / redaction の既存入力
  When マスキングする
  Then 公開シグネチャ・戻り型・'full' / 'partial' の分岐結果が従来と同一である
```

## 受け入れ基準

- [x] `maskSensitiveData` の内部に `visited: WeakSet<object>` が導入され、循環時に既存の深度時と同じマスク文字列を返す
- [x] アキュムレータが `Object.create(null)` になり、`sanitize.ts` と同じ機構に揃っている
- [x] 公開シグネチャ（`data, strategy, depth`）・戻り型・`'full'` / `'partial'` 分岐は維持され、既存呼び出しと `logMasker` / `redaction` シムは無変更
- [x] 循環オブジェクトと `__proto__` キーの 2 ケースのテストが追加されている
- [x] 外部挙動不変（循環時を除く既存入力の出力が byte 同一）
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 循環オブジェクト（自己参照・相互参照）の打ち切りテスト
- 単体: `__proto__` キーの prototype 非書き換えテスト
- 既存テストが green。実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/utils/sensitiveDataMask.ts`（第 4 引数 `visited` + null-proto アキュムレータ）、新規 `src/utils/__tests__/sensitiveDataMask.test.ts`（循環・`__proto__` の 2 ケース）
- ゲート: 対象 2 tests green / type-check PASS / lint 0 errors
