# PBI: catalog 主導のプロバイダ UI に残る gemini 特例分岐を catalog フィールド化する

## ユーザーストーリー
開発者として、catalog 主導のプロバイダ UI に残る gemini 特例分岐を catalog フィールドで表現したい、なぜなら特例 provider を追加するたび if (gemini) 型の分岐が複製され、catalog に1行足すだけという設計意図が崩れるから

## 優先度
- 順位: 13 / 13
- RICEスコア: 4.0（Reach=2 / Impact=1 / Confidence=100% / Effort=0.5週）
- 種別: refactor
- 根拠: 現行描画は正常に動作しているため Impact は 1 に留まるが、分岐が4箇所に分散したままでは次回の特例 provider 追加時に複製コストが発生する。catalog 完成直後の小粒整理として順位13で処理する

## ビジネス価値
新規 provider 追加コストが「catalog 1行 + i18n キー」に戻り、UI 分岐の読み替えコストが消える。既存 provider の描画・a11y 挙動はデフォルト値で維持されるため、利用者への影響なく拡張性が回復する(locality)

## BDD受け入れシナリオ

```gherkin
Scenario: gemini 以外の provider でも catalog フィールドで css クラスが決まる
  Given catalog エントリに cssClass 相当のフィールドがある
  When gemini 以外の provider の設定ブロックを描画する
  Then container に openai-settings 相当のクラスが付与され、gemini には付与されない

Scenario: apiKey ラベルが catalog フィールドで切り替わる
  Given gemini エントリが geminiApiKey を指定し、他 provider が aiApiKey を指定している
  When 各 provider の設定ブロックを描画する
  Then gemini のみ geminiApiKey ラベルで描画され、他は aiApiKey ラベルで描画される

Scenario: 新規 provider 追加で条件分岐を足さない
  Given catalog に特例的な表示要件を持つ新規 provider エントリを追加する
  When UI を描画する
  Then view 側に providerId 判定の if 分岐を追加せず、catalog フィールドの値だけで描画が変わる
```

## 受け入れ基準
- [ ] `renderProviderSettings` の `providerId !== 'gemini'` による css クラス分岐が catalog フィールド駆動になる
- [ ] apiKey ラベルの `geminiApiKey` / `aiApiKey` 切替が catalog フィールド駆動になる
- [ ] `gemini_api_version` の aria/note/error 特別ブロックが extra-field の a11y meta 駆動になる
- [ ] B レイアウトの `details.open` 初期値が catalog の defaultOpen 相当フィールド駆動になる
- [ ] 既存 provider の描画・a11y 属性・初期開閉状態が変更前と同一である
- [ ] 新規 provider 追加時に view 側の if 分岐追加が不要であることがテストで示される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善。options ページの手動確認のみ)

### 統合テスト
- DOM 描画 pin テスト: 現行の container id・css クラス・label i18n キー・aria 属性・note/error ノード・details 開閉状態を描画結果で固定する
- catalog 駆動テスト: フィールド値を変えた fixture エントリで css クラス・ラベル・defaultOpen が変わることを確認する

### 単体テスト
- 追加フィールドのデフォルト値解決(未指定時に現行挙動と一致すること)
- storageKey から inputId への変換が既存 mapping と一致すること

## 実装アプローチ
- **Outside-In**: まず現行描画の DOM pin テストを書き、Green で既存挙動を固定する
- 次に catalog エントリへフィールド追加(例: apiKeyLabelI18nKey / cssClass / defaultOpen / extra-field の a11y meta)し、4分岐を1件ずつフィールド参照に置換する(Red → Green の小刻み反復)
- 既存 provider の catalog 値は現行描画と同一になるデフォルトで埋め、差分が出たら pin テストで検出する

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 2026-09-21-13 と `providerCatalog.ts` が同一対象のため、実行順は 13 の後。他 PBI とは独立
- 遵守すべき方針: catalog が唯一の所有者(view 側に providerId 判定を残さない)。a11y 属性の意味論を潰さない
- 非機能要件: 描画結果の DOM 等価(id・クラス・aria・note/error・初期開閉)。既存 binding(settingsFormBinding・fieldValidation・preset/models-dev handler)を壊さない

## 実装者向け注記

### 現状の証拠
- css クラス特例: `src/dashboard/aiProviderCatalogView.ts:73` — `if (providerId !== 'gemini') container.classList.add('openai-settings')`
- apiKey ラベル特例: `src/dashboard/aiProviderCatalogView.ts:143` — `providerId === 'gemini' ? 'geminiApiKey' : 'aiApiKey'`
- extra-field 特例: `src/dashboard/aiProviderCatalogView.ts:163-175` — `field.storageKey === 'gemini_api_version'` の aria/note/error 特別ブロック(`aria-invalid`・`aria-describedby`・`geminiApiVersionNote`・`geminiApiVersionError`・`role=alert`)
- 初期開閉特例: `src/dashboard/aiProviderB/providerAccordionView.ts:34` — `if (id === 'gemini') details.open = true`
- 設計意図との矛盾: `src/dashboard/aiProviderCatalogView.ts:7` — `Adding a provider = one PROVIDER_REGISTRY row + i18n keys` とあるが、上記4分岐が残るため現状は catalog 1行追加だけでは同種の特例を再現できない
- catalog 本体: `src/background/ai/providerCatalog.ts` — `ProviderCatalogEntry` に追加すべきフィールドの置き場所。B レイアウトは `src/dashboard/aiProviderB/providerAccordionView.ts:19-35` の accordion 生成部が対象

## Definition of Done
- [ ] 全BDDシナリオ実装+パス
- [ ] コードレビュー完了
- [ ] 統合検証 green
