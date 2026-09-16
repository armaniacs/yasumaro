# PBI: built-in AI の二重アダプタ構造の裁定（investigate）

優先度: 順位 7 / 10（RICE: 2.4 = Reach 3 / Impact 1 / Confidence 0.8 / Effort 1 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし

## ユーザーストーリー
拡張機能のアーキテクチャを保守する開発者として、built-in AI への2つの到達経路（privacy mode の local 側と provider スロットの1つ）が歴史的経緯なのか意図的な設計なのかを裁定してほしい、なぜなら二重表現のままでは ADR-015（Strategy-only 方針）との整合性が不明瞭で、将来の統合・削除判断のたびに調査コストが発生するから。

---

## 背景（現状と課題）

同一の `BuiltInAIClient`（`src/background/builtInAIClient.ts` 付近。Chrome Gemini Nano / Edge Phi-mini の Prompt API を Service Worker から直接呼ぶクライアント）に、2つのアダプタが存在する。

1. `LocalAIService`（`src/background/ai/` 付近。`AIService` インターフェース実装）。`aiServiceFactory.ts` の `createAIService` 付近で `FallbackAIService` の local 側として組み立てられる（`new LocalAIService({ localAiClient: builtInAiClient })`）。`privacyPipeline.ts` の `_performLocalSummarization` 付近が mode `local_only` で `aiService.generateSummary` を実呼び出しする。このため現状では削除不可の実呼び出し経路である。
2. `BuiltInAiProvider`（`src/background/ai/providers/` 付近。`AIProviderStrategy` 実装）。ファイル冒頭に ADR-015 の Strategy-only 方針に従う旨が明記され、内部で `BuiltInAIClient` に委譲する。`providerCatalog.ts` の `built-in-ai` エントリ経由（provider 優先順位リスト）で到達する。

つまり built-in AI には「privacy mode の local として」と「provider スロットの1つとして」の2つの入口がある。未整理な点は以下である。

- ADR-015（`dev-docs/ADR/2026-04-21-ai-provider-abstraction.md`、Strategy パターンによる provider 抽象化）と `LocalAIService` 経路の関係が明文化されていない。
- `AISummaryMode`（`src/background/ai/AIService.ts` 付近で定義される `full_pipeline` / `local_only` / `masked_cloud` / `auto`）と PRIVACY_MODE タクソノミー（`privacyPipeline.ts` の `_buildSanitizedSettings` 付近で `useLocalAi` / `useMasking` / `useCloudAi` に分解される mode 判定）の関係が明文化されていない。
- 2026-07-27 の AIClient・AIService 統一方針 ADR（`dev-docs/ADR/2026-07-27-ai-client-service-unification.md`）は `AIClient` と `AIService` の二重抽象化を扱ったもので、今回の built-in AI 二重アダプタ（`LocalAIService` と `BuiltInAiProvider`）はその後の残存論点である。

## BDD受け入れシナリオ
```gherkin
Scenario: 二重表現の裁定が ADR に記録される
  Given 調査が完了している
  When  ADR（新規追加または既存 ADR の更新）を書く
  Then  二重表現の現状・裁定（統合する／しない）・再検討トリガーが記録されている

Scenario: local_only モードの依存を壊さない評価が記録される
  Given local_only モードが LocalAIService 経由の実呼び出しに依存している
  When  統合案（例: local_only モードを built-in-ai スロットの別名に解決する案）を評価する
  Then  privacyPipeline の mode 判定ロジック（_buildSanitizedSettings 付近の useLocalAi/useMasking/useCloudAi の組み立て）と _performLocalSummarization 付近の経路への影響が ADR に明記されている
```

## 受け入れ基準
- [ ] 二重表現が歴史的経緯（AIClient から AIService への移行の名残）なのか意図的な設計なのかが ADR に記録されている
- [ ] 統合する／しないの裁定と、統合する場合の寄せ先（例: local_only を built-in-ai スロットの別名に解決する案の採否）が ADR に記録されている
- [ ] 統合しない場合の維持条件と「統合を再検討するトリガー」が ADR に記録されている
- [ ] privacyPipeline の mode 判定ロジックが二重表現に依存していないか（依存している場合はどこが）の評価が ADR に記録されている
- [ ] LocalAIService を削除できない理由（privacy mode `local_only` の実呼び出し経路）が ADR に明記されている
- [ ] 実装コードの変更は本 PBI のスコープ外であり、変更が必要な場合は後続 PBI として切り出されている

## 調査手順
1. `aiServiceFactory.ts` の `createAIService` 付近を読み、現在の組み立て（`LocalAIService` + `RemoteAIService` + `FallbackAIService`）を確認する。
2. `FallbackAIService.ts` の `generateSummary` 付近を読み、`local_only` / `full_pipeline` / `masked_cloud` / `auto` の分岐を確認する。
3. `LocalAIService.ts` の `generateSummary`・`getSupportedModes` 付近を読み、`local_only` 専任であることと報告 provider 名を確認する。
4. `BuiltInAiProvider.ts` の `generateSummary` 付近を読み、`BuiltInAIClient` への委譲内容（sanitize・利用記録など）と Strategy 方針の記述を確認する。
5. `providerCatalog.ts` の `built-in-ai` エントリ付近を読み、provider スロットとしての到達条件（優先順位リスト・設定ブロック種別）を確認する。
6. `privacyPipeline.ts` の `_buildSanitizedSettings`・`_performLocalSummarization` 付近を読み、mode から `useLocalAi` / `useMasking` / `useCloudAi` を組み立てるロジックと `local_only` 実呼び出しを確認する。
7. `dev-docs/ADR/` 配下の ADR-015（`2026-04-21-ai-provider-abstraction.md`）と 2026-07-27 関連 ADR（`2026-07-27-ai-client-service-unification.md`）を読み、本件との整合性を評価する。
8. 裁定（統合する／しない・寄せ先・維持条件・再検討トリガー）を `dev-docs/ADR/` への ADR 追加（または既存 ADR の更新）として記録する。コード変更は行わない。

## 見積もり
1 pt（調査のみ。0.5〜1 日想定。コード変更はスコープ外）。

## リスク
- 誤って `LocalAIService` を削除すると privacy mode `local_only` が壊れる（`privacyPipeline.ts` の `_performLocalSummarization` 付近からの実呼び出し経路がある）。調査はこの依存を明確化したうえで裁定を書くこと。

## Definition of Done
- [ ] 調査結果が ADR として記録される
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
