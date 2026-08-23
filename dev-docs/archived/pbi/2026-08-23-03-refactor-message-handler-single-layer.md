# PBI-0823a-03: messageHandler → MessageRouter 1層化

## ユーザーストーリー

開発者として、`messageHandler` の6段 if を `MessageRouter` に吸収し1層化したい。なぜなら `VALID_MESSAGE_TYPES`/`CONTENT_SCRIPT_ONLY_TYPES` と `CONTENT_SCRIPT_ALLOWED_TYPES` が二重 SSOT で、片方更新漏れが脆弱性になり、呼び出し順が `service-worker.ts:179` にハードコードされているから。

## 優先度

- **順位**: 3 / 8
- **RICE**: 360 (Reach 7 × Impact 2 × Conf 80% / Effort 1.1w)
- **根拠**: message 入口の二重層を解消。新 message type 追加が1箇所で完結。依存なし。
- **依存**: なし

## BDD受け入れシナリオ

```gherkin
Scenario: content script からの VALID_VISIT が通る
  Given content script から VALID_VISIT を送る
  When  chrome.runtime.onMessage が発火
  Then  MessageRouter.dispatch で trust/validator/handler が1層で処理される

Scenario: extension-only な message を content script から送ると拒否される
  Given content script から DASHBOARD_SQLITE を送る
  When  dispatch が呼ばれる
  Then  trust check で拒否され handler は実行されない
```

## 受け入れ基準

- [x] `messageHandler.ts` の6段 if（VALID/NO_PAYLOAD/protocol/CONTENT_SCRIPT_ONLY/tabCache）を `MessageRouter` に移譲
- [x] `service-worker.ts:179` を `chrome.runtime.onMessage.addListener((m,s,r)=>router.dispatch(m,s,r))` の1行に
- [x] `VALID_MESSAGE_TYPES`/`NO_PAYLOAD_TYPES` の重複チェックを `validators.ts` に一本化（既存 validator へ委譲済みの重複を削除）
- [x] `CONTENT_SCRIPT_ONLY_TYPES`（旧2要素）を削除し `CONTENT_SCRIPT_ALLOWED_TYPES` のみに統一
- [x] `npm run type-check` / `npm test` PASS

## テスト戦略

- **統合**: message 19 types × trust/validator の組み合わせテスト
- **単体**: MessageRouter.dispatch の trust 拒否 / validator 拒否 / 正常 dispatch

## 見積もり

5pt（1.1人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] messageHandler.ts が削除または thin wrapper のみ
- [x] コードレビュー完了
