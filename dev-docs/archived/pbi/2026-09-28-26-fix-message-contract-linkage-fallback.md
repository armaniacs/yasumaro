# PBI: メッセージ契約 linkage の機械化と未登録型の fallback 応答

種別: fix
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ1の一部。契約表と handler 表の非連動、および未登録型の無応答を解消する。

## ユーザーストーリー

新規メッセージ型を追加する開発者として、型の追加と handler 登録の齟齬をコンパイル時またはテスト時に検出でき、未知の型が静かに握りつぶされない状態を目指す。

## 優先度

- 順位: 3 / 7
- RICE スコア: 10.8（Reach=6 / Impact=2 / Confidence=90% / Effort=1.0）
- 根拠: port-closed エラーは再現困難な不具合を生む。consistency テストの拡張は低コストで linkage を保証できる

## 現状と問題（file:line 証拠付き）

- 契約表が4箇所に分散: `src/background/messageTypes.ts:223`（`ExtensionMessage` union）/ `:267`（`VALID_MESSAGE_TYPES`）/ `:303`（`CONTENT_SCRIPT_ALLOWED_TYPES`）/ `:310`（`NO_PAYLOAD_TYPES`）。handler 表は `src/background/handlers/MessageRouter.ts:134` の Map
- `src/background/__tests__/message-types-consistency.test.ts` は契約表同士の整合しか見ておらず、router/handler への言及がない。型追加と handler 登録の齟齬は機械的に検出されない（`GET_CONTENT` の意図的除外のような例外は allow-list 化が必要）
- 未登録型は `MessageRouter.ts:239-241` で `false` を返すが、`src/background/messageHandler.ts:91-93` が戻り値を捨てて `true` を返すため `sendResponse` が呼ばれない。送信側は「The message port closed before a response was received」になる

## BDD 受け入れシナリオ

```gherkin
Scenario: 型と handler の齟齬がテストで検出される
  Given VALID_MESSAGE_TYPES にある型に対応する handler がない（allow-list 除外を除く）
  When consistency テストを実行する
  Then テストが FAIL する

Scenario: 未知の型に fallback 応答が返る
  Given 未登録のメッセージ型を受信する
  When dispatch が false を返す
  Then `sendResponse({ success: false, ... })` が呼ばれ、port-closed エラーにならない
```

## 受け入れ基準

- [x] consistency テストが `VALID_MESSAGE_TYPES` × handler Map の包含検査を行い、意図的除外（`GET_CONTENT` 等）を allow-list として明示する
- [x] `messageHandler.ts` が dispatch の `false` に対して fallback のエラー応答を返す（既存の `createErrorResponse` 形式に従う）
- [x] `MessageRouter.ts:142` 周辺の doc（handler/validator 数の記述）が実態と一致する

## テスト戦略

- 単体: consistency テストの拡張（allow-list の意図的除外を含む Red/Green 確認: allow-list から外すと FAIL すること）
- 統合: 未登録型の dispatch → fallback 応答の経路テスト

## 見積もり

1.0 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [x] `npm run validate` が通る
