# PBI: providerRegistry の SSRF 検証と layer 違反を解消する

## ユーザーストーリー
セキュリティ担当者として、AI プロバイダの baseUrl が内部ネットワークへ SSRF できないように検証したい、なぜならユーザが `http://169.254.169.254` 等を入力した際にクラウドメタデータが漏洩するリスクをゼロにしたいから。併せて providerRegistry の layer 違反を正し、循環 import を未然に防ぎたい

## 優先度
- 順位: 4 / 9
- RICEスコア: 32.7（Reach=7 / Impact=2 / Confidence=70% / Effort=0.30w）
- 根拠: SSRF は潜在的高リスクだが PoC は未確認。Layer 違反は将来の債務。Effort 小で 03 と並列可。

## ビジネス価値
- OWASP Top10 の SSRF リスクを潰し、セキュリティ監査での指摘を 0 にできる
- LAYERS.md と実装の乖離を解消し、新規参入者が誤った依存を作らない

## BDD受け入れシナリオ

```gherkin
Scenario: メタデータサービス URL が拒否される
  Given ユーザが baseUrl に `http://169.254.169.254/latest/meta-data/` を入力する
  When RemoteAIService が fetch しようとする
  Then URL バリデータが拒否し、エラーメッセージ「許可されていないホストです」が返る

Scenario: localhost の http は許可される
  Given lm-studio の default `http://127.0.0.1:1234/v1` を使う
  When 検証を走らせる
  Then 許可され、ローカル LLM が正常に呼び出される

Scenario: layer 違反が CI で検出される
  Given providerRegistry が storage/types に依存している
  When `eslint --rule import/no-restricted-paths` を実行する
  Then layer 違反がエラーとして検出される
```

## 受け入れ基準
- [ ] `RemoteAIService` または `providerRegistry` 解決後に `urlUtils` の allowlist で host/protocol を検証
- [ ] `http://169.254.169.254` / `http://metadata.google.internal` が拒否されるテストがある
- [ ] `127.0.0.1` / `localhost` の http は許可される
- [ ] `providerRegistry.ts` の `@layer` が LAYERS.md と一致し、CI で import 制限が有効

## テスト戦略

### 統合テスト
- providerRegistry の各 entry で baseUrl バリデーションが通る/拒否されるケースのパラメタライズドテスト

### 単体テスト
- `isAllowedProviderUrl()` の unit test で Allow/Deny リストを網羅

## 見積もり
2pt

## 技術的考慮事項
- 依存関係: なし。ただし 02 の ProviderStrategy と同時変更時はコンフリクトに注意
- 非機能要件: SSRF 対策はセキュリティ要件。http の扱いは localhost のみ例外

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "PROVIDER_REGISTRY\|defaultBaseUrl" src/background/ai/providerRegistry.ts
grep -rn "urlUtils\|isValidUrl" src/utils/
cat dev-docs/LAYERS.md
```

### 実装手順
1. `src/utils/urlUtils.ts` に `isAllowedProviderUrl(url)` を追加（allowlist: https + http の localhost/127.0.0.1 のみ）
2. `RemoteAIService` の fetch 前または `providerRegistry` 解決直後に検証を挿入
3. `providerRegistry.ts` の `@layer` を 1 に昇格するか、ProviderId 型を `src/background/ai/types.ts` に分離し LAYERS.md を更新

### 落とし穴
- `http://localhost:11434` を一律拒否すると Ollama ユーザが壊れる。localhost 例外を必ず残す
- `built-in-ai` は baseUrl 不要なので検証対象外にする

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] セキュリティレビュー完了（Red Team 観点の再確認）
- [ ] ドキュメント更新済み（LAYERS.md, docs/SETUP_GUIDE の baseUrl 章）
