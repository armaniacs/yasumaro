# PBI: Localhost AI ポート検証バグ修正

## 問題説明
`src/utils/ssrfGuard.ts` の `validateUrlForAIRequests()` は、URLに明示ポートが無い場合に `http://localhost` → 80、`https://localhost` → 443 と推論する。しかし `ALLOWED_LOCALHOST_PORTS` は `[27123, 27124, 11434, 1234]` のみを許可しているため、ポート未指定の localhost URL は `isLocalhostAddress()` で `false` と判定され、AIリクエストがブロックされる。

## 優先度
- 順位: 01 / 05
- RICEスコア: 480（Reach=40 / Impact=3 / Confidence=100% / Effort=0.25）
- 根拠: ローカルAI(Ollama/LM Studio等)を使用するユーザーのコア機能を完全にブロックする。修正は小さなコード変更で実現可能。

## BDD受け入れシナリオ

Scenario: 明示ポートなしの localhost AI URL が許可される
  Given ユーザーが Ollama を `http://localhost:11434` で運用している
  When ユーザーが AI 設定に URL を保存する
  Then `validateUrlForAIRequests()` はエラーをスローせず、URL を許可する

Scenario: 明示ポートありの localhost AI URL が許可される
  Given ユーザーが LM Studio を `http://localhost:1234` で運用している
  When ユーザーが AI 設定に URL を保存する
  Then `validateUrlForAIRequests()` はエラーをスローせず、URL を許可する

Scenario: 許可されていない localhost ポートはブロックされる
  Given `ALLOWED_LOCALHOST_PORTS` が [27123, 27124, 11434, 1234]
  When ユーザーが `http://localhost:8080` を AI 設定に保存しようとする
  Then `validateUrlForAIRequests()` はエラーをスローする

## 受け入れ基準
- [ ] ポート未指定の `http://localhost` が AI リクエストで許可される
- [ ] ポート未指定の `https://localhost` が AI リクエストで許可される
- [ ] 明示ポートが許可リストにある localhost URL は従来通り許可される
- [ ] 許可リスト外の明示ポートはブロックされる
- [ ] 既存の単体テストがパスする

## テスト戦略
- 単体: `ssrfGuard.ts` の `validateUrlForAIRequests` と `isLocalhostAddress` の境界値テスト追加
- 統合: `fetchWithTimeout` 経由でのローカルAIプロバイダー接続テスト

## 見積もり
0.5ストーリーポイント

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] 関連ドキュメント更新済み
