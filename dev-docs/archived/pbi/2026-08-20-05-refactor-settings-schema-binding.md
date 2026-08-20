# PBI: Settings Schema Binding — 設定→DOMの隠れた契約を型安全にする

## ユーザーストーリー
開発者として、設定→DOMの契約が3ファイル（`settingsFormBinding.ts`、`settingsPipeline.ts`、`generalSettingsPanel.ts`）に分散し、`data-storage-key`属性にコンパイル時チェックがない状態を解消したい。なぜなら、`data-storage-key`のtypoがsilent failとして振る舞い、デバッグに時間を消費するからだ。

## 優先度
- 順位: 05 / 5
- RICEスコア: (Reach=5 × Impact=1 × Confidence=0.6) / Effort=3 = 1.0
- 根拠: Confidence 60%（Schema設計の曖昧さ）。#3(Panel Lifecycle)の後に着手する方が効果的（ADR-2026-07-13がPanel抽象後に`data-storage-key`規約を導入する方針）

## BDD受け入れシナリオ
Scenario: SettingsSchemaがStorageKeysとDOM要素をバインドする
  Given `SettingsSchema` が `StorageKeys` をCSSセレクタとバリデーションルールにバインドする
  When `loadSettingsToInputs()` が呼出される
  Then スキーマからDOM要素を查找し、型安全に値を設定する

Scenario: typoがコンパイル時エラーになる
  Given 開発者が `data-storage-key` の値をtypoする
  When TypeScriptコンパイラがチェックする
  Then エラーメッセージが表示され、ランタイムでsilent failしない

Scenario: バリデーションルールがスキーマに集約される
  Given `settingsPipeline.ts` が7つの要素IDをハードコードしている
  When スキーマにバリデーションルールを追加する
  Then パイプラインがスキーマからルールを読み込み、ハードコードが不要になる

## 受け入れ基準
- [ ] `SettingsSchema` が `StorageKeys` をDOM要素型とバリデーションルールにバインドする
- [ ] `loadSettingsToInputs()` と `extractSettingsFromInputs()` がスキーマをイテレートする
- [ ] `settingsPipeline.ts` の7つのハードコードされた要素IDがスキーマに移行される
- [ ] popup.html と options.html の両方が同じスキーマを使用する
- [ ] 既存の `data-storage-key` HTML規約との互換性が維持される

## テスト戦略
- E2E: Dashboard/Popupの設定変更→保存→復元の一連フロー
- 統合: `SettingsSchema` × `loadSettingsToInputs()` × `extractSettingsFromInputs()`
- 単体: スキーマの定義、バリデーションルール、コンパイル時チェック

## 見積もり
3人日

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
