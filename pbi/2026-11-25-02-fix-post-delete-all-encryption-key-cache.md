# PBI: 全データ削除・鍵変更後に他コンテキストの暗号化キーキャッシュが残留する不具合を修正する

## ユーザーストーリー
Yasumaro の全データ削除やマスターパスワード解除を行った利用者として、ブラウザや拡張機能を再起動しなくても、直後に再設定した Webhook URL や API キーが Service Worker 側で正しく復号・利用できてほしい、なぜなら現状は Dashboard 側で `clearAllLocalData()` (`chrome.storage.local.clear()`)を実行しても Service Worker のメモリ内 `cachedEncryptionKey` / `cachedMasterPassword` / `cachedHmacSecret` が破棄されず、直後に保存した暗号化設定の復号が SW 再起動まで fail-closed で失敗し続けるから。

## 優先度
- 発見元: PBI 2026-11-24-08(正式版前の実機スモークテスト、`npm run smoke:ga` Chrome 158 実機検証で項目 8 → 9 → 10 連続実行時に検出)
- RICE スコア: 12.0(Reach 6 × Impact 2 × Confidence 1.0 ÷ Effort 1 = 12.0)
  - Reach 6: 全データ削除・マスターパスワード切替を利用する全ブラウザ利用者
  - Impact 2: 全データ削除直後の再設定(Webhook URL / API キー)が Service Worker 再起動まで無音で失敗する実害を解消
  - Confidence 1.0: `src/utils/storage/encryptionSession.ts:569` の `if (cachedEncryptionKey) return cachedEncryptionKey;` とコンテキスト間無効化欠如が原因と確定
  - Effort 1: `chrome.storage.onChanged` による鍵素材変更検知 + `clearAllLocalData()` 側の即時クリア + 単体テスト追加
- 依存: PBI 2026-11-24-08 の完了・GA 提出前に解消

## ビジネス価値
- 全データ削除後・マスターパスワード解除後の同一セッション内で、新しく保存した Webhook URL や API キーが即座に Service Worker から復号・利用できる
- 他コンテキスト(Dashboard / Popup)での鍵ローテーション・削除が Service Worker のメモリキャッシュと乖離しない
- 測定方法: 単体テストで他コンテキストの `storage.local.clear()` / 鍵素材変更後に `getOrCreateEncryptionKey()` が新しい鍵を導出することを検証し、実機スモークでも削除直後の Webhook 復号が成功することを確認する

## BDD受け入れシナリオ

```gherkin
Scenario: 別コンテキストで全データ削除(chrome.storage.local.clear)が起きたら、キャッシュ済み暗号化キーが破棄される
  Given Service Worker コンテキストで getOrCreateEncryptionKey() が旧キーをキャッシュしている
  When  chrome.storage.onChanged が local エリアの encryption_salt / encryption_secret 削除(または master_password_enabled 削除)を通知する
  Then  Service Worker 内の cachedEncryptionKey・cachedMasterPassword・isMasterPasswordRequired・cachedHmacSecret がクリアされる
  And   次の getOrCreateEncryptionKey() は新しいストレージ内容から新しいキーを導出する

Scenario: clearAllLocalData() を呼んだ自コンテキストでもキャッシュが即時破棄される
  Given 自コンテキストで暗号化キーがキャッシュされている
  When  clearAllLocalData() を実行する
  Then  chrome.storage.local.clear() 後に clearEncryptionKeyCache() が実行され、古いキーが返されない

Scenario: マスターパスワード設定時(master_password_enabled が true へ変化)はセッション中のパスワードキャッシュを壊さない
  Given マスターパスワード設定処理中に master_password_enabled が true に書き込まれる
  When  storage.onChanged が master_password_enabled: { newValue: true } を通知する
  Then  cachedEncryptionKey は再導出のためクリアされるが、アンロック済み cachedMasterPassword は保持される
```

## 受け入れ基準
- [x] `src/utils/storage/encryptionSession.ts` に鍵素材キー(`encryption_salt` / `encryption_secret` / `master_password_enabled` / `master_password_salt` / `master_password_hash` / `master_password_kdf_iterations` / `hmac_secret`)の変更・削除を検知してメモリキャッシュを無効化する `handleEncryptionStorageChange` と `chrome.storage.onChanged` 購読がある
- [x] `clearAllLocalData()`(`src/utils/storage/storageMaintenance.ts`)が `chrome.storage.local.clear()` 後に `clearEncryptionKeyCache()` を呼ぶ
- [x] `master_password_enabled` が削除または falsy に変化したときは `cachedMasterPassword` と `isMasterPasswordRequired` も同時にクリアされる
- [x] 既存の暗号化・ローテーション・ロック関連単体テストがすべて緑のまま維持される
- [x] 新規単体テストで上記 3 シナリオを検証している
- [x] `npm run validate` が緑(文字種検査を含む)

## テスト戦略(t_wadaスタイル)

### E2E / 実機スモークテスト
- 配布用ビルド(`OW_E2E_PROBE=0`)で `npm run smoke:ga` を実行し、全データ削除直後に保存した Webhook URL が同一 SW 内で正常復号・送信されることも含めて確認する

### 統合テスト
- 実機 Chrome / Edge / Firefox の GA スモークで確認する

### 単体テスト
- `src/utils/storage/__tests__/encryptionSession-cache-invalidation.test.ts` を新設し、赤を確認してから実装する:
  1. `local` の `encryption_salt` / `encryption_secret` 変更通知で旧キーキャッシュが破棄され、新シークレットから別キーが導出される
  2. `master_password_enabled` が削除(`newValue: undefined`)された通知で `cachedEncryptionKey` / `cachedMasterPassword` / `isMasterPasswordRequired` がすべてクリアされる
  3. `master_password_enabled` が `true` に変わっただけの通知では `cachedMasterPassword` を消さない
  4. `session` や `sync` エリアの変更通知や無関係なキー変更ではキャッシュを破棄しない
  5. `clearAllLocalData()` が `chrome.storage.local.clear()` 後にキャッシュを破棄する

## 実装アプローチ
- **Outside-In / Red-Green-Refactor**: 再現単体テストを先に書いて赤を確認 → `encryptionSession.ts` に `handleEncryptionStorageChange` + `chrome.storage.onChanged` 購読、`storageMaintenance.ts` の `clearAllLocalData()` に `clearEncryptionKeyCache()` 呼び出しを実装(緑)→ 全テスト検証

## 見積もり
1 ストーリーポイント

## 技術的考慮事項
- `storageMaintenance.ts` と `encryptionSession.ts` はともに `@layer 1`(`src/utils/storage/`)であり、`encryptionSession.ts` は `storageMaintenance.ts` に依存しないため循環依存は発生しない
- テスト環境で `chrome.storage.onChanged` が未モックの場合でも安全に動作するようガードする

## Definition of Done
- [x] 全 BDD シナリオが単体テストで検証されている
- [x] `npm run validate` が緑
- [x] 実機 3 ブラウザスモークで暗号化・バックアップ復元・全削除・Webhook が緑
- [x] 文書は Shift-JIS 範囲の文字のみ(`npm run check:docs-chars` 緑)

## 引き継ぎ
状態: 完了(2026-11-25)。`encryptionSession.ts` に `handleEncryptionStorageChange` + `chrome.storage.onChanged` 購読を追加、`storageMaintenance.ts` の `clearAllLocalData()` に即時キャッシュ破棄を追加、`encryptionSession-cache-invalidation.test.ts`(5/5) および `npm run validate`(1,366 ファイル / 19,224 テスト) 全緑を確認済み。
