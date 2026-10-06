# PBI: masterPassword の自己検証+rehash を keyring seam に一本化する

## ユーザーストーリー

マスターパスワード機能の保守担当者として、verify + rehash の政策が 1 本になっていてほしい。auth-modal 経路が keyring seam 外の生キー書込で hash のみ更新（KDF iterations 更新なし）し、stored-iterations 定数時間経路と組み合わさると正しいパスワードが拒否され得るから。

## 優先度

- 順位: 11/17
- RICE: 2.4（R3 / I2 / C0.8 / E2）
- 根拠: セキュリティ特性の drift（同一概念の 2 実装）。設計判断（どちらの語義を正とするか）が残るため C 0.8
- 依存: なし

## 背景（file:line 現状）

- auth-modal 経路: `src/utils/masterPassword.ts:117-127` — rehash が `chrome.storage.local.set({ master_password_hash: newHash })`（生文字列キー・単一フィールド・KDF iterations 更新なし・非原子）
- canonical: `src/utils/storage/encryptionSession.ts:689-695` — `{ [StorageKeys.MASTER_PASSWORD_HASH]: newHash, [StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS]: ENVELOPE_ITERATIONS }` を原子に書く
- 3 つ目の自己検証: `encryptionSession.ts:796-808`（removeMasterPasswordUnlocked、stored-iterations 定数時間経路）
- 定数時間経路は stored iterations を専用使用: `src/utils/crypto/primitives.ts:493-498` → hash を ENVELOPE_ITERATIONS で再生成しつつ stored count が古いままだと次の verify が正しいパスワードを拒否し得る
- 浅い adapter: `src/utils/masterPasswordUiCore.ts:48-52`（`buildGetStorageFn()` — deletion test で即消える）
- 宣言: `dev-docs/DESIGN_SPECIFICATIONS.md:100` — keyring は `storage/encryptionSession.ts`

## BDD受け入れシナリオ

```gherkin
Scenario: auth-modal の verify+rehash が keyring seam 経由になる
  Given legacy hash で設定済みのマスターパスワード
  When auth-modal で verify に成功する
  Then hash と KDF iterations の両方が原子に更新される

Scenario: dashboard が生 storage 関数を組み立てない
  Given masterPasswordUiCore の buildGetStorageFn
  When keyring seam の自己検証関数に統一する
  Then buildGetStorageFn が削除され dashboard/masterPassword.ts が seam を呼ぶ
```

## 受け入れ基準

- [ ] encryptionSession（keyring seam）に自己検証+rehash 関数を 1 本公開する
- [ ] `src/utils/masterPassword.ts` の rehash 書込を seam 経由に寄せ、生文字列キー書込を削除
- [ ] `buildGetStorageFn` を削除し `src/dashboard/masterPassword.ts:311,365` の消費を seam に追従させる
- [ ] KDF iterations 更新の語義（ENVELOPE_ITERATIONS への更新）が canonical と一致する
- [ ] set / change / remove / auth-modal の 4 経路で rehash 政策が同一であることを pin するテストを追加
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/utils/storage/__tests__/`（encryptionSession 系実在テストに追従）に 4 経路の rehash pin を追加
- fixture 先行: stored-iterations が古いまま rehash された状態で verify が拒否される現バグを再現してから直す
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] 手動確認: 実ブラウザでマスターパスワードの auth-modal 検証（legacy hash → rehash → 再 verify）が成功する
