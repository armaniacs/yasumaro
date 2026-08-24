# PBI: AI Provider を stringly typed dispatch から ProviderId union + Registry に移行

## ユーザーストーリー
開発者として、AI プロバイダを文字列 ID で識別するのをやめたい。なぜならコンパイル時に無効なプロバイダ ID が検出できず、プロバイダ追加時に登録・ラベル・CSP・dashboard の 4 箇所を手動同期する必要があるから。

## 優先度
- 順位: 03 / 全候補数 7
- RICEスコア: 11.2（Reach=7 / Impact=2 / Confidence=80% / Effort=1人週）
- 根拠: 7 プロバイダが対象。プロバイダ追加コストの低減。type safety 向上。

## BDD受け入れシナリオ

Scenario: ProviderId union が compile-time に検証する
  Given `ProviderSlot.provider: string` で AI プロバイダが識別されている
  When `ProviderId = 'gemini' | 'openai' | 'openai2' | 'lm-studio' | 'ollama' | 'openai-compatible' | 'built-in-ai'` を導入する
  Then `provider: 'invalid-provider'` は TypeScript エラーになる
  And `ProviderSlot.provider: ProviderId` に変更される

Scenario: ProviderRegistry がモデル解決を一元化する
  Given `resolveModelKey(provider: string)` が 4 箇所に散在している
  When `ProviderRegistry` にモデル解決を集約する
  Then 新規プロバイダ追加時は registry 登録のみで完了する
  And `resolveModelKey` の個別 if 分岐が削除される

## 受け入れ基準
- [ ] `ProviderId` union type が定義されている
- [ ] `ProviderSlot.provider` が `ProviderId` に変更されている
- [ ] `RemoteAIService` の `Map<string, factory>` が `ProviderRegistry` に置換されている
- [ ] `registerProvider` が private で `ProviderRegistry` 内に隠蔽されている
- [ ] `resolveModelKey` が registry から導出される
- [ ] 既存 AI テストが全てパスする
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: 全 7 プロバイダの summarization が既存テストで検証されていることを確認
- **単体**: `ProviderRegistry` の登録・解決・フォールバックテスト
- **契約**: `ProviderId` union に無効な文字列を代入した場合の型エラー検証（`tsd` または型テスト）

## 見積もり
1 ストーリーポイント（低 — 1 人週程度）

## 技術的考慮事項
- **依存**: なし（SettingsRepository shim の完了を待たない）
- **テスタビリティ**: `ProviderRegistry` は pure factory なので、テストは registry をモックするだけで全プロバイダを差し替え可能
- **非機能要件**: プロバイダ追加コストの低減（4 箇所 → 1 箇所）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "provider: string" src/utils/storage/types.ts
grep -n "resolveModelKey" src/utils/aiModelKey.ts
grep -n "registerDefaultProviders" src/background/ai/RemoteAIService.ts
```

### 実装手順
1. `src/utils/ai/ProviderId.ts` を新設し union type を定義
2. `ProviderSlot` の `provider` を `ProviderId` に変更
3. `ProviderRegistry` を新設し `register` / `resolve` / `getModelKey` を実装
4. `RemoteAIService` の `Map<string, factory>` を `ProviderRegistry` に置換
5. `resolveModelKey` を registry メソッドに統合
6. 既存テストを `ProviderId` に更新

### 落とし穴
- `BuiltInAiProvider` は `RemoteAIService` 内と `LocalAIService` の両方でラップされている。二重登録を避けるため、registry は単一インスタンスを共有する。
- dashboard の `providerLabel(provider: string)` も `ProviderId` に合わせて更新する。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
