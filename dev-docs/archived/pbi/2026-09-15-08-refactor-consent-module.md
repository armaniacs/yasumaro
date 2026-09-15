# PBI: consent module の深掘り — 状態遷移の locality 回復

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、同意状態の読み・書き・署名検証・マイグレーション・通知が1つの深い module に集約されていてほしい。なぜなら直近3回の変更（init 非同期化・同意リスナーのイベント化・送信者自身への非配送バグ）がすべて同一 seam の不在に起因し、次の KEK ローテーションやポリシー更新も同じ4ファイルを再び触ることになるから。

## 優先度

- 順位: 3 / 本バッチ3件中
- RICEスコア: 10.7（Reach=4 / Impact=2 / Confidence=80% / Effort=0.6人週）
- 根拠: leverage と locality の両方を最大化。既存テスト（privacyConsent-version / privacyConsentController）が移行の回帰網になる

## 背景（診断結果）

- 真の同意 module（`src/utils/storage/privacyConsent.ts`）の interface が6関数に膨張し、本来 implementation であるべき知識が呼び出し側に漏れている:
  1. **拒否カウンタ**: `src/popup/privacyConsentController.ts:79-116` が `chrome.storage.local` に直読み直書き（`PRIVACY_CONSENT_DENIED_COUNT / LAST_DENIAL_TIME`）。ポリシー更新時のリセット規則（`initPrivacyConsent:56-60`）と対になっているのに所有者が controller
  2. **本文保存フラグ**: `handleAcceptConsent:212-214` が `CONTENT_STORAGE_ENABLED` を直書き。同意の原子性（同意 + 本文保存 + ack の3点セット 216-217）が controller の手続き知識
  3. **通知 fan-out**: `notifyConsentStateChanged:179-186` の `document.dispatch + runtime.sendMessage` 二重配送を `popup.ts:97-104` が両チャネル購読で再実装（過去に送信者自身へ配送されない Chrome 仕様で退行 — CHANGELOG 記録済み）。interface に「購読すれば届く」という不変条件が書けていない
- 1つの状態変更の影響範囲: KEK 変更 → hmacKeyStore → privacyConsent:87-99 → controller → popup の4ファイル

## 実装ガイド

1. **`privacyConsent.ts` を深い module に**:
   ```ts
   interface ConsentStateStore {
     getState(): Promise<PrivacyConsentState>;      // 署名検証込み
     accept(opts: { acknowledgeBodyStorage: boolean }): Promise<void>;  // 同意 + 本文保存 + ack を原子に
     decline(): Promise<void>;                       // 拒否カウンタ更新を内部化
     acknowledge(): Promise<void>;                   // ポリシー更新時の再同意リセット
     subscribe(listener: (state: PrivacyConsentState) => void): () => void;  // 二重配送を内部に隠す
   }
   ```
2. **拒否カウンタを内部化**: controller の `PRIVACY_CONSENT_DENIED_COUNT / LAST_DENIAL_TIME` 直読み直書き（79-116）と reset 規則（56-60）を module 内に移動
3. **本文保存フラグを内部化**: `handleAcceptConsent:212-214` の `CONTENT_STORAGE_ENABLED` 直書きを accept の implementation に
4. **通知 fan-out を subscribe seam に**: `document.dispatch + runtime.sendMessage` の二重配送と、popup.ts の両チャネル購読（97-104）を「購読すれば両チャネル分含めて届く」1つの seam に隠す。Chrome の送信者自身非配送仕様の知識が module 内に閉じる
5. **KEK 不一致時の扱いを不変条件として明文化**: 署名検証失敗 → 未同意 + 再署名（現行動作）を interface ドキュメントに記載
6. **回帰**: privacyConsent-version.test.ts / privacyConsentController.test.ts / offscreen.test.ts（同意リスナー）+ 実機の onboarding 表示確認

### 触ってはいけないもの

- 署名方式（HMAC / KEK チェーン — PBI 09-05 で修正済みの hmacKeyStore/durableKeyStore は触らない）
- offscreen 側の CONSENT_STATE_CHANGED バッジ更新（背景 listener はそのまま）

## BDD受け入れシナリオ

```gherkin
Scenario: 同意の承諾が3点セットを原子に書き込む
  Given 同意モーダルでチェックが入っている
  When  accept を呼ぶ
  Then  consent レコード（署名付き）+ 本文保存フラグ + ack が一貫して書き込まれる

Scenario: 購読者は両チャネルの変更を受け取る
  Given popup と controller の両方が subscribe している
  When  accept が呼ばれる
  Then  document イベント経由でも runtime 経由でも購読者に1回ずつ届く（送信者非配送の仕様が漏れない）
```

## 受け入れ基準

- [x] 拒否カウンタ・本文保存フラグの直読み直書きが `privacyConsent.ts` 内に移動している（controller は `shouldPromptForConsent` / `acceptConsent` / `declineConsent` のみを呼ぶ）
- [x] 通知が `subscribeConsentChanges` seam 1つに統合され、popup.ts の二重購読が解消されている（Chrome の送信者非配送仕様は module 内に隠蔽）
- [x] KEK 不一致時の動作が interface ドキュメントに明文化されている（署名検証失敗 → 未同意 + 再署名の現行動作を不変条件として記載）
- [x] privacyConsent 系テスト全件 green（61 passed + r2 suite 27 passed — 双チャネル notify の pin とカウンタ規則テストを privacyConsent-version.test.ts に移設）+ 実機で onboarding 表示が動作する

## テスト戦略

- 既存: privacyConsent-version.test.ts / privacyConsentController.test.ts / popup 関連テストが回帰網
- 単体: subscribe seam の両チャネル配送テスト（module 内部に隠れた Chrome 仕様の pin）

## 見積もり

2-3日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（privacyConsent.ts 先頭コメントに不変条件）
