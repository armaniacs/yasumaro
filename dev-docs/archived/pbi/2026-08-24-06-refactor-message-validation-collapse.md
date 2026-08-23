---
name: Message 検証を MessageRouter に一本化
type: refactor
priority: 6
rice:
  reach: 10
  impact: 1
  confidence: 0.5
  effort: 0.75
  score: 6.7
depends_on: []
---

## 現象
検証が2箇所で異なる綴り。`ExtensionMessage` union vs `VALID_MESSAGE_TYPES` 配列 vs `isServiceWorkerRequest` が3ソース。`messageHandler.ts` の ad-hoc 検査と `MessageRouter.ts` の `validators` Map が分割。`message-types-consistency.test.ts` が regex で配列を照合し脆い。

## なぜなぜ分析
1. なぜ検証が二重か → 歴史的に関数とクラスで別実装
2. なぜ3ソースか → union / 配列 / 型ガードが手書きで同期
3. なぜ deletion test が重要か → messageHandler の検査を消して no-op にできるか確認したいため
→ 解: `MessageRouter.dispatch` に検証を一本化（trust + `MessageValidator`）。`VALID_MESSAGE_TYPES` を `ExtensionMessage['type']` から const assertion で導出し手書き配列を廃止。

## 受け入れ基準
- `messageHandler.ts` の ad-hoc 検査が削除され `MessageRouter` に統合
- `VALID_MESSAGE_TYPES` が union から導出（手書き配列なし）
- `src/messaging/__tests__/message-types-consistency.test.ts` 等が合格

## BDD シナリオ
```gherkin
Scenario: 未知の message type はルーターで拒否
  Given  type "UNKNOWN_TYPE" のメッセージ
  When  MessageRouter.dispatch を呼ぶ
  Then  エラーで拒否される

Scenario: 信頼レベル不正な送信元はガードされる
  Given  content-script からのみ許可される type
  And   送信元が popup
  When  MessageRouter.dispatch を呼ぶ
  Then  セキュリティガードで拒否される
```

## DoD
- [ ] 検証を MessageRouter に統合
- [ ] VALID_MESSAGE_TYPES を union から導出
- [ ] type-check / lint / test が PASS

## 結果: deferred（見送り）
message 検証は trust/security 層（`senderTrust`・`MessageValidator`・protocolVersion）に直結しており、統合を誤ると未検証メッセージの通過や dispatch 破損のセキュリティリスクがある（RICE Confidence 0.5、副作用あり）。既存の `message-types-consistency.test.ts`（regex 照合）は脆いものの動作しており、崩す価値がリスクを上回らない。単独で型レベルの `satisfies` 表明へ置換する作業として次スプリントに分離する。

**アーカイブ日**: 2026-08-24（未実装のまま `dev-docs/archived/pbi/` へ移動。次スプリントで再開予定）
