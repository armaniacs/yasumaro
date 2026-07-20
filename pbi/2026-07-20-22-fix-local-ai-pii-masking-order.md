# PBI: ローカル AI 要約前の PII マスキング適用

元指摘: Checking Team (Medium: Compliance & Privacy Guard)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、`PrivacyPipeline` でローカル AI 要約（L1）より前に PII マスキング（L2）を適用するか、少なくともユーザーに「ローカル AI は PII マスキング前に処理されます」と明示したい。なぜなら、現在の順序では PII がマスクされないままローカル AI (Ollama/LM Studio) に送信され、ユーザーが「PII は先にマスクされる」と想定している場合に想定外の挙動となるから。

## ビジネス価値

- プライバシー保護の一貫性向上
- ユーザー信頼の維持
- コンプライアンス（GDPR/CCPA）対応強化

## 前提・制約

- `src/background/privacyPipeline.ts:98-106` で L1 ローカル要約 → L2 PII マスクの順に実行
- `_performLocalSummarization` は `useLocalAi` 設定に応じて動作
- ローカル AI はオンデバイスなので外部漏洩リスクは低い
- PII マスキングは `sanitizeRegex` を使用

## BDD受け入れシナリオ

```gherkin
Feature: PII masking before local AI

  Scenario: Local AI receives masked content
    Given content contains an email address
    And useLocalAi and useMasking are both enabled
    When local summarization runs
    Then the email is masked before being sent to the local AI

  Scenario: UI discloses local AI does not mask PII
    Given masking is enabled but local AI runs before masking by design
    When the user views privacy settings
    Then a note explains "local AI processes content before PII masking"
```

## 受け入れ基準

- [ ] L1 ローカル要約の前に、L2 相当の PII マスキングを適用する（`useMasking` 設定時）
- [ ] または、設定 UI に「ローカル AI は PII マスキング前に処理されます」という明記を追加（実装時にどちらか選定、可能なら前者を推奨）
- [ ] `local_only` モードでも PII マスク漏れが発生しないようにする
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `privacyPipeline.test.ts` に「ローカル AI 要約前に PII がマスクされる」テストを追加
- 既存の「local_only で要約が保存される」テストを拡張

### 統合テスト
- 実際のメールアドレスを含むコンテンツで、local AI 要約結果にメールが含まれないことを確認

## 実装アプローチ

- **Inside-Out**: `PrivacyPipeline._runPipeline` の処理順序を変更
- L1 実行前に `sanitizeRegex` を呼び出し、`processingText` を更新してからローカル要約を実行
- UI 明記を選ぶ場合は、 Dashboard/Popup のプライバシー設定セクションにメッセージを追加

## 見積もり
2pt（処理順序変更 + テスト + UI 明記）

## 副作用
🟡 軽微 — ローカル AI の入力コンテンツがマスク後のものに変わるため、要約品質がわずかに変わる可能性がある。しかしプライバシー優先の設計。

## 落とし穴
- 2回マスキングを実行するとパフォーマンスがわずかに低下。L1 前に1回だけ実行し、L2 ステップでは重複排除するよう調整。
- `maskedItems` カウントが2回に分かれてしまう可能性がある。最終的なカウントを正しく集計する。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加/更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
