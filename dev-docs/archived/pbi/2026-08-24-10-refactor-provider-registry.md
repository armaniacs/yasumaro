# PBI: ProviderRegistry 導入 — OpenAIProvider 5分岐のテーブル駆動化

## 概要
- 優先度: 3 (RICE 11.2 — Reach 7 × Impact 2 × Confidence 80% / Effort 1.0w)
- 種別: refactor
- 見積もり: 2pt
- Recommendation: Strong
- 依存: なし (09と並行可能、ただし 02 facade との整合に注意)

## ユーザーストーリー
開発者として、新AIプロバイダ (例: anthropic) を追加する際に `src/background/ai/providers/OpenAIProvider.ts` の if-else、`src/utils/aiModelKey.ts` の string replace、`src/background/ai/RemoteAIService.ts` の register、`src/utils/storage/types.ts` の StorageKeys の4箇所を編集せず、1つのテーブルに1行追加するだけで済むようにしたい。なぜなら現在の分散は OCP違反で、'openai2' のような例外が fragile な replace で吸収され漏洩するから。

## ビジネス価値
- 拡張性: プロバイダ追加コスト 4ファイル→1行 (leverage 高)
- 堅牢性: `normalizeProviderKeyName` の fragile replace ('2'→'_2') をテーブルルックアップに置換し typo を型レベルで検出
- locality: provider別の baseUrl/apiKey/modelKey/default/要APIキー判定が1テーブルに集約

## BDD受け入れシナリオ

```gherkin
Scenario: 新プロバイダがテーブル1行で追加できる
  Given ProviderRegistry に {id:'anthropic', baseUrlKey: ANTHROPIC_BASE_URL, apiKeyKey: ANTHROPIC_API_KEY, modelKey: ANTHROPIC_MODEL, defaultBaseUrl: 'https://api.anthropic.com/v1', requiresApiKey: true} が1行追加されている
  When RemoteAIService.registerDefaultProviders が registry をループして生成する
  Then GenericOpenAICompatibleProvider が anthropic 用に正しく baseUrl/apiKey/model を解決し、testConnection が成功する

Scenario: 既存プロバイダの挙動が変わらない
  Given 既存 7プロバイダ (openai, openai-compatible, lm-studio, ollama, gemini, openai2, gemini2) が registry に移行されている
  When 各プロバイダで generateSummary を呼ぶ
  Then 従来と同一の baseUrl/timeout/contentLimit で動作し、isLocalUrl 判定が requiresApiKey に基づく

Scenario: 型レベルで未定義プロバイダが検出される
  Given ProviderId が registry keys から導出されている
  When 存在しない 'unknown-provider' を ProviderSlot.provider に代入しようとする
  Then TypeScript がコンパイルエラーで検出する (string&{} を許容するが registry lookup は undefined を返す)
```

## 受け入れ基準
- [x] `src/utils/storage/types.ts` または `src/background/ai/providerRegistry.ts` に `ProviderRegistry: Map<ProviderId, {baseUrlKey, apiKeyKey, modelKey, defaultBaseUrl?, requiresApiKey, isLocal}>` を新設 (Layer 0)
- [x] `src/background/ai/providers/OpenAIProvider.ts` の 5分岐コンストラクタを `GenericOpenAICompatibleProvider(RegistryEntry)` に置換。`isLocalUrl` / `timeoutMs` / `getMaxContentLength` の分岐を `entry.requiresApiKey` / `entry.isLocal` から導出
- [x] `src/utils/aiModelKey.ts` の `normalizeProviderKeyName` / `resolveModelKey` を registry ルックアップに置換するか、互換 shim として残しつつ内部をテーブル参照に
- [x] `src/background/ai/RemoteAIService.ts:registerDefaultProviders` が `for (entry of registry) register(entry.id, ...)` のループに
- [x] 既存テストが全パス (RemoteAIService 7プロバイダの testConnection/generateSummary)
- [x] 新規 registry 単体テスト (各 entry の baseUrl解決、default値、isLocal判定)

## テスト戦略

### 単体テスト
- registry 各 entry の baseUrlKey/apiKeyKey/modelKey が正しい StorageKeys を指すこと
- GenericProvider が entry に基づき baseUrl を解決すること (openai-compatible, lm-studio, ollama の defaultBaseUrl)
- requiresApiKey=false の provider は timeout短縮 & contentLimit 4000 になること

### 統合テスト
- RemoteAIService が registry 経由で 7プロバイダを生成し、priority list が動作すること

## 見積もり
2 ストーリーポイント

## 技術的考慮事項
- 配置: `src/background/ai/providerRegistry.ts` // @layer 0 or 1 — ProviderRegistry table
- 互換: `ProviderId` union (7種) は 0824a で導入済み、registry はそこから導出
- deferred 02 との関係: 02 が StorageKeys facade を進めるが、registry は AiConfig facade の先行実装として位置づけ可能。02完了後は AiConfig.getModel(provider) に統合
- リスク: OpenAIProvider の削除は影響範囲広いため、旧クラスは @deprecated shim として1スプリント残置も可

## Definition of Done
- [x] 全BDDシナリオがテストで検証され PASS
- [x] type-check / lint / test PASS
- [x] 新プロバイダ追加手順を docs に1行追記 (registry 1行追加)
