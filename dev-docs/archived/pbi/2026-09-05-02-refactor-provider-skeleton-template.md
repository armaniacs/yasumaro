# PBI 02: プロバイダーの generateSummary 骨格を基底テンプレートメソッドに統一

優先度: 2 位 / RICE 25.6 = (8 × 2 × 80%) / 0.5w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
AI プロバイダーを保守する開発者として、Gemini / OpenAI / BuiltIn の `generateSummary` 骨格（資格確認→pre-flight→truncate→sanitize→prompt→fetch→timeout 変換→parse）が基底の 1 テンプレートメソッドに集約されてほしい。なぜなら同一順序が 3 箇所に約 100 行ずつ複写され、リトライ・タイムアウト・切り詰めの修正が 3 編集になるから。

## BDD受け入れシナリオ

```gherkin
Scenario: 全プロバイダーが同一の骨格順序で実行される
  Given 各プロバイダーのフックだけをフェイクした基底テンプレート
  When  generateSummary を実行する
  Then  pre-flight → sanitize → prompt → fetch → parse の順序が全プロバイダーで同一になる

Scenario: プロバイダー固有の癖はフックに残る
  Given Gemini の空応答（finishReason/blockReason）
  When  generateSummary を実行する
  Then  Gemini 固有の診断文が返り、他プロバイダーの parse に影響しない

Scenario: testConnection と BuiltIn は対象外のまま振る舞い不変
  Given testConnection（Gemini/OpenAI/BuiltIn 各独自実装）
  When  各 testConnection を実行する
  Then  テンプレート化前と同一の結果が返る（骨格は generateSummary の HTTP spine のみ）
  And   BuiltIn の generateSummary は pre-flight スキップ・on-device のまま
```

## 受け入れ基準
- [x] `ProviderStrategy` に骨格テンプレートメソッドが1つ存在し、3 プロバイダーがそれを呼ぶ
- [x] プロバイダー側に残るのはフックのみ（content 上限・request 構築・response parse・空応答診断文）
- [x] 既存の差分（truncate 上限 30k/10k/4k、`thinkingBudget:0`、ヘッダ形状、timeout 30s/120s local）がフック値として保持される
- [x] `providerCatalog.ts` が唯一の選択 switch のまま
- [x] transport（fetch / allowedUrls）は dynamic import で遅延解決し、基底の静的 import が providerCatalog への循環（cspValidator・urlWhitelist の utils→background 逆辺）を作らない
- [x] 既存 provider suite が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 骨格をフックフェイクで1回駆動（順序・pre-flight 阻止・sanitize 阻止・timeout 変換・usage 記録）
- 各プロバイダーは parse/limits/診断文のみをテスト（network スタブの重複排除）
### 統合テスト
- `AIService` 経由の既存テストは無修正で green
### 例外ハンドリング
- 空応答・HTTP エラー・timeout のマッピングが変更前と同一文面

## 実装アプローチ
- **Outside-In**: テンプレートメソッドのシグネチャ（hooks 型）から設計 → 1 プロバイダーずつ移行 → 旧複写を削除

## 見積もり
0.5w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: hooks を protected メソッドまたは注入可能にし、骨格テストはフェイク hooks で駆動
- 非機能要件: エラーメッセージ・診断文の文面変更は禁止。ADR 2026-08-23（aiTestProgressClient 却下）とは無関係（対象は接続テスト進捗プロトコルであり骨格ではない）
- `checkPreFlight` / `sanitizeContent` / `mapConnectionError` 等の既存ヘルパはそのまま再利用

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "async generateSummary|async testConnection" src/background/ai/providers/*.ts
rg -n "checkPreFlight|sanitizeContent|mapConnectionError|parseAndMapFetchError|shouldRetrySummaryRequest|recordUsageIfPresent" src/background/ai/providers/ProviderStrategy.ts
```
2026-09-05 時点: 基底（340 行）にヘルパは揃っているが順序付けの骨格は各プロバイダーに複写。差分: truncate 上限（Gemini 30k / generic 10k / local 4k）、Gemini のみ `thinkingBudget:0`、ヘッダ（`x-goog-api-key` vs `Authorization: Bearer` vs on-device）、timeout（30s vs local 120s）、空応答診断（`finishReason`/`blockReason` vs `choices[0].message.content`）。

### 実装手順
1. `ProviderStrategy` に `executeSummaryFlow(hooks)` テンプレートを追加（順序・pre-flight・sanitize・prompt・fetch・timeout 変換・usage 記録を所有）
2. Gemini → OpenAI → BuiltIn の順にフック化（各ステップで既存テスト green）
3. 複写された骨格を削除し、`providerCatalog.ts` の選択が不変であることを確認

### 落とし穴
- `thinkingBudget:0` や local 120s timeout は「癖」であり骨格に吸い上げないこと
- 空応答診断文はユーザー可視。文面を変えないこと（スナップショットテストがあれば先に確認）
- `testConnection` の `CONNECTION_TEST_PROMPT`（'Reply with the single word: OK'）は基底に既存。再利用すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] provider 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（ADR 2026-04-21-ai-provider-abstraction に抵触しないことを確認し、必要なら追記）
