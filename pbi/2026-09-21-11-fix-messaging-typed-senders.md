# PBI: utils storage の手書き sendMessage を型付きセンダーに統一し protocol SSOT を直参照する

## ユーザーストーリー
開発者として、utils storage 層の2箇所の手書き `chrome.runtime.sendMessage` を型付きセンダー経由に統一したい、なぜなら手書き送信は payload 形状変更がコンパイル時検査されず、protocol 定数の参照先も compat shim 経由で SSOT から外れているため

## 優先度
- 順位: 10
- 種別: fix
- RICEスコア: 6.0（Reach=3 / Impact=1 / Confidence=1.0 / Effort=0.5週）
- 根拠: 影響範囲は storage 層の2送信と type-only の循環解消に限定されるため Impact は 1 だが、手書き送信は型検査の網外であり protocol 変更時の壊れ方が静かに広がる。Effort が 0.5週と小さいため先に潰す

## ビジネス価値
message 送信経路が型付きセンダーに一本化され、payload 形状変更がコンパイル時に検出される。protocol 定数の参照が SSOT 直参照に戻り、compat shim 経由の二重所有が消える。popup と messaging の型循環が解消され、GET_CONTENT の wire 応答型の所有者が明確になる

## BDD受け入れシナリオ

```gherkin
Scenario: 同意状態変更が型付きセンダー経由で送信される
  Given プライバシー同意が変更される
  When notifyConsentChanged が実行される
  Then CONSENT_STATE_CHANGED が型付きセンダー経由で送信され protocolVersion が付与される

Scenario: 認証成功時のアクティビティ通知が型付きセンダー経由で送信される
  Given マスターパスワード認証が成功する
  When ログイン処理が完了する
  Then ACTIVITY_UPDATE が型付きセンダー経由で送信され送信失敗時は従来通り無視される

Scenario: GET_CONTENT の応答型が messaging 層で解決される
  Given GET_CONTENT メッセージの型解決
  When ResponseForType を読む
  Then ContentResponse が messaging 層所有の型として解決され popup は再エクスポートのみを行う
```

## 受け入れ基準
- [ ] `privacyConsent.ts` の手書き送信が型付きセンダー経由に置き換わる
- [ ] `encryptionSession.ts` の手書き送信が型付きセンダー経由に置き換わる
- [ ] `privacyConsent.ts` の protocol 定数 import が `messaging/protocol.js` 直参照になる
- [ ] `ContentResponse` が messaging 層に移動し popup 側は再エクスポートのみになる
- [ ] popup と messaging の型循環が解消される
- [ ] 実行時挙動が不変で既存テストが green になる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部送信経路の統一と type-only 変更)

### 統合テスト
- 同意変更通知: CONSENT_STATE_CHANGED が正しい protocolVersion 付きで届くこと
- 認証成功通知: ACTIVITY_UPDATE が届くことと送信失敗時の無視挙動が保たれること

### 単体テスト
- 型レベル: payload 形状違いがコンパイルエラーになること(型付きセンダー経由)
- 型レベル: ContentResponse の移動後も popup 経由の import が解決されること
- 循環解消: popup と messaging の相互 import が残らないこと

## 実装アプローチ
- **Outside-In**: 2送信の期待メッセージ型を先に固定し、型付きセンダー呼び出しに置き換えて Red から Green へ
- protocol import は shim 経由から SSOT 直参照へ切り替える
- ContentResponse は messaging 層へ移動し popup 側は type-only 再エクスポートに変える(実行時挙動不変)

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。他の messaging 改修とは独立
- 非機能要件: 実行時挙動不変。送信失敗時の無視挙動(encryptionSession 側の catch)を維持する
- 互換性: ContentResponse の移動は type-only 変更とし、既存の popup 経由 import を壊さないよう再エクスポートを残す

## 実装者向け注記

### 現状の証拠
- 手書き送信1: `src/utils/storage/privacyConsent.ts:331` — `chrome.runtime.sendMessage({ type: 'CONSENT_STATE_CHANGED', protocolVersion: CURRENT_PROTOCOL_VERSION })` を手書き
- shim 経由 import: `src/utils/storage/privacyConsent.ts:13` — `CURRENT_PROTOCOL_VERSION` を `../../background/messageTypes.js` から import。正本は `src/messaging/protocol.ts` で `src/background/messageTypes.ts:22-26` の doc に「正本は `src/messaging/protocol.ts`」「後方互換のために再エクスポート」と明記
- 正しい姉妹例: `src/utils/storage/encryptionSession.ts:9` — `../../messaging/protocol.js` から直参照している
- 手書き送信2: `src/utils/storage/encryptionSession.ts:351` — `chrome.runtime.sendMessage({ type: 'ACTIVITY_UPDATE', protocolVersion: CURRENT_PROTOCOL_VERSION, payload: {} })` を手書き
- 型付きセンダーの迂回: `src/messaging/types.ts:320-332` の `sendServiceWorkerMessage` と `src/messaging/types.ts:348-355` の `sendFromPopup` を両者とも使わず、手書きのため payload 形状変更がコンパイル時検査されない
- 型循環: `src/messaging/types.ts:110` が `import type { ContentResponse } from '../popup/mainTypes.js'`、`src/popup/mainTypes.ts:1` が逆方向の `import type { MaskedItem } from '../messaging/types.js'` — popup と messaging の型循環
- wire 応答型の所有: `src/messaging/types.ts:297` 付近の `T extends 'GET_CONTENT' ? ContentResponse` が popup 所有型で解決される

## Definition of Done
- [ ] 全BDDシナリオ実装+パス
- [ ] コードレビュー完了
- [ ] 統合検証 green
