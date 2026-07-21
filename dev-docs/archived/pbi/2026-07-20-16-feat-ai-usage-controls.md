# PBI: AI 使用量ハードリミットとレート制限のユーザー設定化

元指摘: Checking Team (High: FinOps Consultant; Medium: Tuning Expert)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

## ユーザーストーリー

開発チームとして、AI 使用量に対して月次ハードリミットを設け、レート制限をユーザーが設定できるようにしたい。なぜなら、現在は月間100万トークンのソフト警告のみでハードストップがなく、また1分10リクエストの制限が固定されているため、記録量の多いユーザーが予期せぬ API 課金を被るリスクがあるから。

## ビジネス価値

- 予期せぬ API 課金リスク低減
- 有料/無料 tier ユーザー双方に最適な制限設定
- モバイル・低速回線ユーザーへの配慮

## 前提・制約

- `src/utils/aiUsageTracker.ts` が `checkRateLimit()` と `checkUsageWarning()` を提供
- `RATE_LIMIT_MAX_REQUESTS = 10` はハードコード
- `MONTHLY_WARNING_THRESHOLD = 1000000` もハードコード
- `StorageKeys` に `AI_USAGE_*` キーが存在
- `OpenAIProvider` はローカル URL 時のみ 4000 文字制限、リモート時は `getMaxContentLength()` を使用
- `GeminiProvider` は固定で 30000 文字

## BDD受け入れシナリオ

```gherkin
Feature: AI usage controls

  Scenario: Monthly token hard limit blocks requests
    Given user sets maxMonthlyTokens to 50000
    And current usage is 49900 tokens
    When a new AI summary request would consume 200 tokens
    Then the request is blocked
    And user sees "Monthly token limit reached" message

  Scenario: User-configurable rate limit
    Given user sets AI rate limit to 5 req/min
    When 5 requests are made within 1 minute
    Then the 6th request is rejected until the window resets

  Scenario: Per-model content length limits
    Given user selects gpt-4o-mini
    And maxContentChars for gpt-4o-mini is set to 15000
    When content exceeds 15000 chars
    Then it is truncated before sending
```

## 受け入れ基準

- [ ] `StorageKeys` に `MAX_MONTHLY_TOKENS` を追加（デフォルト 1,000,000、0 で無制限）
- [ ] `recordUsage()` または `generateSummary()` 呼び出し前に `checkHardLimit()` を追加し、超過時にリクエストをブロック
- [ ] `StorageKeys` に `AI_RATE_LIMIT_MAX` を追加（デフォルト 10）
- [ ] `checkRateLimit()` が `AI_RATE_LIMIT_MAX` 設定値を参照するように変更
- [ ] プロバイダー/モデル別に `maxContentChars` 設定を追加し、`OpenAIProvider` / `GeminiProvider` の固定値を置き換え
- [ ] Dashboard/Popup に新設定 UI を追加
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `aiUsageTracker.test.ts` に hard limit 超過時のブロックテスト
- `checkRateLimit` の設定値読み取りテスト
- `OpenAIProvider` / `GeminiProvider` の切り詰めテスト

### 統合テスト
- 設定 UI から値を変更し、実際のリクエスト制御が動作することを E2E で確認

## 実装アプローチ

- **Outside-In**: 設定 UI → `StorageKeys` → `aiUsageTracker` → Provider 層
- `ProviderStrategy` に `getMaxContentChars()` ヘルパーを追加し、モデル名から推定トークン数/文字数を解決

## 見積もり
3pt（設定追加 + hard limit + rate limit 設定化 + content length 設定化 + UI）

## 副作用
🟡 軽微 — 新しい設定キーが追加され、既存ユーザーにはデフォルト値が適用される。UI 変更も必要。

## 落とし穴
- 既存ユーザーの月次使用量がすでに 100万を超えている場合、hard limit 導入で即座にブロックされる。デフォルト値を「警告のみ（0=無制限）」にするか、既存ユーザーへの移行を考慮。
- トークン数はプロバイダーから返却される `usage` を信頼するが、ローカル AI やカスタムプロバイダーでは返却されない場合がある。文字数ベースのフォールバックが必要。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
