# PBI: AI プロバイダー API レスポンススキーマ検証

元指摘: Checking Team (High: API & Contract Negotiator)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、OpenAI / Gemini 互換プロバイダーからのレスポンスを `_extractSummary` で無条件に読み取るのではなく、スキーマ検証を追加したい。なぜなら、プロバイダーがレスポンス形式を変更すると `data.choices[0].message.content` や `candidates[0].content.parts[0].text` が undefined になり、ユーザーには "No summary generated." がサイレントに返却され、設定ミスと誤解されるから。

## ビジネス価値

- API 契約逸脱時の早期検知
- フォールバックプロバイダーへの切り替え機会を確保
- デバッグ時の原因特定を容易に

## 前提・制約

- `OpenAIProvider._extractSummary` (`OpenAIProvider.ts:274`) と `GeminiProvider._extractSummary` (`GeminiProvider.ts:204`) が対象
- 既存の `AISummaryResult` 型は `{ success: boolean; summary?: string; ... }` の形式
- `ProviderStrategy` でフォールバックチェーンが実装済み

## BDD受け入れシナリオ

```gherkin
Feature: AI provider response schema validation

  Scenario: OpenAI-compatible response with missing content is rejected
    Given provider returns { choices: [{ message: { role: "assistant" } }] }
    When `_extractSummary` is called
    Then it returns `{ success: false, error: "..." }`
    And logs schema mismatch

  Scenario: Gemini response with empty candidates is rejected
    Given provider returns { candidates: [] }
    When `_extractSummary` is called
    Then it returns `{ success: false }`
    And triggers fallback provider

  Scenario: Valid response passes through unchanged
    Given provider returns a normal response with content/text
    When `_extractSummary` is called
    Then it returns `{ success: true, summary: ... }`
```

## 受け入れ基準

- [ ] `OpenAIProvider._extractSummary` で `data.choices[0].message.content` の存在・型（string）を検証
- [ ] `GeminiProvider._extractSummary` で `data.candidates[0].content.parts[0].text` の存在・型を検証
- [ ] スキーマ不整合時は `{ success: false, summary?: undefined, error?: string }` を返し、エラーコード/メッセージをログ出力
- [ ] 不整合検出時に呼び出し側で次のプロバイダーへのフォールバックが発生することを確認（テストで担保）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `OpenAIProvider.test.ts` / `GeminiProvider.test.ts` に不正レスポンス（空 candidates、content が配列、undefined 等）のケースを追加
- スキーマ不整合時に `success: false` となることを検証

### 統合テスト
- `aiClient.test.ts` などでフォールバックプロバイダーへの切り替えが起きることを確認

## 実装アプローチ

- **Inside-Out**: 各 `_extractSummary` に小さなバリデータ関数を追加
- 共通の `validateStringField(value, path)` ヘルパーを `ProviderStrategy.ts` または新規 `src/background/ai/providers/validation.ts` に配置し、両プロバイダーで共有

## 見積もり
2pt（OpenAI + Gemini 検証 + テスト）

## 副作用
🟢 なし — 正常時の動作は変更せず、異常時にのみ明示的エラーとなる。

## 落とし穴
- OpenAI の `content` は将来的に `string | Array<{type,text}>` になる可能性がある。string のみをサポートし、配列形式は「未対応」としてエラーにするか、text を抽出するかは設計時に決定。
- `usage` フィールドは必須ではない。検証対象から外す。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
