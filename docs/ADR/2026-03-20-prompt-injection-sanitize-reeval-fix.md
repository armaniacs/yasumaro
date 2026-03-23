# プロンプトインジェクション防御とサニタイズ後再評価の矛盾修正

## Context

現在のAIプロバイダー（GeminiProvider、OpenAIProvider）では、プロンプトインジェクション検出後にコンテンツをサニタイズし、危険度HIGHの場合にサニタイズ後のコンテンツで再評価するロジックがあります。

**現状のコード（GeminiProvider.ts:49-59, OpenAIProvider.ts:74-84）:**
```typescript
if (dangerLevel === 'high') {
    // 危険度高でも、サニタイズ後のコンテンツで再評価
    const { dangerLevel: newDangerLevel } = sanitizePromptContent(sanitizedContent);
    if (newDangerLevel === 'high') {
        const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
        addLog(LogType.ERROR, `High risk prompt injection blocked: ${cause}`);
        return { summary: `Error: Content blocked due to potential security risk. (原因: ${cause})` };
    }
    // サニタイズ後が安全/低リスクの場合は続行（警告のみ）
    addLog(LogType.WARN, `Content sanitized and proceeding with AI request`);
}
```

**問題点:**
1. 無意味な二重評価: `sanitizePromptContent()`は[FILTERED]置換のみを行い、同じ危険度判定ロジックを適用。置換済みコンテンツの再評価は結果を変えない
2. セキュリティ矛盾: 再評価後に"安全/低リスク"と判定されると、高リスクコンテンツがAI送信される可能性
3. 回避可能: 悪意あるユーザーが[FILTERED]置換パターンを学習すれば、回避策を編み出す可能性

## Decision

### 修正方針: 高リスク時の即時ブロック

危険度HIGHと判定された場合は、サニタイズ後再評価を行わず、即時に処理を中止します。

**修正後のロジック:**
```typescript
if (dangerLevel === 'high') {
    const cause = warnings.length > 0 ? warnings.join('; ') : 'High risk content detected';
    addLog(LogType.ERROR, `[${this.providerName}] High risk prompt injection blocked: ${cause}`);
    return { summary: `Error: Content blocked due to potential security risk. (原因: ${cause})` };
}
```

**変更内容:**
- 危険度HIGH時の再評価ロジックを削除
- 即時にエラーレスポンスを返す
- AIリクエストの送信を防止
- ユーザーに明確なエラーメッセージを表示

## Consequences

### Positive

- セキュリティ強化: 高リスクコンテンツがAI送信されるリスクを完全排除
- サーバー負荷削減: 無意味な二重評価による処理を削減
- コード単純化: 不透明な再評価ロジックを削除
- 明確なポリシー: 高リスクは一律ブロックというルールが明確

### Negative

- 誤検知時の影響: 正当なコンテンツが高リスク誤検知されると、要約できない
- ユーザー体験低下: リクエストはブロックされ、コンテンツ編集が必要

### Mitigation

- 誤検知率低下: 後続課題でsanitizePrompt.tsのパターン精度向上（promptSanitizer.tsの過剰パターン修正）
- ユーザーへのフィードバック: エラーメッセージに検出原因を含め、コンテンツ編集を促す
- ログ出力: 検出された警告パターンをログに記録し、誤検知分析を可能に

## Implementation Steps

- [x] ADR作成
- [x] TDD Red: 高リスク時の即時ブロックテスト作成
- [x] TDD Green: 再評価ロジック削除・即時ブロック実装（GeminiProvider.ts, OpenAIProvider.ts）
- [x] TDD Refactor: 不要（コードが簡潔化済み）
- [x] 単一テスト実行・検証（2件パス）
- [x] すべてのテスト実行・検証（1747件パス、Regressionなし）
- [ ] ドキュメント更新

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: -
- **Superseded By**: -