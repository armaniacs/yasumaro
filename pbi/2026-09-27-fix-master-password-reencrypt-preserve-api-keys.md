# PBI: マスターパスワードの KEK 切替時に API キーを再暗号化して保持する

種別: fix
状態: 未着手

上流: `dev-docs/archived/pbi/2026-09-25-27-investigate-master-password-removal-reencrypt.md`（裁定記録。本 PBI はその裁定の仕様化であり、裁定内容に変更しない）

## ユーザーストーリー

マスターパスワードを設定・変更・解除したのに、暗号化済み API キーが読めなくなり、認証情報を一から入力し直す被迫になるユーザーとして、KEK を切り替えるどの操作でも API キーが保持される状態を目指す。

## 優先度

- RICE スコアは上流 PBI 完了後に再採点する（裁定時点の上流 RICE は 0.33 / 3 SP）

## BDD 受け入れシナリオ

```gherkin
  Scenario: 解除後も API キーが読める
    Given マスターパスワードで暗号化された 6 フィールドの API キーが保存されている
    When ユーザーがマスターパスワードを解除する
    Then 6 フィールドが匿名 KEK で再暗号化され、解除後もすべて読み出せる
    And 認証メタデータと IS_LOCKED が最終状態に更新される

  Scenario: 設定・変更のKEK 切替でも保持される
    Given 匿名 KEK で暗号化された API キーが保存されている
    When ユーザーがマスターパスワードを設定する、または変更する
    Then 6 フィールドが新しい KEK で再暗号化され、引き続き読み出せる

  Scenario: 復号不能な項目があれば解除を中止する
    Given 復号できない ciphertext が 1 つでも含まれる
    When ユーザーが KEK 切替操作を行う
    Then 操作を中止し再認証を促す
    And 認証メタデータと元 ciphertext が一切変更されない
    And 値を空文字で上書きしない

  Scenario: 解除失敗時は UI がロールバックする
    Given 再暗号化または確認処理が失敗する
    When 失敗が通知される
    Then エラーが表示され、チェックボックスは checked のまま維持される
    And 完了メッセージは表示されない

  Scenario: 途中終了から再開できる
    Given Service Worker が再暗号化途中または確認直後に終了する
    When 次の操作として処理を再開する
    Then 永続化された状態から読み直して同じ値へ到達する
    And cached password や module state を前提にしない
```

## 受け入れ基準

- [ ] `setMasterPassword` / `changeMasterPassword` / `removeMasterPassword` の 3 経路が、同一の再暗号化手順を共有する。
- [ ] 対象は `API_KEY_FIELDS` の 6 フィールド（`provider_api_key` と `github_pat` を含む）で、canonical 一覧の複製を作らない。
- [ ] nested `settings` blob と legacy scattered key の両方を独立に検出し、存在する側を再暗号化してから認証メタデータを更新する。
- [ ] 復号不能が 1 件でもあれば、認証メタデータに触れず処理を中止し、空文字上書きをしない。
- [ ] 再暗号化後に新 KEK で read back して復号できることを確認し、その確認が通るまで認証メタデータを更新しない。
- [ ] `settings` への書き込みは repository の delta write 契約に従い、古い snapshot を書き戻さない。
- [ ] dashboard から直接 `chrome.storage.local.remove()` する経路を廃止し、service 関数を呼ぶ。
- [ ] 解除成功時の `IS_LOCKED` と認証メタデータの最終状態を service と dashboard で一致させる。
- [ ] 失敗時はチェックボックスを元の状態へ戻し、完了メッセージを出さない。
- [ ] i18n キーを 2 つ追加し、`public/_locales/en/messages.json` と `ja` の両方を更新する。`passwordIncorrect` は流用しない。
- [ ] 既存 pin（`dashboard/__tests__/masterPassword.test.ts` の 3 キー直接 remove、`encryptionSession-branch.test.ts` と `storage-security.test.ts` の認証キー検証）を裁定内容へ更新する。
- [ ] ADR `2026-03-24-master-password-data-cleanup.md` を superseded として記録し、「匿名 KEK へ再暗号化」を規定する ADR を追加する。
- [ ] 例外や UI メッセージに API キー値・復号結果・認証情報を含めない。

## テスト戦略

### E2E

- 解除後も各 API キーが読み出せることを確認する。
- 復号不能な ciphertext を含む操作が裁定どおり停止し、認証メタデータと元 ciphertext が保持されることを確認する。
- 解除失敗時にチェックボックスがロールバックされ、成功時だけ認証状態が変わることを確認する。
- Service Worker の終了を復号途中・再暗号化途中・確認直後・認証メタデータ削除前へ注入し、再開後に同じ値へ到達することを確認する。
- set / change / remove の順に実行しても API キーが保持された状態を維持することを確認する。

### 統合

- `src/utils/storage/__tests__/encryptionSession-branch.test.ts` と `src/utils/__tests__/storage-security.test.ts` に canonical 6 フィールドの保持検証を追加する。
- `src/dashboard/__tests__/masterPassword.test.ts:343-377` の直接 remove pin を service 呼び出しの検証へ差し替える。
- `src/utils/__tests__/settingsMigration-unrecoverable.test.ts` の契約を、復号不能時の事前中止へ接続する。
- `src/utils/__tests__/master-password-cleanup.test.ts` は production 経路を呼ばないため、本 PBI の安全性の根拠にしない。

### 単体

- canonical 6 フィールド × 配置 4 状態（nested のみ / scattered のみ / 双方 / なし）の検出を検証する。
- 復号不能 1 件で全体が中止されることを、副作用のない pure logic として検証する。
- 3 経路それぞれで KEK 遷移と、復号確認之前に認証メタデータが変わらないことを検証する。
- 空文字の項目は変換不要として扱われることを検証する。

## 実装アプローチ

1. canonical 一覧を唯一の情報源として、再暗号化処理を 1 つの関数に集約する。
2. 確定手順を固定する: lock 取得 → 両配置から値を取得 → 旧 KEK で復号 → 新 KEK で再暗号化 → delta write → read back で確認 → 認証メタデータ更新 → キャッシュと `IS_LOCKED` 更新。
3. 3 経路をこの手順へ接続し、`removeMasterPassword` を唯一の service 入口にする。
4. dashboard の直接 remove を service 呼び出しへ置き換え、失敗時の checkbox rollback を実装する。
5. i18n キー 2 件を追加し、既存 pin を更新する。
6. ADR を supersede 関係へ更新し、後続 PBI の裁定記録へ引き継ぐ。

## 制約

- async/await のみ。ESM import は `.js` 拡張子。
- 既存 timeout と CSP fetch path を維持し、動的コード実行経路を追加しない。
- repository の delta write 契約を維持する。
- オフライン queue payload へ API キーや認証情報を追加しない。

## 見積もり

3 SP
