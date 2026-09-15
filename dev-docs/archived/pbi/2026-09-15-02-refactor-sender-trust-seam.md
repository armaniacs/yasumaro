# PBI: 送信者検証 seam の一本化 — AuthorizedSqliteSender

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、送信者検証ポリシーが1箇所に集約された state がほしい。なぜなら Firefox 移植で生まれた二重綴りと sender 捏造は、Chrome/Firefox で判定が乖離する・セキュリティレビューで検証根拠が読み取れないという correctness リスクだから。

## 優先度

- 順位: 1 / 全候補数 11
- RICEスコア: 48.0（Reach=6 / Impact=2 / Confidence=80% / Effort=0.2人週）
- 根拠: Firefox 移植が導入した構造的負債で、修正が小さく（1日）leverage が全呼び出しに及ぶ。セキュリティ seam に関わるため他候補より優先

## 背景（診断結果）

- 「content script を拒否する」ポリシーが2つの綴りで存在: `src/background/handlers/senderTrust.ts:46-48` のローカル再定義 vs `src/utils/extensionOrigin.ts:47-49` の共有関数（senderTrust.ts:37 は extensionOrigin のみ import し判定関数は import していない）
- `src/background/InPageOffscreenTransport.ts:44-51` が `sender = { id: chrome.runtime.id, url: getURL('background.js') }` を**捏造**して offscreen 側検証を通過させている。`src/offscreen/offscreen.ts:24-28` の `AuthorizedSqliteSender` ブランド型の保証が空洞化
- deletion test: InPage を削除しても offscreen 側検証は何も壊れない = 検証が transport に依存していない = seam が切断されている

## 実装ガイド

1. **`authorizeOffscreenSender(sender)` を新設**（`src/utils/extensionOrigin.ts` の隣、または senderTrust.ts 内）: `sender` を受けて `AuthorizedSqliteSender | null` を返す単一関数。内部で `isContentScriptSender` + id 照合を行う
2. **`senderTrust.ts` のローカル `isContentScriptSender` を削除**し、共有関数に一本化（senderTrust.ts:46-48）
3. **`offscreen.ts` の送信者チェックを委譲**: `src/offscreen/offscreen.ts:75-92` の sender 検証を `authorizeOffscreenSender` 経由にする
4. **`InPageOffscreenTransport` に internal seam を追加**: `dispatchAuthorized(msg, proof: AuthorizedSqliteSender)` — 捏造 sender ではなく、生成時に取得した承認証明を渡す。interface 上「in-process 呼び出しは検証済み」を明示
5. `createOffscreenTransport()` の firefox 分岐で、`offscreen.js` の import から `handleOffscreenMessage` と併せて authorize 関数を取得し transport に渡す

### 触ってはいけないもの

- `AuthorizedSqliteSender` ブランド型の定義（`src/offscreen/offscreen.ts:24-28`）は移動可だが意味は不変
- envelopePolicy の accept 判定（本 PBI は sender trust のみ）

## BDD受け入れシナリオ

```gherkin
Scenario: Firefox の拡張ページ送信者が正しく承認される
  Given firefox ビルドでダッシュボードがタブ内で動作している
  When  DASHBOARD_SQLITE メッセージが送信される
  Then  拡張オリジン識別により承認され、authorized sender として処理される

Scenario: content script からの偽装が拒否される
  Given tab と https URL を持つ sender が SQLITE メッセージを送る
  When  authorizeOffscreenSender が呼ばれる
  Then  null が返り、処理は拒否される
```

## 受け入れ基準

- [x] `senderTrust.ts` 内のローカル `isContentScriptSender` 定義が削除され、共有関数に一本化されている
- [x] `offscreen.ts` の送信者チェックが `authorizeSqliteSender` に委譲されている
- [x] `InPageOffscreenTransport` が sender を捏造せず、承認証明を経由して dispatch している（`createOffscreenTransport` が `authorizeSqliteSender` で proof を生成）
- [x] 既存の senderTrust / offscreen / transport テスト全件が green（41 passed）

## テスト戦略

- 単体: `authorizeOffscreenSender` の境界（moz-extension / chrome-extension / https / no-url）
- 既存: senderTrust.test.ts / offscreen.test.ts / transport テストが回帰網

## 見積もり

1日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（SECURITY_REVIEW_GUIDE の検証点参照先）
