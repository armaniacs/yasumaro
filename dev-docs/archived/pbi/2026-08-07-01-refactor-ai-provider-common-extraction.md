# PBI: AIプロバイダーの重複ロジックをProviderStrategy基底クラスに抽出する

**作成日**: 2026-08-07
**優先度**: 高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（プロバイダー実装の内部構造変更。外部API・UIへの影響なし）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで `GeminiProvider.ts` と `OpenAIProvider.ts` の間に大規模な重複が発見された。

### 重複箇所

1. **`testConnection()` のHTTPステータス→エラーメッセージ変換**（各~90行）
   - `401/403` → "Authentication failed (…)"
   - `404` → "Model or endpoint not found"
   - `429` → "Rate limit exceeded"
   - キャッチブロックでの `HTTP (\d+):` パース → 同一マッピング再適用
   - タイムアウト検出ロジック（`AbortError` / `msg.includes('timed out')`）

2. **`generateSummary()` のプリフライトガード**（各~80行）
   - `checkHardLimit()` → `checkUsageWarning()` → `checkRateLimit()` の同一チェーン
   - `sanitizePromptContent()` + dangerLevel判定（同一ロジック）
   - `applyCustomPrompt()` 呼び出し
   - `fetchWithRetry()` の同一リトライ設定（`maxRetryCount:3, initialDelayMs:1000, backoffMultiplier:2, maxDelayMs:60000`）
   - キャッチ：`AbortError` → "timed out" メッセージ、その他汎用エラーメッセージ

3. **`_getAllowedUrls()`** — 両方とも `getAllowedUrls()` を呼ぶだけの同一メソッド

4. **`_extractSummary()`** — スキーマ検証のカスケードパターンが構造的に同一

### 既存の基底クラス

`ProviderStrategy.ts` は現在 `getMaxContentChars()`, `getMaxTokens()`, `getProviderId()` を提供しているが、`generateSummary()` と `testConnection()` は abstract のまま、共通ロジックが抽出されていない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/background/ai/providers/GeminiProvider.ts src/background/ai/providers/OpenAIProvider.ts src/background/ai/providers/ProviderStrategy.ts
grep -n "checkHardLimit\|checkUsageWarning\|checkRateLimit\|sanitizePromptContent\|applyCustomPrompt" src/background/ai/providers/*.ts
grep -n "testConnection" src/background/ai/providers/*.ts
```

## 受け入れ基準（BDD）

```gherkin
Scenario: プロバイダーのtestConnectionでHTTPエラーが共通ハンドリングされる
  Given OpenAIProviderまたはGeminiProviderのインスタンス
  When testConnection()がHTTP 401/403/404/429を受信する
  Then 対応するユーザー向けエラーメッセージが返される

Scenario: プロバイダーのgenerateSummaryでプリフライトガードが共通実行される
  Given OpenAIProviderまたはGeminiProviderのインスタンス
  When generateSummary()が呼ばれる
  Then checkHardLimit, checkUsageWarning, checkRateLimitの順でチェックが実行される
  And ガードが失敗した場合は早期リターンされる

Scenario: プロバイダー固有のロジックは個別に維持される
  Given 各プロバイダーのペイロード構築・レスポンス解析
  When テストを実行する
  Then プロバイダー固有の動作に回帰がない
```

## 受け入れ基準
- [ ] `testConnection()` のHTTPステータス→エラーメッセージ変換を `AIProviderStrategy` に `protected mapConnectionError(statusCode, providerLabel)` として抽出
- [ ] `testConnection()` のキャッチブロック用に `protected parseAndMapFetchError(msg, providerLabel)` を `AIProviderStrategy` に追加
- [ ] `generateSummary()` のプリフライトガード（hardLimit → usageWarning → rateLimit）を `AIProviderStrategy` に `protected checkPreFlight()` として抽出
- [ ] `generateSummary()` のコンテンツ前処理（サニタイズ + dangerLevel判定）を `AIProviderStrategy` に `protected sanitizeContent(content, providerName, traceId)` として抽出
- [ ] 各プロバイダーの `generateSummary()` はペイロード構築とAPI呼び出しのみに縮小
- [ ] 各プロバイダーの `testConnection()` はURL構築とAPI呼び出しのみに縮小
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `AIProviderStrategy` の抽出したメソッドの単体テストを追加
- `mapConnectionError()` の各ステータスコード对应的応答を検証
- `checkPreFlight()` のガードシーケンスを検証

### 回帰テスト
- 既存のプロバイダーテスト（`GeminiProvider.test.ts`, `OpenAIProvider.test.ts`）がパスすることを確認

## 実装アプローチ
- Template Method パターン: `AIProviderStrategy` に共通フローを実装し、各プロバイダーはフックメソッド（`buildPayload`, `parseResponse`）のみをオーバーライド
- 段階的移行: まず `checkPreFlight` → 次に `mapConnectionError` → 最後に `sanitizeContent` の順で抽出
- 各ステップで既存テストを実行し回帰を防ぐ

## 見積もり
2pt（基底クラスへのメソッド抽出 + 2プロバイダーのリファクタ + テスト追加）

## 技術的考慮事項
- 依存: `src/background/ai/providers/ProviderStrategy.ts`, `GeminiProvider.ts`, `OpenAIProvider.ts`
- `sanitizePromptContent`, `checkHardLimit` 等は外部ユーティリティからのインポートのまま、基底クラスから呼び出す形にする
- `fetchWithRetry` の `shouldRetry` コールバックはOpenAIProvider固有（POST冪等性チェック）のため、プロバイダー側に残す

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster 3, 4, 5, 6, 7）
- 対象ファイル: `src/background/ai/providers/ProviderStrategy.ts`, `GeminiProvider.ts`, `OpenAIProvider.ts`
