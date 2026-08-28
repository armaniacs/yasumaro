# PBI: Ollama Origin削除ルールにinitiatorDomainsを追加し拡張機能起因リクエストに限定

## ユーザーストーリー
Ollamaプロバイダ利用者として、Originヘッダー削除ルールが拡張機能自身からのリクエストにのみ適用されてほしい、なぜなら現在のルールは任意のウェブサイトからの `fetch('http://localhost:11434/...')` にも適用され、OllamaのCORS保護を意図せずバイパスしてしまうから。

## 優先度
- 順位: 1 / 3
- RICEスコア: 600（Reach=全ユーザー / Impact=3=安全瑕疵 / Confidence=100% / Effort=0.5人週）
- 根拠: セキュリティ上の論理欠陥。任意のウェブサイトがユーザーのローカルOllamaにCORSを回避してアクセスできる状態は即座に修正すべき。

## BDD受け入れシナリオ

```gherkin
Scenario: 拡張機能自身からのOllamaリクエストにはOriginヘッダーが除去される
  Given ユーザーがOllama（http://localhost:11434/v1）を設定している
  When  拡張機能のサービスワーカーがOllamaへAPIリクエストを送信する
  Then  そのリクエストのOriginヘッダーが除去されている

Scenario: 任意のウェブサイトからのOllamaリクエストにはOriginヘッダーが残る
  Given ユーザーがOllama（http://localhost:11434/v1）を設定している
  When  外部サイトが fetch('http://localhost:11434/api/generate') を実行する
  Then  リクエストのOriginヘッダーは除去されず、OllamaのCORS設定に従って処理される
```

## 受け入れ基準
- [ ] `buildOllamaOriginRule` が生成するルールの `condition` に `initiatorDomains: [chrome.runtime.id]` が含まれる
- [ ] 拡張機能の `chrome.runtime.id` は `chrome-extension://` スキームのオリジンとして正しくマッチする
- [ ] 既存の単体テスト（`ollamaOriginRule.test.ts`）で `initiatorDomains` が含まれることを検証するアサーションを追加
- [ ] `urlFilter`・`resourceTypes` は変更不要（現在の実装で正しい）

## テスト戦略
- 単体: `buildOllamaOriginRule` の戻り値に `condition.initiatorDomains` が `chrome.runtime.id` を含むことをアサート
- 統合: 既存の `lifecycleHandlers-ollamaOriginRule.test.ts` はモック経由のため影響なし。ルール構築ロジックの変更は単体テストでカバー

## 見積もり
1ポイント

## Definition of Done
- [ ] ルールに `initiatorDomains` が追加され、既存テストがパスする
- [ ] テストに `initiatorDomains` アサーションが追加
- [ ] コードレビュー完了
