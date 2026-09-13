# PBI: CONSENT_STATE_CHANGEDメッセージにconsented値を含める

## ユーザーストーリー
拡張機能の開発者として、`CONSENT_STATE_CHANGED`メッセージにconsentの実際の値（accept/decline）を型として含めたい、なぜなら現在は`notifyConsentStateChanged()`がaccept/declineどちらの場合も同一メッセージを送信しており、この「値を積まず受信側が状態を読み直す」という契約がコード上どこにも型やコメントで保証されていないため、将来別の目的でこのメッセージを購読する開発者が区別不能に気づかず実装してしまうリスクがあるため。

## 優先度
- 順位: 02 / 4
- RICEスコア: 8.0（Reach=開発者(将来の購読者) × Impact=1 × Confidence=100% / Effort=0.5人日）
- 根拠: adversarial-code-reviewで裏取り済み（messageTypes.ts:127-129で`ConsentStateChangedMessage`型がtypeのみでconsent値を持たないことを確認、旧`setConsentCallback(consented: boolean)`が型で強制していた区別がリファクタで消えたことも確認）。型定義とpayload追加のみで実装コストは小さい。依存関係なし。

## 制約
- 既存の受信側（`popup.ts`）の「メッセージ受信時に`getPrivacyConsent()`で状態を読み直す」動作は変えない（後方互換のため、`consented`フィールドの追加は既存ロジックを壊さない）
- `CURRENT_PROTOCOL_VERSION`を上げる必要があるかは、メッセージ形式の破壊的変更に該当するかどうかを実装時に判断する（フィールド追加のみなら不要と想定）

## BDD受け入れシナリオ

```gherkin
Scenario: 同意受諾時にconsented:trueを含むメッセージが送信される
  Given ユーザーがプライバシー同意モーダルで「同意する」を選択した
  When handleAcceptConsent が notifyConsentStateChanged を呼ぶ
  Then 送信されるメッセージは { type: 'CONSENT_STATE_CHANGED', consented: true, protocolVersion } である

Scenario: 同意拒否時にconsented:falseを含むメッセージが送信される
  Given ユーザーがプライバシー同意モーダルで「拒否する」を選択した
  When handleDeclineConsent が notifyConsentStateChanged を呼ぶ
  Then 送信されるメッセージは { type: 'CONSENT_STATE_CHANGED', consented: false, protocolVersion } である

Scenario: 既存の受信側はconsented値を無視しても正しく動作する
  Given popup.ts の既存リスナーが CONSENT_STATE_CHANGED を受信する
  When メッセージに consented フィールドが追加されている
  Then 既存の「状態を読み直す」ロジックは変更なしに正しく動作する
```

## 受け入れ基準
- [ ] `src/background/messageTypes.ts`の`ConsentStateChangedMessage`型に`consented: boolean`フィールドを追加する
- [ ] `notifyConsentStateChanged()`が呼び出し元から`consented`引数を受け取り、メッセージに含めて送信するようになる
- [ ] `handleAcceptConsent`が`notifyConsentStateChanged(true)`を、`handleDeclineConsent`が`notifyConsentStateChanged(false)`を呼ぶ
- [ ] 既存の`popup.ts`側の受信ロジック（状態を読み直す設計）が変更なく動作し続けることを回帰テストで確認する

## テスト戦略
- E2E: 既存のポップアップonboardingフローE2Eをそのまま再実行し回帰がないことを確認
- 統合: `handleAcceptConsent`/`handleDeclineConsent`から送信されるメッセージのpayloadを検証
- 単体: `notifyConsentStateChanged(true)`/`notifyConsentStateChanged(false)`それぞれの送信内容

## 見積もり
1ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
