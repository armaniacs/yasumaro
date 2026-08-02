# PBI: 2026-08-02-03-feat-privacy-pipeline-integration-test

## ユーザーストーリー
セキュリティ責任者として、プライバシーパイプライン（PIIマスキング $\rightarrow$ Local AI $\rightarrow$ Cloud AI）の全工程におけるデータの流れが正しく、機密情報が一度も生でクラウドに送信されないことを検証したい、なぜなら単体テストでは検知できないコンポーネント間の連携ミスにより、ユーザーの個人情報が外部AIプロバイダーに漏洩する致命的なリスクがあるから

## ビジネス価値
- **プライバシー保証の実証**: 「クラウドに送信される前に必ずマスキングされる」という設計上の約束が、実装レベルで正しく動作していることを証明する
- **回帰テストの自動化**: パイプラインのステップ追加や変更時に、セキュリティ上の後退（Regression）が発生していないことを即座に検知できる

## BDD受け入れシナリオ

```gherkin
Scenario: Full Pipeline Privacy Preservation
  Given A content containing PII (e.g., "My email is test@example.com")
  And Privacy mode is set to 'full_pipeline'
  When The content is processed through `PrivacyPipeline.process`
  Then The content passed to Local AI is already masked (e.g., "[EMAIL]")
  And The content passed to Cloud AI is the output of Local AI (which is also masked)
  And The final summary is returned to the user
  And The raw PII ("test@example.com") was never sent to any Cloud AI provider

Scenario: Local AI Failure Fallback with Privacy
  Given A content containing PII
  And Local AI is unavailable or fails
  When The content is processed through `PrivacyPipeline.process`
  Then The PII is still masked before being sent to Cloud AI
  And The pipeline correctly handles the local failure without bypassing the masking step
```

## 受け入れ基準
- [ ] `PrivacyPipeline` の全ステップ（Masking $\rightarrow$ Local AI $\rightarrow$ Cloud AI）を跨ぐ統合テストを実装すること
- [ ] 各ステップへの入力/出力をインターセプトし、クラウドAIへ送信される直前の文字列に生PIIが含まれていないことを検証すること
- [ ] Local AI が失敗した場合でも、マスキングステップがスキップされずに実行されることを確認すること

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] (適用外: バックグラウンドロジックのため統合テストで検証)

### 統合テスト
- [ ] `PrivacyPipeline` クラスの実装に対する統合テスト
- [ ] `AIService` と `ISanitizers` をモック化し、呼び出し順序と引数の内容を検証する（Spyを使用）

### 単体テスト
- [ ] 各ステップの境界条件テスト（極端に長いテキスト、PIIが含まれないテキストなど）

## 実装アプローチ
- **Outside-In**: `PrivacyPipeline.process` の戻り値の検証から始め、次に内部の `aiService.generateSummary` に渡される引数を検証し、最後に `sanitizers.sanitizeRegex` の呼び出しを確認する
- **Verification by Interception**: モックの `generateSummary` メソッド内で、受け取った `content` に機密文字列が含まれていないかをアサートする

## 見積もり
8ストーリーポイント

## 技術的考慮事項
- 依存関係: `src/background/privacyPipeline.ts`, `src/background/ai/AIService.ts`
- テスタビリティ: `PrivacyPipeline` のコンストラクタで `AIService` と `ISanitizers` を注入可能であるため、容易にモック化できる
- 非機能要件: パイプラインの処理順序が厳格に守られていること

## 実装者向け注記

### 現状コードの確認
```bash
cat src/background/privacyPipeline.ts
```
`process` メソッド内で `_buildSanitizedSettings` $\rightarrow$ `sanitizers.sanitizeRegex` $\rightarrow$ `_performLocalSummarization` $\rightarrow$ `aiService.generateSummary` (Cloud) の順で処理される。

### 実装手順
1. `src/background/__tests__/privacyPipeline.integration.test.ts` を新規作成
2. `AIService` と `ISanitizers` のモックを作成
3. テストケースを作成し、`PrivacyPipeline.process` を実行
4. `aiService.generateSummary` が呼ばれた際の第1引数に、入力した生PIIが含まれていないことを `expect().not.toContain()` で検証する
5. Local AI 失敗シナリオを追加し、同様に検証する

### 落とし穴
- `mode` 設定（`local_only`, `full_pipeline` 等）によってパスが変わるため、主要なモードすべてで検証すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] クラウドAIへの送信データに生PIIが含まれないことがコードレベルで証明される
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
