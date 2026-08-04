# PBI: モデルキー解決の一元化と built-in-ai の表示整合をとる

**作成日**: 2026-08-04
**優先度**: 中（次リリースまでに対応）
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（モデルキー導出の共通化に伴う回帰検証が必要）
**種別**: refactor（レビュー指摘: System Architect / Maintainability / Refactoring / Legacy Bridge [Medium] の残余、Domain Logic [Low]）

---

## 背景（5 Whys 分析）

Checking Team レビューのモデル解決関連指摘のうち、前回対応で解決したのは `aiClient.ts` 内の `applySlotModel` / `resolveEffectiveModel` の重複のみ。残る問題は2つ:

- `src/background/ai/providers/OpenAIProvider.ts:51-54` にモデルキー正規化が独立して残る（しかも `replace(/-/g,'_')` が欠落した別実装）
- built-in-ai の表示モデル（`slot.model`）と実際のテストモデル（`generateSummary()` 引数なし）が乖離する

### 5 Whys

- **Why 1**: なぜモデルキー正規化が3箇所に残るのか？
  → `aiClient.ts`（書き込み・表示）と `OpenAIProvider.ts`（リクエスト）が、それぞれ独立に provider→設定キーの変換を実装したため。
- **Why 2**: なぜ独立実装になったのか？
  → 書き込み（applySlotModel）、表示（resolveEffectiveModel）、リクエスト（OpenAIProvider）が異なる時期・異なる責務で追加され、共通ヘルパーが抽出されなかったため。
- **Why 3**: なぜ共通ヘルパーを作らなかったのか？
  → 変換が数行で「些細」に見え、各追加時に一元化のコストを払う判断がされなかったため。
- **Why 4**: なぜ実装が食い違うのか？
  → `aiClient.ts` は `replace('2','_2').replace(/-/g,'_')` なのに対し `OpenAIProvider.ts` は `replace('2','_2')` のみで、キー名の期待が暗黙に異なるため。新プロバイダー追加時に片方だけ更新すると黙って壊れる。
- **Why 5**: なぜ built-in-ai の表示が実テストと乖離するのか？
  → built-in-ai は実行時に availability/modelName で実モデルが決まるが、progress/result の `model` には `slot.model`（多くの場合 undefined）しか載せないため。

### 根本原因
モデルキー導出の単一ソースが存在せず、プロバイダー間で規約が暗黙に分岐している。加えて built-in-ai の「実行時解決モデル」が結果面に流れない設計のため、表示と実挙動が一致しない。

### 対処
(1) 共通のモデルキー導出ヘルパーを抽出し `aiClient.ts` と `OpenAIProvider.ts` の両方が参照する。(2) built-in-ai スロットでは、テスト結果が分かった時点で実モデル（availability/modelName 等）を `result.model` へ反映する。どちらも採用が困難なら、表示モデルが実挙動と一致しない旨をコメントで明示する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 全プロバイダーで書き込みキーと表示キーが一致する
  Given 登録済みプロバイダー（gemini / openai2 / openai-compatible / lm-studio / ollama）を列挙する
  When 共通ヘルパーでモデルキーを導出する
  Then 書き込み（applySlotModel）と表示（resolveEffectiveModel）が同じキーを参照する

Scenario: OpenAIProvider が共通ヘルパーと同じキーを参照する
  Given プロバイダー名からモデル設定を読み込む
  When OpenAIProvider がモデルキーを解決する
  Then 共通ヘルパーの結果と一致する（openai2 → openai_2_model 等）

Scenario: built-in-ai の実モデルが結果へ反映される
  Given built-in-ai のテストが実行される
  When テスト結果が得られる
  Then result.model に実行時解決された実モデルが入る（解不能なら undefined）
```

## 受け入れ基準
- [ ] モデルキー導出の共通ヘルパーが存在し、`aiClient.ts` と `OpenAIProvider.ts` が参照する
- [ ] `OpenAIProvider.ts` の正規化が共通ヘルパーに統一され、`replace(/-/g,'_')` の欠落が解消される
- [ ] built-in-ai の結果モデルが実挙動と整合する（または乖離をコメント明示）
- [ ] 既存の AI 接続テスト・進捗テストが全てパスする

## テスト戦略
- 単体: `src/background/__tests__/aiClient-priority-fallback.test.ts` に「全プロバイダーで書き込みキーと表示キーが一致する」テーブルテストを追加
- OpenAIProvider のモデルキー解決が共通ヘルパーと一致することを検証

## 実装アプローチ
- 共通ヘルパー抽出 → OpenAIProvider をヘルパー参照に置換 → built-in-ai の結果モデル反映 → テスト
- 既存挙動を壊さないよう、ヘルパーは現在の実装と同一の変換を返すこと

## Definition of Done
- [ ] モデルキー導出の一元化と built-in-ai 表示整合が実装済み
- [ ] 対応テストが追加され全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- レポート: `plans/2026-08-04-1950-review-v6.7.12-ai-test-progress.md`（System Architect / Maintainability / Refactoring / Legacy Bridge Medium、Domain Logic Low）
- 対象コード: `src/background/aiClient.ts`, `src/background/ai/providers/OpenAIProvider.ts`
