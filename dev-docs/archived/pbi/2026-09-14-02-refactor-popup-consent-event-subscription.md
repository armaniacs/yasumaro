# PBI: Popup の consent→onboarding をイベント購読方式へ

## ユーザーストーリー
拡張機能のエンドユーザーとして、プライバシー同意直後に確実にオンボーディングウィザードが表示されてほしい、なぜなら現在は `privacyConsentController` の module-scoped な単発コールバック（`onConsentCallback`）に依存しており、初期化順序が変わると同意直後にウィザードが表示されない不具合（a81d8c1c）や record ボタンが未配線になる不具合（707f647f）が発生しているため。

## 優先度
- 順位: 02 / 4
- RICEスコア: 8.0（Reach=全ユーザー(初回起動フロー) × Impact=2 × Confidence=80% / Effort=2人日）
- 根拠: 初回起動体験に直結し影響は大きいが、既存の `CONSENT_STATE_CHANGED` ブロードキャストの活用可否を popup.ts 側で確認する必要がありConfidenceはやや控えめ。依存関係なし。

## 制約
- `notifyConsentStateChanged()` が既に送出している `CONSENT_STATE_CHANGED` ブロードキャストの既存契約（メッセージ形式）を変えない
- `onConsentCallback`（テスト用と明記されたコメントがあるが本番でも使用中）の廃止に伴い、既存のテストダブル経由のテストが壊れないよう移行する
- `recordSession.ts` の `resetRecordButton`（唯一の書き手）が load/finish パスで確実に呼ばれることも同時に保証する

## BDD受け入れシナリオ

```gherkin
Scenario: 同意直後にオンボーディングウィザードが表示される
  Given ユーザーがプライバシー同意モーダルで「同意する」を選択した
  When privacyConsentController が CONSENT_STATE_CHANGED をブロードキャストする
  Then popup がそのイベントを購読しオンボーディングウィザードを表示する

Scenario: 初回ロード時に record ボタンが配線されている
  Given popup が初めてロードされた
  When loadCurrentTab() が完了する
  Then resetRecordButton が呼ばれ record ボタンのクリックハンドラが有効になっている

Scenario: 初期化順序が入れ替わってもオンボーディング表示が壊れない
  Given popup.ts のロード処理順序が将来変更される
  When 同意イベントが発火する
  Then module-scoped な単発コールバックに依存せず、イベント購読により常にウィザードが表示される
```

## 受け入れ基準
- [x] `privacyConsentController.ts` から `onConsentCallback`（nullable な単発コールバック）を削除する
- [x] `popup.ts` が `CONSENT_STATE_CHANGED` を購読し、オンボーディング表示判定を行うようになっている
- [x] `setConsentCallback` を使っていた既存のテストが新しい購読方式に移行されている
- [x] `5e96b3cd` で追加された fixture 回避策（`onboarding_wizard_completed: true` の事前投入）が不要になった場合は整理する（回帰確認のみで既存のまま維持）

## テスト戦略
- E2E: 同意モーダル承諾 → オンボーディングウィザード表示のフローを再検証
- 統合: `CONSENT_STATE_CHANGED` 発火 → popup 側ハンドラ呼び出しの確認
- 単体: `resetRecordButton` が load/finish 各パスで確実に呼ばれることの確認

## 見積もり
5ポイント（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
