# PBI: AIClient/AIServiceの二重レイヤーと型ドリフトを統合する

**作成日**: 2026-08-07
**優先度**: 高
**見積もり**: 🔴高（3pt目安）
**副作用**: 🔴あり（AI要約の中核。フォールバック動作の検証が必須）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで AI 抽象化が二重に存在することが発見された。

- **レガシー**: `AIClient`（`aiClient.ts` 431行）+ `AIProviderStrategy`/`GeminiProvider`/`OpenAIProvider`（Strategyパターン）
- **新規**: `AIService` インターフェース + `LocalAIService`/`RemoteAIService`/`FallbackAIService`

同一の `generateSummary`/`testConnection` 概念を2系統が実装しており、AIClient は「新規コードからの直接利用は避ける」とJSDoc注記済み（統一方針は ADR に記録済み）だが、**実コードの重複は残存**する。

### 重複の詳細

1. **`generateSummaryInternal()`（174-238）と `testConnection()`（283-429）のスロットループ重複**（~100行）
   - 同一のプロバイダスロットリスト走査
   - 各ループで `BUILT_IN_AI_PROVIDER_ID` を特別扱い
   - `resolveProviderSlots`/`applySlotModel`/`resolveEffectiveModel` を両者が呼ぶ
   - 同一の try/catch フォールバック形状

2. **`AISummaryResult` の型ドリフト**（~15行）
   - `AIService.ts:17` は `modelName`
   - `ProviderStrategy.ts:30-38` は `model`
   - `RemoteAIService.ts:35` が `model`→`modelName` の変換を強制

3. **debug結果型の二重定義**（~15行）
   - `AIProviderConnectionResult.debug`（ProviderStrategy.ts:12-28）
   - `ProviderTestResult.debug`（aiClient.ts:24-37）
   - 構造的に同一

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/background/aiClient.ts src/background/ai/AIService.ts src/background/ai/RemoteAIService.ts src/background/ai/FallbackAIService.ts src/background/ai/LocalAIService.ts src/background/ai/providers/ProviderStrategy.ts
grep -n "modelName\|model:" src/background/ai/AIService.ts src/background/ai/RemoteAIService.ts src/background/ai/providers/ProviderStrategy.ts
grep -rn "new AIClient\|aiClient\b" src/background --include="*.ts" | grep -v __tests__
```

## 受け入れ基準（BDD）

```gherkin
Scenario: AI要約が単一のサービス経由で呼ばれる
  Given AIClient と AIService が並存する状態
  When generateSummary を呼ぶ
  Then 同一のフォールバック順序（優先スロット→built-in→フォールバック）が一箇所で実装される

Scenario: AISummaryResult のフィールド名が統一される
  Given ProviderStrategy が 'model'、AIService が 'modelName' を使う状態
  When 型を利用する
  Then 単一のフィールド名（modelName）に統一され、変換コードが不要になる

Scenario: 既存のフォールバック動作に回帰がない
  Given 全プロバイダが利用可能/不可の各状態
  When AI要約を実行する
  Then 従来と同じプロバイダ選択とエラー処理が行われる
```

## 受け入れ基準
- [ ] `AISummaryResult` を単一型に統合し `modelName` に統一（`RemoteAIService` の変換コードを除去）
- [ ] `ProviderTestResult.debug` と `AIProviderConnectionResult.debug` を単一型に統合
- [ ] `AIClient.generateSummaryInternal`/`testConnection` のスロットループを `AIService`（`FallbackAIService` + プロバイダ）経由に委譲
- [ ] `AIClient` を薄い委譲ラッパーに縮小、または削除（統一方針の ADR に沿う）
- [ ] 全AIプロバイダ・フォールバックテストがパスする

## テスト戦略

### 単体テスト
- `FallbackAIService` のフォールバック順序（成功/全失敗/built-in含む）
- `AISummaryResult` 統合型のラウンドトリップ

### 統合テスト
- 各プロバイダが `AIService` 経由で正しくディスパッチされることを検証

### 回帰テスト
- 既存 `aiClient.test.ts`, `aiClient-timeout.test.ts`, `aiClient-priority-fallback.test.ts` がパスすることを確認

## 実装アプローチ
- まず型統合（`modelName`統一、debug型統合）→ 次にスロットループを `AIService` へ委譲 → 最後に `AIClient` をラッパー化
- 各段階で `npm run validate` を実行し回帰を防ぐ
- 設計判断が絡むため、着手前に ADR（統一方針）を再確認

## 見積もり
3pt（型統合 + レイヤー委譲 + フォールバック検証）

## 技術的考慮事項
- 依存: `src/background/aiClient.ts`, `src/background/ai/AIService.ts`, `RemoteAIService.ts`, `LocalAIService.ts`, `FallbackAIService.ts`, `providers/ProviderStrategy.ts`
- Built-in AI は `AIClient` 経由ではなく `AIService`（`LocalAIService`）経由で統合済み。レガシー `AIClient` 内の `BUILT_IN_AI_PROVIDER_ID` 特別扱いを撤去できるか確認
- `AIClient` は他モジュールから広く参照されるため、削除より委譲ラッパー化を推奨

## 関連
- コードレビューレポート: 本セッションの重複レビュー（AIレイヤー二重化）
- アーカイブ済みPBI: 2026-07-26-26-refactor-ai-client-service-unification（統一方針ADR記録のみ。実コード重複は未解消）
- 対象ファイル: `src/background/aiClient.ts`, `src/background/ai/AIService.ts`, `src/background/ai/{RemoteAIService,LocalAIService,FallbackAIService}.ts`, `src/background/ai/providers/ProviderStrategy.ts`
