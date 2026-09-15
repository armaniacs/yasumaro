# PBI: KdfNegotiator — KDF 交渉の3箇所手書き集約

## ステータス: ⬜ 未着手（順位1 / RICE 20.0 / 台帳: 2026-09-15-00-backlog-archloop-0915b.md 候補3）

## ユーザーストーリー

メンテナとして、暗号鍵の KDF iteration 交渉（stored iterations → SSOT → legacy）が1つの深い module に集約されていてほしい。なぜなら同一問題（「600k 現行と 100k legacy のどちらで導出した鍵か」）を4箇所が各々解いており、1箇所の修正漏れが「復号不能＝APIキー喪失」に直結するから。

## 優先度

- 順位: 1 / 本バッチ4件中
- RICEスコア: 20.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.4人週）
- 根拠: 復号不能＝APIキー喪失という最悪障害の予防。Strong（診断で長期 KDF 変更の leverage が明示）

## 背景（診断結果）

- 同一問題を4箇所が各々解いている:
  1. `src/utils/crypto/primitives.ts:339-366` — `verifyPasswordWithPBKDF2` が新旧**両方**の hash を計算して比較
  2. `src/utils/storage/settingsMigration.ts:86-135` — `tryDecryptWithLegacyFallback` が `importKey` + `deriveKey` + `atob` を手書き（master 有効時は諦める）
  3. `src/utils/settingsExportImport.ts:269-291` — `decryptWithFallback` が stored → SSOT → legacy の3候補を逐次試行
  4. `src/utils/storage/encryptionSession.ts:59-75,193,233` — `deriveKeyFromPassword` が `primitives.deriveKey` を使わず独自導出 + iteration 解決
- `src/utils/crypto/envelope.ts:31-39` の `EncryptionEnvelope` は `iterations` を自己記述する一方、legacy の `EncryptedData` 形式には iteration が載らない → 交渉が呼び出し側に拡散

## 実装ガイド

1. **`src/utils/crypto/kdfNegotiator.ts` を新設**:
   ```ts
   export interface KdfNegotiationResult {
     text: string;
     usedIterations: number | null;   // legacy 形式は iteration 不在 → null
     needsRehash: boolean;            // legacy で復号成功 → 再暗号化推奨
   }
   /** EncryptionEnvelope（iterations 自己記述）と legacy EncryptedData（iteration 不在）
    *  の両方を受け、SSOT 現行 → legacy の順で KDF を交渉して復号する。 */
   export async function decryptWithKdfNegotiation(
     stored: unknown, password: string
   ): Promise<KdfNegotiationResult>
   ```
   - envelope 判定は `envelope.ts` の型ガードを使用
   - legacy 形式: SSOT 現行 iterations → legacy 100k の順で `deriveKey` + `decrypt` を試行（`settingsExportImport.decryptWithFallback` の3候補ロジックを移植）
2. **`settingsExportImport.decryptWithFallback` を委譲に置換**: 手書きの3候補ループを削除し、`decryptWithKdfNegotiation` 1呼び出しに
3. **`settingsMigration.tryDecryptWithLegacyFallback` を委譲に置換**: master 有効時の諦め条件（86-135）は呼び出し側判断として維持 — 交渉は復号のみ
4. **回帰**: legacy 100k / 現行 600k / master 有効の3パターンテストが既存にあることを確認（無ければ settingsMigration/ExportImport のテストから移植）

### 触ってはいけないもの

- `encryptionSession.deriveKeyFromPassword` の独自導出（本 PBI のスコープ外 — KdfNegotiator に寄せるかは別判断）
- envelope 形式自体の変更（iteration 自己記述は不変）
- `verifyPasswordWithPBKDF2` の API パスワード検証ロジック（PBI 02 で整理済みの新旧2回計算 — KdfNegotiator はデータ復号のみ）

## BDD受け入れシナリオ

```gherkin
Scenario: 現行 iterations の envelope が復号される
  Given 600k iterations で暗号化された EncryptionEnvelope がある
  When  decryptWithKdfNegotiation に正しいパスワードを渡す
  Then  復号成功し usedIterations=600k / needsRehash=false が返る

Scenario: legacy 100k の EncryptedData がフォールバックで復号される
  Given 100k iterations（形式に iteration 記載なし）で暗号化されたデータがある
  When  SSOT 600k で失敗した後 legacy 100k を試行する
  Then  復号成功し usedIterations=null / needsRehash=true が返る
```

## 受け入れ基準

- [ ] `kdfNegotiator.ts` が新設され、`decryptWithKdfNegotiation` が envelope/legacy の両形式を処理している
- [ ] `settingsExportImport.decryptWithFallback` と `settingsMigration.tryDecryptWithLegacyFallback` が委譲に置換されている
- [ ] legacy 100k / 現行 600k / master 有効のテストが全件 green
- [ ] crypto 関連テスト全件 green

## テスト戦略

- 単体: kdfNegotiator の3パターン（envelope/legacy/failure）
- 既存: settingsExportImport / settingsMigration / encryptionSession テストが回帰網

## 見積もり

2日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（kdfNegotiator 先頭コメントに交渉順序）
