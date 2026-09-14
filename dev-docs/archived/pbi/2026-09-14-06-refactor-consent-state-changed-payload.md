# PBI: CONSENT_STATE_CHANGEDのaccept/decline区別不能を解消する

## ユーザーストーリー
拡張機能の開発者として、`CONSENT_STATE_CHANGED`メッセージの受信側がaccept/declineを区別できるようにしたい、なぜなら現在は`notifyConsentStateChanged()`がaccept/declineどちらの場合も完全に同一のメッセージを送信しており、この「値を積まず受信側が状態を読み直す」という契約がコード上どこにも型やコメントで保証されていないため、将来別の目的でこのメッセージを購読する開発者が区別不能に気づかず実装してしまうリスクがあるため。

## 優先度
- 順位: 02 / 4
- RICEスコア: 8.0（Reach=開発者(将来の購読者) × Impact=1 × Confidence=100% / Effort=0.5人日）
- 根拠: adversarial-code-reviewで裏取り済み。旧`setConsentCallback(consented: boolean)`が型で強制していた区別がリファクタで消えたことを確認済み。依存関係なし。

---

## 重要: 当初想定と異なる調査結果（実装前に必読）

このPBIを書いた時点では「メッセージに`consented: boolean`フィールドを足すだけ」と想定していたが、**調査の結果それは SSOT に阻まれることが判明した**。

`CONSENT_STATE_CHANGED` は `src/background/messageTypes.ts:249-260` の `NO_PAYLOAD_TYPES` に登録されており、以下3箇所で「payloadを持たない」ことが機械的に強制されている:

1. **実行時の enforcement** — `src/background/handlers/envelopePolicy.ts:119-123`
   `NO_PAYLOAD_TYPES` に含まれる型は payload チェックをスキップする分岐にある。
2. **型レベルの固定** — `src/messaging/types.ts:278` の `PayloadForType<'CONSENT_STATE_CHANGED'>` は `never` に解決される。
3. **契約テスト** — `src/__tests__/messaging-types-uniformity.test.ts:147-158`
   ```typescript
   test('CONSENT_STATE_CHANGED has never payload — bare envelope passes guard, any payload is rejected', () => {
     type Payload = PayloadForType<'CONSENT_STATE_CHANGED'>;
     const assertNever: never = 1 as Payload;   // ← コンパイル時チェック
     expect(NO_PAYLOAD_TYPES).toContain('CONSENT_STATE_CHANGED');
     expect(isServiceWorkerRequest({ type: 'CONSENT_STATE_CHANGED', payload: {} })).toBe(false);  // ← payload は明示的に reject
   });
   ```

つまり `payload: { consented: true }` を足すと、このテストが落ちる。**テストを書き換えて通すのは、SSOTが守っている設計（「このメッセージはトリガーであって状態通知ではない」）を壊すことになるため、安易にやらないこと。**

## 実装方針: 2案から選択する

### 案A（推奨・低コスト）— 契約をコードに明示して型で守る

payload は追加せず、「このメッセージは値を運ばない意図的なトリガーである」ことを**コード上の明示的な契約**にする。当初の懸念（将来の購読者が区別不能に気づかない）は、気づける形にすれば解消できる。

変更対象:

1. `src/background/messageTypes.ts:127-129` の型定義にドキュメントコメントを追加

```typescript
/**
 * Consent accept/decline トリガー。
 *
 * INTENTIONAL: このメッセージは consent の「値」を運ばない。accept でも
 * decline でも同一の bare envelope が送られる（NO_PAYLOAD_TYPES 登録済み・
 * PayloadForType は never）。受信側は必ず getPrivacyConsent() で
 * chrome.storage から現在の状態を読み直すこと。
 *
 * 理由: consent 状態の SSOT は chrome.storage であり、メッセージに値を
 * 載せると「メッセージ到達順とストレージ書き込み順の不一致」で古い値を
 * 信じる経路が生まれる。値が必要なら storage を読む。
 */
type ConsentStateChangedMessage = {
    type: 'CONSENT_STATE_CHANGED';
};
```

2. `src/popup/privacyConsentController.ts:166-174` の `notifyConsentStateChanged` に同趣旨の短いコメントを追加（accept/decline 双方から呼ばれ、区別を載せないことが意図的だと分かるように）

3. `src/popup/popup.ts:91` のリスナーの型注釈 `(message: { type?: string })` を、SSOTの型を使う形に締める:
   ```typescript
   import type { ExtensionMessage } from '../background/messageTypes.js';
   // ...
   chrome.runtime.onMessage.addListener((message: Partial<ExtensionMessage>) => {
   ```
   （`ExtensionMessage` の正確なエクスポート名・場所は `messageTypes.ts` で確認すること。存在しなければこの項目はスキップ可）

4. 契約テストを追加 — `src/popup/__tests__/privacyConsentController.test.ts` に
   「accept と decline が同一形状のメッセージを送る（区別を載せない）ことが意図的な契約である」ことを pin するテストを追加:
   ```typescript
   it('sends an identical bare envelope for both accept and decline (INTENTIONAL: value lives in storage)', async () => {
     // accept 経路と decline 経路それぞれで sendMessage の引数を捕捉し、
     // 完全に同一形状であることを assert する
   });
   ```

案Aの工数: 0.5人日。SSOTと衝突しない。

### 案B（非推奨・要合意）— NO_PAYLOAD_TYPES から外して値を載せる

どうしてもメッセージで値を運びたい場合、以下すべての改修が必要:

- `messageTypes.ts`: `ConsentStateChangedMessage` に `payload: { consented: boolean }` を追加し、`NO_PAYLOAD_TYPES` から `'CONSENT_STATE_CHANGED'` を削除
- `src/__tests__/messaging-types-uniformity.test.ts:147-158`: テスト全体を書き換え
- `src/messaging/__tests__/types.test.ts:179-181`: `NO_PAYLOAD_TYPES` 由来のループテストへの影響を確認
- `src/background/__tests__/message-types-consistency.test.ts:95-96`: 同上
- `src/background/handlers/MessageRouter.ts:182` の `createConsentStateChangedHandler` とその引数検証
- `src/background/handlers/__tests__/consentStateChanged.test.ts` / `senderTrustCoverage.test.ts`

案Bの工数: 1.5〜2人日。**採用するならプロトコルバージョンを上げるかどうかの判断も必要**（`CURRENT_PROTOCOL_VERSION`）。既存の受信側（service-worker のバッジ更新ハンドラ）が bare envelope を前提にしているため、後方互換の検討も要る。

**このPBIは案Aで着手すること。** 案Bが必要になる具体的なユースケース（メッセージで値を運ばないと実装できない機能）が出てきた時点で、別PBIとして起票する。

---

## 制約
- `NO_PAYLOAD_TYPES`（`messageTypes.ts:249`）の登録は変更しない（案A採用時）
- 既存の受信側（`popup.ts:91-95` の「状態を読み直す」ロジック、service-worker のバッジ更新）の動作は変えない
- `src/__tests__/messaging-types-uniformity.test.ts` の `CONSENT_STATE_CHANGED` テストは通したまま維持する

## BDD受け入れシナリオ

```gherkin
Scenario: メッセージ型定義を読めば値を運ばない意図が分かる
  Given 開発者が ConsentStateChangedMessage の型定義を読む
  When accept/decline の区別を載せるべきか判断しようとする
  Then 「値は載せない・受信側は storage を読む」という設計判断とその理由がコメントで明示されている

Scenario: accept と decline が同一形状のメッセージを送ることがテストで固定される
  Given handleAcceptConsent と handleDeclineConsent がそれぞれ実行される
  When 送信された chrome.runtime.sendMessage の引数を比較する
  Then 両者は完全に同一の形状である（この同一性が意図的な契約としてテストで pin されている）

Scenario: 既存の受信側の動作は変わらない
  Given popup.ts の既存リスナーが CONSENT_STATE_CHANGED を受信する
  When 同意受諾後にメッセージが届く
  Then getPrivacyConsent() で状態を読み直してオンボーディング判定する既存動作が維持される
```

## 受け入れ基準
- [x] `messageTypes.ts` の `ConsentStateChangedMessage` に「値を運ばない意図・理由・受信側の責務」を説明するドキュメントコメントを追加する
- [x] `privacyConsentController.ts` の `notifyConsentStateChanged` に、accept/decline双方から呼ばれ区別を載せないことが意図的だと分かるコメントを追加する
- [x] `privacyConsentController.test.ts` に「accept と decline が同一形状のメッセージを送る」ことを pin する契約テストを追加する
- [x] `src/__tests__/messaging-types-uniformity.test.ts` の既存テストが変更なくパスする（SSOTを壊していないことの確認）
- [x] `npx vitest run src/popup src/background src/messaging src/__tests__` が全件green

## テスト戦略
- E2E: 既存のポップアップonboardingフローE2E（`testDir/e2e/usability/popup-onboarding-flow.spec.ts`）をそのまま再実行し回帰がないことを確認
- 統合: `handleAcceptConsent`/`handleDeclineConsent` から送信されるメッセージ形状の同一性を検証
- 単体: `notifyConsentStateChanged` が bare envelope（`{ type, protocolVersion }` のみ）を送ることの確認

## 見積もり
1ポイント（案A採用時。案Bなら3ポイント）（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
