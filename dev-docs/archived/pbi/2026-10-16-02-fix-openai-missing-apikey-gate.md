# PBI: OpenAI 互換プロバイダの API キー欠落送信を止める

## ユーザーストーリー
クラウド AI 要約の利用者として、API キー未設定のままページ内容が外部へ POST されてほしくない。なぜなら認証なしの送信は 401 になるだけで本文だけが相手に届くから。

## 優先度
- 順位: 02 / 08
- RICEスコア: 96（Reach=20 / Impact=1.5 / Confidence=0.8 / Effort=0.25）
- 根拠: キー未設定で要約実行した全件に波及。Gemini 側は既に gate 済みで対照実装あり。依存なし。

## 背景
adversarial-code-review (2026-10-16) の検証通過指摘 (ハッカー G)。反証で配線確認済み。
- `checkCredentials` が `!this.baseUrl` のみで `apiKey` を見ない (`src/background/ai/providers/OpenAIProvider.ts:177-179,217-223`)。対照的に Gemini は `!this.apiKey` を gate (`GeminiProvider.ts:144,218`)。
- `requiresApiKey` は表示専用で強制なし。`assertApiKeyResolved` は object 型のみ拒否し undefined を通す。
- `RemoteAIService.ts:144-159` / `:362-366` にキー事前 gate なし。cloud 系 id (openai/openai2/openai-compatible) は defaultBaseUrl を持つためキーなしでも送信に至る。送信先は allowlist 拘束下のため深刻度は低〜中。
- 却下済み関連: `isLocalUrl` の `127.evil.com` / `[::1]` 問題は本番到達不能（唯一の呼出は未知 id デッド経路、テスト pin あり）のため対象外。未知 id 直構築・factory 差替も本番到達不能で対象外。

## BDD受け入れシナリオ
Scenario: キー未設定では要約を送信しない
  Given requiresApiKey な id で apiKey 未設定
  When `generateSummary` を呼ぶ
  Then fetch 前に資格エラーで失敗し、リクエストは送信されない

Scenario: キー未設定では接続テストが invalid になる
  Given 同条件
  When `testConnection` を呼ぶ
  Then `success: false` でキー欠落メッセージが返る

Scenario: キー設定済み・ローカル系は従来通り
  Given キーあり openai / キーなし ollama
  When 要約・接続テストを呼ぶ
  Then 従来通り送信される（既存テスト緑）

## 受け入れ基準
- [x] `checkCredentials` が apiKey 欠落を gate し、Gemini と同等の文言方針になる
- [x] `requiresApiKey=false` のローカル系は無キー送信のまま（既存テスト緑）
- [x] `npx vitest run src/background/ai/` 全緑

## テスト戦略
- 単体: 上記シナリオの Red→Green（fetch モックで未送信を assert）
- 既存: provider 全体テストで回帰確認

## 見積もり
0.5 SP（実作業は小さいが文言・既存期待の確認を含む）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
