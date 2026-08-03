# PBI: 2026-08-02-04-fix-obsidian-api-key-leakage-prevention

## ユーザーストーリー
セキュリティエンジニアとして、Obsidian接続エラー発生時のログ出力において、APIキーなどの機密情報が絶対に平文で出力されないことを保証したい、なぜならデバッグログがファイルやコンソールに保存された際、そこからAPIキーが漏洩すると、悪意あるユーザーや外部ツールにVaultへのフルアクセス権限を与えてしまう致命的なリスクがあるから

## ビジネス価値
- **情報漏洩の完全防止**: 開発者の不注意な `console.log` やエラーハンドリングによる機密情報の露出をシステム的に防止する
- **コンプライアンス遵守**: ユーザーの認証情報を安全に扱うというプライバシーポリシーを技術的に担保する

## BDD受け入れシナリオ

```gherkin
Scenario: API Key Redaction in Error Logs
  Given ObsidianClient is configured with a sensitive API key
  When An error occurs during _getConfig (e.g., API key is invalid or missing)
  Then The error log produced by `console.error` or `addLog` must NOT contain the raw API key
  And The log message must use redacted placeholders (e.g., "apiKey: string") instead of the actual value

Scenario: Redaction in Connection Test Failures
  Given A connection test to Obsidian is performed with an invalid API key
  When The connection fails with a network error or HTTP 401
  Then The resulting error logs and debug information must be sanitized
  And No part of the Authorization header or API key is leaked into the log files
```

## 受け入れ基準
- [ ] `ObsidianClient` 内のすべての `addLog` および `console.error` 呼び出し箇所で、APIキーが生で渡されていないことを確認する静的解析/レビューを行うこと
- [ ] `redactSensitiveData` 関数を通した出力が正しく行われていることを検証するユニットテストを実装すること
- [ ] 意図的に不正なキーをセットして接続エラーを発生させ、出力されるログにキーが含まれていないことを確認するテストを実装すること

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] (適用外: ログファイルの出力を検証する統合テストで対応)

### 統合テスト
- [ ] `ObsidianClient` を使用してエラーを発生させ、`addLog` に渡された引数をキャプチャして、機密情報が含まれていないことをアサートするテスト

### 単体テスト
- [ ] `src/utils/redaction.ts` の `redactSensitiveData` 関数に対する、多様な入力パターン（文字列、オブジェクト、undefined等）でのマスク処理検証

## 実装アプローチ
- **Defense in Depth**: `ObsidianClient` 側での redaction だけでなく、`addLog` または `logger.ts` 自体に機密情報を自動検知してマスクするガードレールを設けることを検討する
- **Outside-In**: 実際にエラーを発生させ、ログに出力される内容を検証するテストから書き、漏洩箇所を特定して修正する

## 見積もり
3ストーリーポイント

## 技術的考慮事項
- 依存関係: `src/background/obsidianClient.ts`, `src/utils/redaction.ts`, `src/utils/logger.ts`
- テスタビリティ: `addLog` をモック化して、呼び出し時の引数を検証する
- 非機能要件: ログ出力のパフォーマンスに影響を与えない範囲でサニタイズを行う

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "apiKey" src/background/obsidianClient.ts
```
`_getConfig` メソッド内で `console.error` と `addLog` が使われており、そこで `redactSensitiveData` が呼ばれている。この実装が十分か、また他のメソッド（`testConnection` 等）でも同様の配慮がされているか確認が必要。

### 実装手順
1. `src/background/__tests__/obsidianClient-security.test.ts` を作成/更新
2. `addLog` のスパイを作成し、エラー発生時のログメッセージに `settings[StorageKeys.OBSIDIAN_API_KEY]` の値が含まれていないことを検証するテストを実装
3. `testConnection` などの他のエラーパスでも同様の検証を追加
4. 必要に応じて `src/utils/redaction.ts` のマスク強度を向上させる

### 落とし穴
- `JSON.stringify` 等でオブジェクトをそのまま出力した際に、内部にAPIキーが含まれているケースに注意すること

## Definition of Done
- [ ] すべてのエラーパスにおいてAPIキーの漏洩がないことがテストで証明される
- [ ] `redactSensitiveData` のカバレッジが向上し、エッジケースをカバーしている
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
