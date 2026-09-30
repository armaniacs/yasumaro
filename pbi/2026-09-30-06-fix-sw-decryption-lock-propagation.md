# PBI: SW での復号キー導出失敗を握りつぶさずロック状態として伝搬する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを有効化したユーザーとして、バックグラウンドの AI 呼び出しや Obsidian 保存が「Bearer [object Object]」「API key is missing」のような原因不明の失敗にならず、ロック中であることが明示されたい。なぜなら、service worker には `cachedMasterPassword` を書く経路が存在せず、キー導出の throw が握りつぶされて ciphertext がそのまま `apiKey` として使われるから。

## 優先度

- 順位: 6 / 13
- RICE スコア: 4.8(Reach=2 / Impact=3 / Confidence=0.8 / Effort=1.0)
- 根拠: 機能全壊級の重大度だが、修正はエラー伝搬・型検証・UI 誘導の組立であり工数は中。失敗モードの「沈黙」が最も悪い部分。

## 証拠(レビュー由来・配線を直接確認済み)

- `src/utils/storage/settingsMigration.ts:441-443` — `keyProvider()` の呼び出しが try 内
- `:481-484` — catch が logError のみで `return { settings: merged, ... }`、`merged` は `EncryptedData` のまま
- `src/background/compositionManifest.ts:112` — `new SettingsRepository(new SettingsChromeStorageAdapter())` で keyProvider 注入なし
- `src/utils/storage/SettingsRepository.ts:77-79` — フォールバックで `getOrCreateEncryptionKey` を動的 import
- `src/utils/storage/encryptionSession.ts:531-533` → `:129-130` — SW では `cachedMasterPassword` が null のため必ず throw
- `unlockWithPassword` の本番呼び出しは `encryptionSession.ts:676`(`changeMasterPassword`)のみ — background/popup/messaging にアンロック経路なし(grep で確認)
- `src/background/ai/RemoteAIService.ts:65` — `this.repo.getAll()`
- `src/background/ai/providers/OpenAIProvider.ts:69` — `this.apiKey = s[entry.apiKeyKey] as string | undefined`(型検証なし)→ `Bearer [object Object]`
- `src/utils/obsidianConfigBuilder.ts:80` — `typeof apiKey !== 'string'` で誤解を招く「API key is missing」エラー

## BDD 受け入れシナリオ

```gherkin
  Scenario: ロック中の AI 呼び出しは明示的なロックエラーで失敗する
    Given マスターパスワードが有効で service worker がロック状態である
    When AI 呼び出しが行われる
    Then リクエストは送信されずロックを示すエラーコードで失敗する
    And Authorization ヘッダに ciphertext 由来の値が使われない

  Scenario: Obsidian 保存もロックを理由として失敗する
    Given 同じロック状態である
    When Obsidian への保存が行われる
    Then ロックを示すエラーで失敗する
    And 「API key is missing」とは表示されない
```

## 受け入れ基準

- [ ] `applyMigrationsAndDecryptWithReEncrypt` がキー導出失敗を握りつぶさず、ロック状態を示すシグナル(結果フィールドまたは専用エラー)を返す
- [ ] `OpenAIProvider` を含む apiKey 消費者が、string 以外の値を黙って使わず明示エラーにする
- [ ] ロック状態のエラーが UI(dashboard/popup)まで届き、解除を促す文言になる(既存の unlock 経路が SW に無い点を含め、ユーザー向けガイダンスを定義する)
- [ ] 既存の decrypt 成功パスと migration 挙動は変えない

## テスト戦略

### 統合
- マスターパスワード有効 + ロック状態で AI 呼び出し・Obsidian 保存がロックエラーになることを検証する
- ciphertext が Authorization ヘッダに使われないことを検証する

### 単体
- `applyMigrationsAndDecryptWithReEncrypt` のキー導出失敗時の返却形を検証する

## 実装アプローチ

1. `settingsMigration` の catch を「ロック系エラー」と「その他」に分類し、ロック系は専用シグナルを返す(握りつぶし廃止)
2. `OpenAIProvider` 等の消費者で型検証を追加し、非 string は鍵未取得として扱う
3. ロック状態のエラーコード(`ENCRYPTION_LOCKED` 系)を UI 向け文言に接続する
4. ユーザーがロックを解除できる導線の有無を調査し、無ければ解除導線の設計を本 PBI 内で文書化する(SW に unlock メッセージを足すか、dashboard 誘導にするか)

## 制約

- ロック状態で平文キーが露出する挙動を導入しない
- async/await のみ。ESM import は `.js` 拡張子

## 見積もり

3 SP

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] ロック時のユーザー向け文言が i18n(en/ja)で整備される
- [ ] コードレビュー完了
