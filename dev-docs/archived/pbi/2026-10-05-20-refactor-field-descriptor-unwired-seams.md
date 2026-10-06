# PBI: `fieldDescriptor` が「実装したが誰も使っていない」シームを 2 つ抱えている（`save` / `ValidationContext.providerId`）

## ユーザーストーリー

設定フォームの保守担当者として、未配線のシームを契約から外すか配線したい。型が通るのに何も起きないシームがあり、将来の実装者や provider 感知を期待した人を誤解させるから。

## 優先度

- 順位: 24/32
- RICE: 2.4（R3 / I1 / C0.8 / E1）
- 根拠: `save` は必須メンバなのに呼び出しゼロ。`providerId` は本番の全呼び出しが未供給で常に既定値
- 依存: NN07（バリデーション SSOT を 1 本化していると `save` 削除の影響範囲が確定する）

## 背景（file:line 現状）

すべて `src/dashboard/settings/fieldDescriptor.ts`:

- (a) `:37-48` の `FieldDescriptor.save` は必須メンバー、`:58` の `identitySave`、`:158, :166, :176, :185, :194, :202, :212` の**全 7 行**が `save: identitySave`。production で `.save(` の呼び出しはゼロ（`src/dashboard` 非テスト走査）。保存は `GENERAL_SETTINGS_SCHEMA`（`src/utils/settingsSchemas.ts`）が担い、ファイル冒頭 `:1-11` の「read→validate→save→error-display の SSOT」という説明が実態と違う
- (b) `validateMaxTokensValue` が `ValidationContext.providerId`（`:31-35, :127-131, :209-211`）でプロバイダ別上限（gemini 8192 等）を判定する前提だが、本番呼び出しは `src/dashboard/panels/staticForm/generalSettingsPanel.ts:119-122` と `src/dashboard/settingsPipeline.ts:111` の**いずれも providerId を渡さず**、`fieldValidation.ts:229` の既定 `''` で常にグローバル上限判定。テストだけが providerId を供給（`fieldValidation.test.ts:528-529`、`fieldDescriptor.test.ts:97-98`）→ カバレッジが未配線の分岐を緑にする状態

## BDD受け入れシナリオ

```gherkin
Scenario: 使わない save シームが契約から外れる
  Given FieldDescriptor の定義
  When save と identitySave を確認する
  Then 両者が削除され、保存の SSOT は utils/settingsSchemas だと doc コメントに明記される

Scenario: providerId が遅延解決で配線される
  Given プロバイダ選択が gemini の状態
  When maxTokens の blur / save 検証が走る
  Then 実行時に解決された providerId でプロバイダ別上限が判定される

Scenario: 既存テストが壊れない
  Given fieldValidation.test.ts:528 と fieldDescriptor.test.ts:97（直接 validate を呼ぶ）
  When 実行する
  Then ctx オブジェクトの形が維持されているため変更不要で green のままである
```

## 受け入れ基準

- [x] (a) `FieldDescriptor` から `save` が削除され（`identitySave` も削除）、保存の SSOT は utils/settingsSchemas だと doc コメントに明記されている
- [x] (b) `setupAllFieldValidations(p, port, getProviderId: () => string = () => '')` のように遅延解決で配線され、`generalSettingsPanel` から `() => aiProviderSelect?.value ?? ''` を渡している
- [x] `validateAllFields(ctx?)` の既存シグネチャと null ガード・`errorFallback` 分岐は不変
- [x] 上記 2 件の直接 validate テストは変更不要で green
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: providerId 供給時のプロバイダ別上限テスト
- 既存テストが green。実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/settings/fieldDescriptor.ts`（save / identitySave 削除）、`src/dashboard/settings/fieldValidation.ts`（`getProviderId` の遅延解決）、`src/dashboard/panels/staticForm/generalSettingsPanel.ts`（配線）、`src/dashboard/settings/__tests__/fieldDescriptor.test.ts`（shape テストの save 断定のみ削除）
- ゲート: 対象 78 tests green / type-check PASS / lint 0 errors
