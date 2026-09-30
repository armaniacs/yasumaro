# PBI: マスターパスワード設定済み状態での set 経路を旧パスワード検証なしに禁止する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを設定済みのユーザーとして、旧パスワードを知らない主体が設定を上書きできない状態を目指す。なぜなら、dashboard の checkbox 不整合から「設定済みなのに set モーダルが開く」経路が実在し、service 層に ENABLED チェックも旧パスワード検証も無いため、salt/hash/enabled が丸ごと上書きされてしまうから。

## 優先度

- 順位: 2 / 13
- RICE スコア: 12.0(Reach=2 / Impact=3 / Confidence=1.0 / Effort=0.5)
- 根拠: 乗っ取りという重大事象に対し、service 層ガード単体で成立する防御。UI 側の不整合修正(順位 7)に依存しない。

## 証拠(レビュー由来・配線を直接確認済み)

- `src/dashboard/masterPassword.ts:327-330` — change ハンドラが `if (isChecked) { this.showPasswordModal('set'); }` で設定状態を判定せず set モーダルを開く
- `src/dashboard/masterPassword.ts:249-258` — `closePasswordAuthModal` が `masterPasswordEnabled.checked` を復元しないため「OFF 表示 + storage は ENABLED」の desync が生じる(乗っ取りの前提条件)
- `src/dashboard/masterPassword.ts:217-218` — set 分岐は `setMasterPasswordService(password)` に旧パスワードを渡さない
- `src/utils/storage/encryptionSession.ts:565-570` — `setMasterPassword` は `MASTER_PASSWORD_ENABLED` を読まず、`:458` は新パスワードの policy 検査のみ
- `src/utils/storage/encryptionSession.ts:380-384` — ciphertext が無い場合 fast path で `resolveKeys` が呼ばれず旧 KEK 検証が発生しない
- `src/utils/storage/encryptionSession.ts:482-488` — `MASTER_PASSWORD_SALT/HASH/ENABLED/IS_LOCKED` を上書き
- 対比: `changeMasterPassword` は `:676` で `unlockWithPassword(oldPassword)` を必ず通す

## BDD 受け入れシナリオ

```gherkin
  Scenario: 設定済み状態で旧パスワードなしの set は拒否される
    Given マスターパスワードが設定済みである
    When setMasterPassword(新しいパスワード) が呼ばれる
    Then 専用エラーで拒否される
    And MASTER_PASSWORD_SALT/HASH/ENABLED/IS_LOCKED は一切変更されない

  Scenario: 未設定状態の set は従来どおり成功する
    Given マスターパスワードが未設定である
    When setMasterPassword(新しいパスワード) が呼ばれる
    Then 既存 API キーが新 KEK へ再暗号化され metadata が書かれる

  Scenario: dashboard は設定済み状態で set モーダルを開かない
    Given マスターパスワードが設定済みである
    When checkbox が ON にされる
    Then set モーダルの代わりに change フロー(旧パスワード認証)へ誘導される
```

## 受け入れ基準

- [x] `encryptionSession.setMasterPassword` 冒頭で `MASTER_PASSWORD_ENABLED` を検査し、設定済みなら書き込み前に専用エラーで失敗する
- [x] ciphertext が無い場合(fast path `:380-384`)でもガードが有効(ガードは reencrypt の外側に置く)
- [x] dashboard の set モード開始(`:327-330`、`:352-354`)が設定状態を検査し、設定済みなら change 認証へ誘導する
- [x] エラーメッセージは i18n 2 言語(en/ja)で追加し、既存キーを流用しない
- [x] 既存テスト(`encryptionSession-reencrypt.test.ts` 等)が green を維持する

## テスト戦略

### E2E
- 設定済み状態で checkbox を OFF→cancel→再 ON→保存し、metadata が不変であることを検証する

### 統合
- `setMasterPassword` が ENABLED=true で専用エラーを投げ、storage が不変であることを検証する

### 単体
- ガードの分岐(ENABLED true/false)を検証する

## 実装アプローチ

1. service 層: `setMasterPassword` 冒頭(または `rotateToNewMasterPassword` 手前)で ENABLED を読み、true なら専用エラー(MasterPasswordAlreadySetError 相当)を投げる
2. dashboard: `showPasswordModal('set')` の呼び出し箇所で `isMasterPasswordSet()` を確認し、設定済みなら change 認証モーダルへ誘導する
3. UI 状態の desync 自体の修正は順位 7 の PBI に分離(本 PBI は service ガードで防御を完了させる)

## 制約

- async/await のみ。ESM import は `.js` 拡張子
- 例外や UI メッセージにパスワード値・復号結果を含めない

## 見積もり

2 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [x] i18n 更新済み(en/ja)
