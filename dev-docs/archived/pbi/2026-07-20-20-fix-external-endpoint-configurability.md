# PBI: ObsidianClient の中央 fetch 統合と外部エンドポイント設定化

元指摘: Checking Team (High: Red Team Leader; Medium: API & Contract Negotiator)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

## ユーザーストーリー

開発チームとして、`ObsidianClient` で直接使用されているネイティブ `fetch` を `src/utils/fetch.ts` の `fetchWithTimeout` に統合し、Obsidian Local REST API のホストと Gemini API のバージョンをユーザー設定可能にしたい。なぜなら、ObsidianClient は現在中央の URL 検証・CSP 検証・リトライロジックをバイパスしており、かつホストが `127.0.0.1` 固定・Gemini が `v1beta` 固定のため、WSL2/Docker 環境や API 非推奨化時に停止するから。

## ビジネス価値

- すべての外部 fetch 経路で一貫したセキュリティ検証を適用
- WSL2/Docker/IPv6 環境での Obsidian 接続を可能に
- Gemini API のバージョン非推奨化リスクを低減

## 前提・制約

- `src/background/obsidianClient.ts:69` に `_fetchWithTimeout` 関数が存在
- `src/background/obsidianClient.ts:133` で `baseUrl: ${protocol}://127.0.0.1:${port}` とハードコード
- `src/utils/fetch.ts` に `fetchWithTimeout`, `validateUrl`, `CSPValidator`, `fetchWithRetry` が存在
- `src/background/ai/providers/GeminiProvider.ts:60` で `v1beta` をハードコード
- `StorageKeys` に `OBSIDIAN_PROTOCOL` / `OBSIDIAN_PORT` / `OBSIDIAN_API_KEY` は存在

## BDD受け入れシナリオ

```gherkin
Feature: External endpoint configurability

  Scenario: ObsidianClient uses central fetch
    Given ObsidianClient makes a request
    When `_fetchWithTimeout` is called
    Then it routes through `src/utils/fetch.ts` `fetchWithTimeout`
    And URL validation and CSP checks are applied

  Scenario: User configures Obsidian host
    Given user sets OBSIDIAN_HOST to "localhost"
    When connection test runs
    Then the request goes to "https://localhost:27124/"

  Scenario: User configures Gemini API version
    Given user sets gemini_api_version to "v1"
    When a summary request is made
    Then the request goes to "https://generativelanguage.googleapis.com/v1/models/..."
```

## 受け入れ基準

- [ ] `ObsidianClient._fetchWithTimeout` を削除し、全呼び出しを `src/utils/fetch.ts` の `fetchWithTimeout` に置き換え
- [ ] `StorageKeys` に `OBSIDIAN_HOST` を追加（デフォルト `127.0.0.1`）
- [ ] `ObsidianClient._getConfig()` で `OBSIDIAN_HOST` 設定を使用
- [ ] `StorageKeys` に `GEMINI_API_VERSION` を追加（デフォルト `v1beta`）
- [ ] `GeminiProvider` で URL 構築時に `GEMINI_API_VERSION` を使用
- [ ] Dashboard/Popup に新設定 UI を追加（Obsidian host, Gemini version）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `obsidianClient.test.ts` で central fetch 使用を検証
- `GeminiProvider.test.ts` で URL バージョン切り替えを検証

### 統合テスト
- 設定変更後の接続テストで実際の URL が変わることを確認（モック）

## 実装アプローチ

- **Outside-In**: 設定 UI → `StorageKeys` → `ObsidianClient` / `GeminiProvider` の置き換え
- `fetchWithTimeout` の引数が ObsidianClient の needs（timeout, headers）に対応しているか確認

## 見積もり
3pt（fetch 統合 + 2設定追加 + UI + テスト）

## 副作用
🟡 軽微 — 新しい設定キー追加と fetch 経路変更。ただしデフォルト値を維持するため既存ユーザーへの影響は最小。

## 落とし穴
- `fetchWithTimeout` は `allowedUrls` チェックを行うが、Obsidian の `127.0.0.1` / `localhost` は許可リストに含まれているか確認・追加が必要。
- `CSPValidator` は AI プロバイダー URL 向けに設計されている可能性があり、Obsidian URL に適用する際の挙動を検証。
- Gemini の `v1` と `v1beta` でレスポンス形式が異なる場合、`_extractSummary` も影響を受ける。PBI-13 と連携して対応。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
