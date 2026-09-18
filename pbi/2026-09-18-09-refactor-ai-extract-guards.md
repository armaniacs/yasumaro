# PBI: AI extract guard/debug の基底集約（refactor）

優先度: 台帳 RICE 4.0（Reach 5 / Impact 1 / Confidence 0.8 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918.md](2026-09-18-00-backlog-holistic-0918.md)（台帳、候補 C4）
依存: なし（PBI 05 とはファイル非重複）

## ユーザーストーリー

AI プロバイダを追加する開発者として、応答抽出の schema guard と test 応答の debug 組み立てを基底に集約してほしい、なぜなら現在は provider ごとに複写されており、新規追加のたびに同じ3段階検査と debug object を書く必要があるから。

## 背景（現状と課題）

testConnection テンプレ統合（PBI 2026-09-17-10）の残りとして extract 側の双子が残っている（着手時に行番号を再確認すること）：

1. `_extractSummary` の3段階 schema guard — `GeminiProvider.ts`（297-309行目付近）と `OpenAIProvider.ts`（221-237行目付近）で同一構造 + 同一ユーザ文言（`Error: Invalid API response format - unexpected schema.`）
2. test `extractResponse` の debug 組み立て — Gemini（229-245行目付近）と OpenAI（205-216行目付近）で `pickDefined` による同一パターン（modelName/statusCode/hasContent/response + usage tokens + 空時 error）
3. buildRequest 内の同一コメント — Gemini（158-159行目付近）と OpenAI（180-181行目付近）の「モデル一覧ではなく実際に推論を走らせる」旨

対応方針: 基底 `src/background/ai/providers/ProviderStrategy.ts` に `failInvalidSchema(reason, traceId)` と `buildTestDebugBase(ctx, extras)` を新設し、両 provider から委譲する。フロー順序・token 記録・ユーザ文言・debug shape は不変。flow テンプレ自体には触れない。

## BDD受け入れシナリオ

```gherkin
Scenario: 不正 schema が両 provider で同一に拒否される
  Given candidates/choices を欠く Gemini/OpenAI 応答
  When 各 _extractSummary を呼ぶ
  Then 両方とも統合前と同一のユーザ文言・error で失敗する

Scenario: test 応答の debug が同一 shape を保つ
  Given 空応答の Gemini/OpenAI テスト結果
  When 各 extractResponse を呼ぶ
  Then debug の field 集合は統合前と同一である
```

## 受け入れ基準

- [x] 基底に2 helper が定義されている
- [x] 両 provider が委譲し、直書きの guard/debug 組み立てが残っていない
- [x] ユーザ文言・debug shape が統合前と byte-identical（parity test で pin）
- [x] token 記録（recordUsageIfPresent）の呼び出し条件に変更がない
- [x] `npm run type-check` が green
- [x] AI provider 配下の関連 vitest が green

## テスト戦略

- parity テスト（新規）: 不正 schema 3枝・空応答 debug の shape を pin してから集約する
- 既存テストの維持: `httpSummaryFlow.test.ts`・`httpTestFlow.test.ts`・`BuiltInAiProvider.test.ts` 等が無修正でパスすること

## 見積もり

1pt（基底2 helper + 2 provider 委譲 + parity test。設計判断残のため Confidence 0.8）。

## 実装ガイド

- 着手時点での確認ポイント: `ProviderStrategy.ts` の既存 helper 配置、`GeminiProvider.ts:220-340`、`OpenAIProvider.ts:197-245`
- flow 順序（資格→pre-flight→切り詰め→サニタイズ→プロンプト→fetch→timeout変換）に手を入れないこと
- フルテストスイートは統合側が行う。担当検証は type-check + AI provider 関連 vitest に絞る
