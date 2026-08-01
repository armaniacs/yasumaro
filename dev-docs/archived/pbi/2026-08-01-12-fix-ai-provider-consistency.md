# PBI: AI プロバイダー間の整合性と診断を改善する

## ユーザーストーリー
ユーザーとして、OpenAI と Gemini のどちらを使っても使用量が正しく記録され、タイムアウト設定が反映され、エラー発生時に原因がわかるメッセージが表示されるようにしたい。

## ビジネス価値
- 使用量上限超過を防ぐ
- 診断コストを下げる
- プロバイダー間で一貫した動作

## BDD受け入れシナリオ

```gherkin
Scenario: OpenAI 使用時も使用量が記録される
  Given OpenAI プロバイダーで要約に成功する
  When 応答が返る
  Then recordUsage() が呼ばれる

Scenario: Gemini のタイムアウトが設定を反映する
  Given AI_TIMEOUT_MS が 60000 に設定されている
  When Gemini で要約リクエストを送信する
  Then タイムアウトが 60000ms になる

Scenario: HTTP 401 エラーがわかるメッセージになる
  Given testConnection で 401 が返る
  When エラーメッセージを表示する
  Then "Invalid API key" など原因が特定できる
```

## 受け入れ基準
- [ ] `OpenAIProvider` が要約成功時に `recordUsage()` を呼ぶ
- [ ] `GeminiProvider` のタイムアウトが `AI_TIMEOUT_MS` 設定を使用
- [ ] `OpenAIProvider`/`GeminiProvider` の `if (!response.ok)` 分岐が到達可能（または削除）
- [ ] `testConnection` のタイムアウト判定が実際のエラーメッセージと一致
- [ ] Gemini の成功結果に `providerName`/`model` が含まれる

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `recordUsage` 呼び出しテスト
- タイムアウト値テスト
- HTTP ステータス別エラーメッセージテスト

## 実装アプローチ
- **Outside-In**: `aiUsageTracker` から呼び出しを確認
- **Red-Green-Refactor**: 各非対称のテストを追加

## 見積もり
2pt

## 技術的考慮事項
- `fetchWithRetry` が非 OK レスポンスで例外を投げるため、分岐構造を見直す
- OpenAI のレスポンスに使用量情報が含まれる場合のみ記録可能

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "recordUsage\|timeoutMs\|testConnection" src/background/ai/providers/OpenAIProvider.ts
grep -n "recordUsage\|timeoutMs\|testConnection\|providerName" src/background/ai/providers/GeminiProvider.ts
```

### 実装手順
1. `OpenAIProvider` に `recordUsage()` 呼び出し追加
2. `GeminiProvider` のタイムアウトを `AI_TIMEOUT_MS` に
3. `testConnection` のエラーハンドリングを実態に合わせる
4. Gemini 成功結果にメタデータ追加

### 落とし穴
- `fetchWithRetry` の仕様変更が必要な場合は PBI-7 と連携
- 使用量情報がレスポンスに含まれない場合の扱い

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/background/ai/providers/OpenAIProvider.ts`, `src/background/ai/providers/GeminiProvider.ts`, `src/background/ai/providers/ProviderStrategy.ts`, `src/background/aiClient.ts`, `src/utils/aiLimits.ts`
- **関連する過去PBI**:
  - `2026-07-25-21-fix-ai-call-deduplication`
- **補足**: `GeminiProvider` はタイムアウトを 30000ms 固定、`OpenAIProvider` は `AI_TIMEOUT_MS` 設定を使用。`recordUsage()` も Gemini のみ呼んでいる非対称が本PBIの主な対象。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
