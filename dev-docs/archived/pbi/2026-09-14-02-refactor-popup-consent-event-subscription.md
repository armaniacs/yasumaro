# PBI: Popupの同意状態通知を単発コールバックからイベント購読へ移行する

**作成日**: 2026-09-14
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**種別**: ♻️リファクタリング（refactor）

---

## 背景

`privacyConsentController.ts` は module-scoped な単発コールバック
`onConsentCallback`（`setConsentCallback()` で登録、accept/decline 時に
一度だけ呼ばれて `null` に戻る）を持つ。「テスト用コールバック設定」と
コメントされているが、`popup.ts` が本番の初期化フローでも使用している。

このコールバックは初期化順序に依存する。`popup.ts` は `initPopup()` 内で
オンボーディングウィザード表示判定を一度実行した後、末尾で
`setConsentCallback(...)` を呼んで登録する。この構造は過去に2つの不具合を
引き起こした。

- `a81d8c1c`: consent承諾直後にonboardingウィザードが表示されない問題
- `707f647f`: recordBtn の onclick が初回ロード時に未配線だった問題

`privacyConsentController.ts` はすでに `notifyConsentStateChanged()` で
`CONSENT_STATE_CHANGED` を `chrome.runtime.sendMessage` でブロードキャストして
おり、Service Worker側はこれを購読してツールバーバッジを更新している
（`src/background/handlers/MessageRouter.ts` 経由）。Popup側はこのメッセージを
一切購読していない。同じ情報を「単発コールバック」と「ブロードキャスト」の
二重経路で持つ必要はなく、購読方式に一本化する。

## 受け入れ基準

- [x] `privacyConsentController.ts` から `onConsentCallback`（nullable な単発
      コールバック）と `setConsentCallback` を削除する
- [x] `popup.ts` が `chrome.runtime.onMessage` で `CONSENT_STATE_CHANGED` を
      購読し、オンボーディング表示判定（`maybeShowOnboardingWizard`）を
      呼び出すようになる
- [x] `setConsentCallback` を使っていた既存テスト
      （`privacyConsentController.test.ts`, `privacyConsentController-r2.test.ts`,
      `popup.test.ts`）を新しい購読方式（`chrome.runtime.onMessage` 経由の
      イベント発火）に移行する
- [x] `resetRecordButton`（唯一の書き手）が load/finish パスで確実に
      呼ばれることを回帰確認する（`recordSession.ts` 側は変更不要だが、
      呼び出し保証を崩さないこと）
- [x] `notifyConsentStateChanged()` が送出するブロードキャストの既存契約
      （メッセージ形式 `{ type: 'CONSENT_STATE_CHANGED', protocolVersion }`）は
      変更しない

## Definition of Done

- [x] `npm run type-check` がグリーン
- [x] popup関連のユニットテスト（`privacyConsentController.test.ts`,
      `privacyConsentController-r2.test.ts`, `popup.test.ts`）がグリーン
- [x] コミット済み
