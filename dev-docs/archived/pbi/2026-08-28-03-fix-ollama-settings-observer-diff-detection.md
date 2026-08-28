# PBI: Ollama設定Observerに前回値比較を追加し冗長なupdateDynamicRules発火を防止

## ユーザーストーリー
サービスワーカー開発者として、`OLLAMA_BASE_URL` の設定変更時のみOrigin削除ルールを再登録してほしい、なぜなら現在のObserverは任意の設定変更（プロバイダ切替、ドメインフィルタ等）のたびに `chrome.declarativeNetRequest.updateDynamicRules` を呼んでおり、永続化IPCの無駄遣いになるから。

## 優先度
- 順位: 2 / 3
- RICEスコア: 380（Reach=全ユーザー / Impact=2=不要IPC削減 / Confidence=95% / Effort=0.5人週）
- 根拠: サービスワーカーは頻繁にwakeするため、設定変更のたびに不要なDNR書き込みが蓄積する。前回値比較は小修正で効果大。
- 依存: Finding 1（initiatorDomains）と独立。

## BDD受け入れシナリオ

```gherkin
Scenario: OLLAMA_BASE_URLを変更した場合のみsyncFnが呼ばれる
  Given Observerが登録されている
  When  OLLAMA_BASE_URLが 'http://localhost:11434/v1' から 'http://new-host:11434/v1' に変更される
  Then  syncFnが 'http://new-host:11434/v1' で呼ばれる

Scenario: OLLAMA_BASE_URL以外の設定変更ではsyncFnが呼ばれない
  Given Observerが登録されている
  When  LM_STUDIO_BASE_URLが変更される
  Then  syncFnは呼ばれない

Scenario: OLLAMA_BASE_URLが同じ値で再保存された場合はsyncFnが呼ばれない
  Given Observerが登録されている
  When  OLLAMA_BASE_URLが 'http://localhost:11434/v1' のまま再保存される
  Then  syncFnは呼ばれない
```

## 受け入れ基準
- [ ] `createOllamaSettingsObserver` が前回の `OLLAMA_BASE_URL` 値をクロージャで保持し、変化時のみ `syncFn` を呼ぶ
- [ ] 同一値の再保存では `syncFn` が呼ばれない
- [ ] `OLLAMA_BASE_URL` が未設定（`undefined`）の場合、`syncFn` は呼ばれない
- [ ] 既存テストに「同一値で再保存しても呼ばれない」ケースを追加
- [ ] `SettingsRepository.observe` の動作（`newValue` 全体を渡す）を考慮した設計

## テスト戦略
- 単体: 既存の `ollamaSettingsObserver.test.ts` に以下を追加
  - 同一値で2回呼び出し、2回目は `syncFn` が呼ばれないこと
  - 初回呼び出しで `syncFn` が呼ばれ、2回目で値が変わらなければ呼ばれないこと
  - 値が `undefined` → 有効URL → `undefined` の変遷で正しく挙動すること

## 見積もり
1ポイント

## Definition of Done
- [ ] 前回値比較ロジックが実装され、既存テスト + 追加テストがパスする
- [ ] コードレビュー完了
