# PBI: archive 表の backendArgs/depsArgs 同一ラムダを集約する

## ユーザーストーリー

wire 表の保守担当者として、引数組立の複製をなくしたい。10 行以上が字句同一で、引数順変更時に片側だけ壊しうるから。

## 優先度

- 順位: 10/23
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: 14 行中 11 行の片側削除＋フォールバック 1 行。wire 形状不変
- 依存: なし（NN19 の先行として差分を小さくする）

## 背景（file:line 現状）

- `src/messaging/archiveWireTable.ts:219-220` / `:385-386` / `:417-418`（3 要素タプル複製）
- `:268-269` / `:293-294` / `:322-323` / `:351-352` / `:437-438` / `:457-458`（stagingName 単要素複製）
- `:185-186` / `:243-244` / `:474-475`（`() => []` 複製）
- 差分（両方保持）: `:126-127`（includeDeleted 正規化）、`:160-166`（archiveCreate 再構成）、`:246`（projectDeps 例外）

## BDD受け入れシナリオ

```gherkin
Scenario: 同一行の depsArgs が省略できる
  Given backendArgs と同一の depsArgs を持つ行
  When depsArgs を省略する
  Then `depsArgs ?? backendArgs` で解決され、振る舞いが同一である

Scenario: 差分行が両方保持される
  Given preview / create / prepareIncoming の行
  When 整理する
  Then 両方が保持され、正規化・再構成・例外が動作する
```

## 受け入れ基準

- [x] 同一の行の `depsArgs` が省略可能になりフォールバックで解決されている（`archiveHandler.ts:40-42` と同形）
- [x] 差分 3 行が両方保持されている
- [x] wire 形状・振る舞い不変
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 wire 表テストが green。フォールバック解決のテストがあれば維持
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/messaging/archiveWireTable.ts`（depsArgs 任意化＋フォールバック解決。同一 11 行を削除）
- 統合修正: `archiveHandler.ts:40` が optional 化で型エラーになったため、`descriptor.depsArgs ?? descriptor.backendArgs` のフォールバックを handler 側にも追加（PBI の規律どおり）
- ゲート: 対象 7 tests green / type-check PASS / lint 0 errors
