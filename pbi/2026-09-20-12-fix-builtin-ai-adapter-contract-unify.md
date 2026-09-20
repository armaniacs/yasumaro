# PBI: 内蔵AIクライアントへの二重adapterを統一しAIService契約を全経路で履行する

## ユーザーストーリー
内蔵AIを使うユーザーとして、local_only モードでもカスタムプロンプトが適用され利用統計が記録されてほしい、なぜならモードによって要約の振る舞いが静かに変わるのは記録の信頼を損なうから

## 優先度
- 順位: 1 / 5
- RICEスコア: 48（Reach=15 / Impact=2 / Confidence=80% / Effort=0.5週）
- 根拠: 5候補中唯一の現在進行形の user-facing 欠陥。カタログが `supportsCustomPrompt: true` を宣言しながら local_only 経路で無言に捨てられる。修正は seam を1つに寄せるだけで小さく、影響はAI領域内に閉じる

## ビジネス価値
「設定したプロンプトが効かない」クラスの信頼低下を防ぐ。利用統計が全経路で記録され、ダッシュボードの数値が実態と一致する。ADR-015(AI Provider Abstraction)の完成

## BDD受け入れシナリオ

```gherkin
Scenario: local_only モードでカスタムプロンプトが適用される
  Given 内蔵AI が利用可能で customPrompt が設定されている
  When local_only 経路で要約を実行する
  Then 要約はカスタムプロンプトを反映した内容になる

Scenario: local_only 経路でも利用統計が記録される
  Given 内蔵AI の local_only 経路で要約が完了する
  When token 使用量が確定する
  Then usage 記録が1回だけ行われる

Scenario: リモート経路の挙動は不変
  Given リモートプロバイダ経路で要約を実行する
  When 既存のテストスイートを実行する
  Then sanitize・プロンプト適用・usage 記録の回数・順序が変わらない
```

## 受け入れ基準
- [ ] local_only 経路で AISummaryOptions 契約(customPrompt・tagSummaryMode・traceId)が履行される
- [ ] usage 記録が全経路で行われる(二重記録なし)
- [ ] sanitize の二重走査が解消され、マスクラベルが1種類に統一される
- [ ] リモート経路の既存テストが無変更で green
- [ ] catalog の `supportsCustomPrompt` 宣言が全経路の実態と一致する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(AI 要約は外部環境依存)。統合テストで代替

### 統合テスト
- privacyPipeline → FallbackAIService(local スロット) → 統一後経路で、プロンプト適用・usage 記録・sanitize 回数を検証

### 単体テスト
- 統一後 adapter の option 履行境界(未設定・空プロンプト・無効モード)

## 実装アプローチ
- **Outside-In**: 統合テスト(経路1本の契約検証)から開始
- 修正形状は実装時に design-it-twice: (a) local 経路を ProviderStrategy 経由に寄せ adapter を1つに、(b) custom-prompt + usage 手順を共有 helper に括り出し。#1の Evidence をもとに depth が高い方を選ぶ

## 見積もり
2ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし(本台帳5候補中で唯一の独立 fix)
- 遵守すべき ADR: ADR-015(AI Provider Abstraction) — この PBI は抽象化の未完成部分を埋める
- 非機能要件: リモート経路の byte レベル挙動不変。sanitize ラベル変更はログ解析・テストの期待値更新を伴う

## 実装者向け注記

### 現状の証拠
- `src/background/ai/LocalAIService.ts`(96行): `generateSummary(content, _options?)` — options を無視、customPromptUtils 未 import、usage 未記録
- `src/background/ai/providers/BuiltInAiProvider.ts`(151行): sanitizeContent + applyCustomPrompt + recordUsageIfPresent を適用
- ラベル不一致: `'built-in-ai'`(Provider) vs `'builtin-input'`(client) — `BuiltInAiProvider.ts:34-39` / `builtInAIClient.ts:200-203`
- 経路: `src/background/privacyPipeline.ts:146-156,195` → `src/background/ai/FallbackAIService.ts:22`
- カタログ宣言: `src/background/ai/providerCatalog.ts:230-231`
