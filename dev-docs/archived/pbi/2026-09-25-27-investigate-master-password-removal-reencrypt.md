# PBI: マスターパスワード解除時に暗号化済み API キーを失わないようにする

種別: investigate（ADR supersede の裁定 → 実装は `fix`）

## ユーザーストーリー

マスターパスワードを解除したのに、暗号化済み API キーが読めず、認証情報を入力し直す被迫になるユーザーとして、解除後も API キーを保持できる裁定を确立したい。システム管理者として、承認済み ADR、実際の dashboard UI、暗号化ストレージ、既存テストがどの契約に一致するのか調査し、API キーを削除するのか、匿名の secret 系 KEK へ再暗号化するのか、復号不能時はどのように停止するのかを 5 Whys で決定したい。

## ビジネス価値

- マスターパスワード解除によって API キーが復号不能になり、認証情報の再入力を強制する潜在的データ損失を防ぐ。
- ADR の「解除時に API キー暗号化データを削除する」方針と、実際の UI が認証メタデータだけを直接削除する実装の食い違いを解消する。
- 削除、再暗号化、解除中断の候補を同じ事実と受け入れ基準で比較し、恣意的な Architect 方針の選択を避ける。
- `setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` の生命周期的非対称を裁定する。
- nested settings と legacy scattered settings の双方を、再起動と競合に耐える確定手順として定義する。
- 失敗時に認証情報を残し、UI の checkbox を rollback する契約を後続 `fix` に引き継ぐ。

## 優先度

- 順位: 27 / 30
- RICEスコア: 0.33（Reach=1 / Impact=2 / Confidence=50% / Effort=3 SP）— 依存（25 完了後）

## BDD受け入れシナリオ

```gherkin
Feature: マスターパスワード解除時の暗号化済み API キー保護方針の裁定

  Scenario: ADR と実装の乖離から保持方針を裁定する
    Given 承認済み ADR は解除時に API キー暗号化データを削除する方針である
    And removeMasterPassword は認証メタデータだけを削除する
    And 実 UI は認証メタデータを直接削除する
    When 5 Whys によって削除と再暗号化を比較する
    Then API キーを削除する案と匿名の secret 系 KEK で再暗号化する案を裁定する
    And ADR supersede の要否を判定する
    And 採用方針を後続 fix の受け入れ基準へ変換する

  Scenario: 復号不能な ciphertext の扱いを裁定する
    Given API キーの ciphertext が復号不能である
    When マスターパスワード解除時の扱いを裁定する
    Then 解除を中止して再認証を促す案と削除して再入力を求める案の採否を決める
    And unrecoverable ciphertext を空文字で上書きしない
    And 復号と再暗号化が完了するまでは認証メタデータを削除しない

  Scenario: 設定変更と解除のライフサイクルを統一する
    Given setMasterPassword と changeMasterPassword は既存 API キーの再暗号化を行わない
    And removeMasterPassword も既存 API キーの再暗号化を行わない
    When API キー保護方針を 3 つのライフサイクルへ適用する
    Then 6 フィールドの canonical な一覧をすべての経路で共有する
    And 旧 helper の 4 フィールド一覧を複製しない
    And 解除時だけ安全になる非対称を残さない裁定をする

  Scenario: nested settings と legacy scattered settings の切替を裁定する
    Given API キーの暗号文が nested settings と legacy scattered key の双方に存在する
    And 依存 PBI 25 は匿名の KEK と durable secret の形式を前提にする
    When 両配置を再暗号化する確定手順を裁定する
    Then 各配置と各 API キー項目の暗号化状態を確認する
    And repository の delta write と settings 競合の扱いを使う
    And Service Worker が終了しても cached password に依存しない再開規則を定義する
    And すべての配置と項目の確認が完了するまで認証メタデータを削除しない

  Scenario: 解除失敗時の UI と i18n の契約を裁定する
    Given dashboard の解除操作は認証メタデータを直接削除する
    And IS_LOCKED は service 側の処理と異なる
    When 再暗号化または確認処理が失敗する
    Then UI のエラー表示、checkbox の rollback、再認証の案内を裁定する
    And 既存の i18n キーを再利用できるか、追加が必要かを裁定する
    And 成功時だけ認証メタデータと IS_LOCKED の最終状態を確定する
```

## 受け入れ基準

- [x] `dev-docs/archived/pbi/2026-09-25-25-fix-encryption-secret-wrapped-storage.md`（アーカイブ済み）の完了と、匿名 KEK および durable secret の形式が本 PBI の裁定前提になっている。
- [x] ADR の「解除時に API キー暗号化データを削除する」方針と、現在の production 経路が一致していないことを裁定資料の前提に明記している。
- [x] 削除する案と、匿名の secret 系 KEK で再暗号化する案を、データ損失、ADR 整合性、再開可能性、既存契約への影響を同じ観点で比較している。
- [x] ADR supersede の要否と、採用方針を後続 `fix` が参照できる形で確定している。
- [x] 復号不能な ciphertext について、解除を中止して再認証を促す案と、削除して再入力を求める案の採否を裁定している。
- [x] `settingsMigration.ts:129-140` の `unrecoverable` 契約に従い、復号不能な ciphertext を空文字で上書きしない。
- [x] `API_KEY_FIELDS` の 6 フィールドを全経路の canonical な一覧として使う方針を確定し、`provider_api_key` と `github_pat` を含む対象を明示している。
- [x] `src/utils/masterPassword.ts:183-246` の旧 4 フィールド helper を canonical な一覧の複製元として再利用しない裁定をしている。
- [x] `setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` それぞれで、既存 API キーを変換するかを裁定し、ライフサイクル間の非対称の扱いを決めている。
- [x] nested settings と legacy scattered key の双方に存在する場合、各配置を独立に検出し、確定済みの 6 フィールドだけを再暗号化する手順を定義している。
- [x] 匿名 KEK への再暗号化を採用する場合は、各配置の再入性を、依存 PBI 25 の durable secret 形式と既存認証メタデータから判定する規則を定義している。
- [x] 再暗号化と確認の途中で Service Worker が終了しても、module state や cached password を次の操作の前提にしない。
- [x] `settings` の書き込みでは repository の delta write 契約を維持し、依存 PBI 17 とのデータ競合を裁定に含めている。
- [x] 復号、再暗号化、確認完了、認証メタデータ削除の順序を定義し、すべての確認が完了するまで `MASTER_PASSWORD_ENABLED` 等を削除しない。
- [x] dashboard から直接 `chrome.storage.local.remove()` する経路を後続 `fix` でどう置き換えるか裁定している。
- [x] service 側と異なる `IS_LOCKED` を、解除成功時に削除するか最終状態へ変更するか裁定している。
- [x] 解除失敗時の checkbox rollback、エラー表示、再認証案内を裁定している。
- [x] 既存 i18n キーの再利用可否と、意味が一致しない場合のキー追加方針を裁定している。
- [x] 既存 timeout、CSP fetch path、async/await、ESM import の `.js` 拡張子を後続 `fix` の制約へ引き継いでいる。
- [x] オフライン queue payload に関する依存 PBI 12 との競合有無を確認している。
- [x] 調査で与えられた確認済み事実を判断材料として明記し、未確認事項を確定情報として記載していない。
- [x] 本 PBI は ADR supersede の裁定と後続 `fix` の仕様化に限定し、プロダクションコードと既存テストは変更しない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は裁定と仕様化に限定するため、E2E テストは実行しない。
- 後続 `fix` では、依存 PBI 25 完了後の production 経路で、API キーを旧 KEK から確定済みの匿名 KEK へ移し、解除後も各 API キーを読み出せる最小シナリオを定義する。
- 後続 `fix` では、nested settings と legacy scattered key の双方に API キーがある状態で裁定済みの確定手順を通し、両配置の値を維持する。
- 後続 `fix` では、復号不能な ciphertext を含む解除操作が裁定どおり停止し、認証メタデータと元 ciphertext が保持されることを確認する。
- 後続 `fix` では、解除失敗時に dashboard の checkbox が rollback され、成功時だけ認証状態が変わることを確認する。
- 後続 `fix` では、Service Worker の終了を復号途中、再暗号化途中、確認直後、認証メタデータ削除前へ注入し、再開後に中断前と同じ値へ到達することを確認する。
- 後続 `fix` では、`setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` の順に実行しても API キーが裁定済み状態を維持することを確認する。

### 統合テスト

- `src/utils/storage/__tests__/encryptionSession-branch.test.ts:243-256` に、認証キーの消滅だけでなく、裁定済みの API キー状態も確認する契約を追加する。
- `src/utils/__tests__/storage-security.test.ts:529-550` に、`removeMasterPassword()` 後の 6 フィールドを canonical な `API_KEY_FIELDS` で検証する。
- `src/dashboard/__tests__/masterPassword.test.ts:343-377` に、dashboard が直接 remove するのではなく、裁定済み service 経路を呼び、成功時だけ認証状態を更新する UI 契約を追加する。
- `src/utils/__tests__/settingsMigration-unrecoverable.test.ts` の契約を使い、復号不能な ciphertext を空文字へ置換しないことを再暗号化の事前確認へ接続する。
- `src/utils/__tests__/master-password-cleanup.test.ts` は実経路を呼んでいないため、production service を呼ぶ統合テストへ追加するか、後続 `fix` のどのテストが安全性を担保するかを裁定する。
- `settings` nested object と legacy scattered key の双方に値がある fixture で、repository の delta write と裁定済みの競合処理を確認する。
- 依存 PBI 17 の migration 中または競合する settings 更新と組み合わせ、古い ciphertext を新しい値で上書きしない。
- 依存 PBI 12 の offline queue payload が裁定済みの API キー状態へ影響しないことを確認する。
- CSP fetch path と既存 timeout の境界を維持し、復号・再暗号化用の新しい非同期経路が既存契約を壊さないことを確認する。
- 依存 PBI 25 の durable secret と、認証メタデータ削除後の読取経路が整合することを確認する。

### 単体テスト

- canonical `API_KEY_FIELDS` の 6 フィールドすべてに対し、検出、旧 KEK による復号、匿名 KEK による再暗号化、確認処理を検証し、旧 helper の 4 フィールド一覧にない項目が省略されないことを確認する。
- 各 API キーが nested settings のみ、legacy scattered key のみ、双方に存在、未存在の 4 状態を検証する。
- 正常な ciphertext、空文字、復号不能な ciphertext、形式が一致しない ciphertext を裁定どおり分類する。
- 復号不能な項目が 1 つでもあれば、未確認の認証メタデータを削除せず処理を中止することを検証する。
- 各配置の再暗号化後に、裁定済みの匿名 KEK で全項目を読めることを、副作用のない pure logic として検証する。
- 再実行時に、すでに裁定済み状態へ移った項目と、旧 KEK の状態が残る項目を混同しないことを検証する。
- 復号、nested settings delta write、legacy key write、確認、認証メタデータ削除の前後で、例外と再試行が安全であることを検証する。
- 依存 PBI 17 との競合を検出した場合、最新値を保持し、裁定済みの再実行規則へ戻すことを検証する。
- `setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` ごとに KEK の遷移と canonical な 6 フィールドの扱いを検証する。
- 解除成功、解除失敗、再認証後の再試行で checkbox、エラー表示、認証メタデータ、`IS_LOCKED` の状態を検証する。
- 例外や UI メッセージへ API キー値、復号結果、認証情報を含めないことを検証する。

## 実装アプローチ

1. 依存 PBI 25 の匿名 KEK と durable secret の形式を確認し、完了していなければ本 PBI の最終裁定を完了扱いにしない。
2. 依存 PBI 17 の `settings` データ競合と、依存 PBI 12 の offline queue payload 周辺の影響範囲を確認する。
3. 確認済みの production 経路、dashboard の直接 remove、`IS_LOCKED` の差異、6 フィールドの 2 配置を事実表へ整理する。
4. 削除する案と再暗号化する案を、復号不能 ciphertext、認証メタデータ削除順序、ADR 整合性、再開後の継続可能性で比較する。
5. 5 つの決定事項について、確認済み事実だけを使って 5 Whys を行い、裁定、根拠、残存リスクを記録する。
6. 再暗号化を採用する場合は、全項目の事前復号・確認、匿名 KEK への再暗号化、配置ごとの durable な確認、認証メタデータ削除の確定手順を定義する。
7. 復号不能時の停止または削除、3 つのマスターパスワード変更経路、`IS_LOCKED` の扱いについて一貫した契約を定義する。
8. UI の rollback、エラー表示、再認証案内、既存 i18n キーの扱いを選択肢として裁定する。
9. 裁定結果を、別 PBI として扱う `fix` の変更対象、既存 pin の更新対象、Outside-In のテスト順へ変換する。
10. 本 PBI ではコード、既存テスト、ADR ファイルを変更せず、裁定と後続 `fix` の仕様だけを本ファイルへ記録する。

## 見積もり

3 SP

- 確認済み事実と依存関係の整理、ADR と候補方針の比較: 1 SP
- 5 Whys、復号不能時、ライフサイクル、2 配置、再開手順の裁定: 1 SP
- UI・i18n 契約と後続 `fix` のテスト及び変更範囲への変換: 1 SP

## 技術的考慮事項

- 承認済み ADR と production UI の不一致が本裁定の中心であり、ADR の文言だけ、または現行 UI の挙動だけを正として扱わない。
- 依存 PBI 25 が完了するまで、匿名 KEK と durable secret の具体的な保存・取得・再開契約を確定しない。
- API キーの対象は `src/utils/storage/apiKeyFields.ts:15-22` の canonical な 6 フィールドであり、`provider_api_key` と `github_pat` を含む。
- 現行暗号文は nested `settings` object と legacy scattered key の双方に存在し得るため、必要な配置をすべて検出する。
- `src/utils/masterPassword.ts:183-246` の旧 helper は 4 フィールドであり、canonical な一覧の複製にしてはならない。
- `setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` の3経路を同じ API キー契約で裁定する。
- 復号不能な ciphertext は空文字で潰さず、既存の `unrecoverable` 契約を維持する。
- 再暗号化と確認の完了を、認証メタデータ削除の必須前提にする。
- `MASTER_PASSWORD_ENABLED` 等と `IS_LOCKED` を同一の成功判定に含めず、最終状態を裁定する。
- Service Worker はいつでも終了するため、永続化済み形式と再読取を再開規則の根拠にし、cached password を次回の処理へ引き渡さない。
- `settings` への書き込みは delta write を使い、依存 PBI 17 の migration や競合中に古い snapshot を書き戻さない。
- 依存 PBI 12 の offline queue payload へ API キーや認証情報を追加しない。
- 既存 timeout と CSP fetch path を維持し、新しい動的コード実行経路を追加しない。
- 非同期処理は async/await、ESM import は `.js` 拡張子とする。
- 本 PBI は裁定専用であり、実装、既存テスト変更、ADR ファイル更新は後続 `fix` に分離する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/storage/encryptionSession.ts:395-409` の `removeMasterPassword()` は認証メタデータだけを削除し、API キーを復号も再暗号化もしない。
- production 呼び出し元は grep で0件であり、`src/utils/storage.ts:44-48` は re-export のみである。
- 実 UI 経路は `src/dashboard/masterPassword.ts:245-256` で `chrome.storage.local.remove()` を直接実行する。
- service 側と異なり、dashboard の直接 remove 対象には `IS_LOCKED` が含まれない。
- `src/utils/masterPassword.ts:183-246` に旧式の再暗号化処理があるが、canonical な 6 フィールドではなく 4 フィールドで、dashboard からも使われていない。
- `src/utils/masterPassword.ts:263-298` の `setMasterPassword()` と `:381-393` の `changeMasterPassword()` にも、既存 API キーの再暗号化がない。
- `src/utils/storage/apiKeyFields.ts:15-22` が影響する 6 フィールドの canonical な一覧を定義する。
- 現行の API キー暗号文は `settings` nested object と legacy scattered key の双方に存在し得る。
- `dev-docs/ADR/2026-03-24-master-password-data-cleanup.md:18-25,62-118` は「解除時に API キー暗号化データを削除する」方針を承認している。
- `src/utils/storage/__tests__/encryptionSession-branch.test.ts:243-256` は認証キーが消えることだけを pin する。
- `src/utils/__tests__/storage-security.test.ts:529-550` は `removeMasterPassword()` 後の API キーの扱いを検証しない。
- `src/dashboard/__tests__/masterPassword.test.ts:343-377` は dashboard が認証メタデータを直接 remove する UI 契約を pin する。
- `src/utils/__tests__/settingsMigration-unrecoverable.test.ts` は復号不能な ciphertext を空文字で潰さない契約を検証する。
- `src/utils/__tests__/master-password-cleanup.test.ts` は production 関数を呼ばず、シミュレーションのみを検証する。

### 実装手順

1. 依存 PBI 25、17、12 の完了状況と、本 PBI が使用できる契約を確認する。
2. 認証メタデータ、API キー 6 フィールド、nested settings、legacy scattered key、`IS_LOCKED` の関係を確認済みの事実表へ整理する。
3. 「API キーを削除する」「匿名 KEK で再暗号化する」「未再暗号化を検知して解除を中止する」を候補として同じ評価軸で比較する。
4. 5 Whys の各問に対し、確認済み事実、判断材料、採否、ADR への影響、残存リスクを記録する。
5. 復号不能時の成功・中止・削除条件と、認証メタデータ削除の必須前提を確定する。
6. `setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` の KEK 遷移と 6 フィールドの扱いを統一して裁定する。
7. 両 storage 配置に対する事前確認、delta write、durable な確認、競合、再開の順序を裁定する。
8. dashboard の直接 remove を後続 `fix` のどの service seam へ置き換えるか、checkbox、表示、i18n の失敗契約を裁定する。
9. 後続 `fix` の BDD、既存 pin の更新対象、Outside-In のテスト順、E2E/統合/単体テストの担当範囲を具体化する。
10. 裁定結果だけを本 PBI へ反映し、コード、テスト、ADR ファイルは変更しない。

### 落とし穴

- ADR と候補要件が正面から衝突するため、裁定せずに実装を始めると、承認済み方針を無断で覆すか、潜在データ損失を残す。
- 現行 UI が認証メタデータだけを直接 remove し、承認済み ADR の API キー削除を実装していないため、両者を同じ挙動として pin できない。
- 認証メタデータを先に削除すると、その後に旧 KEK で復号できなくなる。
- 復号不能な ciphertext を空文字で上書きすると、再認証しても元の API キーを復元できない。
- 旧 helper の 4 フィールド一覧を再利用すると、canonical な 6 フィールドの一部が漏れる。
- 解除時だけ再暗号化しても、`setMasterPassword` と `changeMasterPassword` に同じ処理がないため、ライフサイクル間の非対称が残る。
- nested settings だけを対象にすると、legacy scattered key に残る API キーが復号不能になる。
- legacy scattered key だけを対象にすると、nested settings に残る API キーが復号不能になる。
- cached password や module state を次の非永続処理の前提にすると、Service Worker 終了後に操作を再開できない。
- 認証メタデータの削除直前に全項目の確認を行わないと、成功表示だけが先行し、解除後に読めない値が残る。
- 解除失敗時に checkbox を unchecked のまま残すと、実際の認証状態と UI が食い違う。
- `IS_LOCKED` の扱いを裁定せず service と dashboard の差異だけを残すと、成功後に古い lock state が残る。
- `master-password-cleanup.test.ts` は実経路をテストしていないため、テストの green だけを根拠に安全と判定してはいけない。

## 決定事項

5 Whys を使って次を裁定する。

1. マスターパスワード解除は ADR 通り API キーを削除するのが正なのか、匿名 KEK で再暗号化して保持するのが正なのか。採用根拠と ADR supersede の要否を裁定する。
2. 復号不能な API キーがある場合、解除を中止して再認証を促すのか、削除して再入力を求めるのか。`unrecoverable` 契約と認証メタデータ削除順序を基準に裁定する。
3. `setMasterPassword` と `changeMasterPassword` も同時に修正すべきか。解除時だけ API キーを保護する生命周期的非対称を残さないため、3 経路の共通契約と裁定上の境界を決める。
4. 旧 scattered settings と nested settings の双方に API キーがあるとき、nested と legacy の全検出、delta write、競合、Service Worker 再開を含めた atomic な確定手順をどう定めるか。
5. UI 解除失敗時に何を表示し、checkbox をどう rollback し、既存の i18n キーを再利用・追加のどちらにするか。成功時の `IS_LOCKED` と認証メタデータの最終状態も含めて裁定する。

裁定成果物には、各決定の確認済み事実、比較した候補、採否、ADR への影響、再開・競合上の残存リスク、後続 `fix` の変更対象とテスト範囲を含める。

## Definition of Done

- [x] 依存 PBI 25 の匿名 KEK と durable secret の形式が裁定前提として確認されている。
- [x] ADR、production service、dashboard 直接 remove、旧 helper、6 フィールド、両 storage 配置の関係が調査資料へ整理されている。
- [x] API キー削除と匿名 KEK 再暗号化の両候補が同じ評価軸で比較されている。
- [x] ADR supersede の要否と採用方針が明確に裁定されている。
- [x] 復号不能な ciphertext の扱いと、`unrecoverable` 契約を維持する削除順序が裁定されている。
- [x] `setMasterPassword`、`changeMasterPassword`、`removeMasterPassword` の3経路について、6 フィールドと KEK 遷移の扱いが裁定されている。
- [x] 旧 4 フィールド helper を canonical な `API_KEY_FIELDS` に置き換える方針が確定し、別一覧を複製しない。
- [x] nested settings と legacy scattered key の双方を含む atomic な確定手順、競合処理、Service Worker 再開規則が定義されている。
- [x] 復号、再暗号化、確認、認証メタデータ削除の順序と `IS_LOCKED` の最終状態が定義されている。
- [x] dashboard の直接 remove、checkbox rollback、エラー表示、再認証案内、i18n の扱いが裁定されている。
- [x] BDD 受け入れシナリオが E2E、統合、単体テストへ変換され、既存 pin の変更対象が特定されている。
- [x] 依存 PBI 17 の settings データ競合と、依存 PBI 12 の offline queue payload への影響が評価されている。
- [x] async/await、既存 timeout、CSP fetch path、repository の delta write、ESM import の `.js` 拡張子が後続 `fix` の制約に含まれる。
- [x] 調査で与えられた事実だけを裁定根拠に使い、未確認情報を確定情報として記載していない。
- [x] 本 PBI は `investigate` として裁定と仕様化のみを行い、プロダクションコード、既存テスト、ADR ファイルを変更せず、テストを実行していない。
- [x] 後続 `fix` が、本 PBI の裁定を PRODUCTION 経路、既存 pin、UI 契約、再開テストへ変換できる。

## 裁定記録（2026-09-27 / investigate）

### 確認済み事実

すべて 2026-09-27 時点のコード読み取りで確認した。未確認の推测は判断材料に含めていない。

| # | 事実 | 根拠 |
|---|---|---|
| F1 | 承認済み ADR は「解除時に API キー暗号化データを空文字で上書きして削除する」方針 | `dev-docs/ADR/2026-03-24-master-password-data-cleanup.md` |
| F2 | ADR が「実装完了」と記す削除コードは `popup.ts:698-720` と記載されるが、現行 dashboard の解除経路は認証メタデータ 3 キーの直接 remove のみで API キーに触れない | `src/dashboard/masterPassword.ts:252` |
| F3 | `removeMasterPassword()`（service 側）も認証メタデータ 4 キーのみ削除し、復号も再暗号化もしない | `src/utils/storage/encryptionSession.ts:479-490` |
| F4 | `removeMasterPassword()` の production 呼び出し元は 0 件。re-export とテストからのみ参照される | `rg -l removeMasterPassword src entrypoints` |
| F5 | dashboard 経路は `IS_LOCKED` を解除対象和外すため、service と最終状態が異なる | F2 と F3 の対象キー集合の差 |
| F6 | 「設定」経路も再暗号化しない。新規 salt と hash を書き `IS_LOCKED=true` にするだけで、既存 ciphertext は旧 KEK のまま残る | `src/utils/storage/encryptionSession.ts:344-380` |
| F7 | 「変更」経路も再暗号化しない。旧パスワードで unlock してから `setMasterPassword(newPassword)` を呼ぶだけ | `src/utils/storage/encryptionSession.ts:462-474` |
| F8 | dashboard の変更ボタンは認証モーダル → `showPasswordModal('change')` → `savePassword()` → `setMasterPassword()` を呼ぶ。4 フィールド再暗号化 helper は production から呼ばれていない | `src/dashboard/masterPassword.ts:261-270` / `src/utils/masterPassword.ts:183-247` |
| F9 | canonical な対象は 6 フィールド（`provider_api_key` と `github_pat` を含む）。旧 helper は 4 フィールド | `src/utils/storage/apiKeyFields.ts` / `src/utils/masterPassword.ts:220` |
| F10 | 復号不能な ciphertext は空文字で潰さず `unrecoverable` として報告し原文を保持する契約が既にある | `src/utils/storage/settingsMigration.ts:454-460` |
| F11 | API キーは nested `settings` blob に書き込まれ、legacy scattered key は読み取り側の fallback。書き込みは delta + `StorageTransaction.withLock('settings')` | `src/utils/storage/SettingsRepository.ts:202-229` |
| F12 | 解除成功メッセージは「Master password removed.」のみで、API キーが読めなくなることを伝えない。失敗用メッセージキーも存在しない | `public/_locales/{en,ja}/messages.json` |
| F13 | 既存テストは認証キーが消えることだけを pin し、API キーの扱いを検証しない。dashboard のテストは 3 キー直接 remove を pin している | `encryptionSession-branch.test.ts:272+` / `storage-security.test.ts:569+` / `dashboard/__tests__/masterPassword.test.ts:343-377` |

### 事実の要約

ADR と実装の食い違いは「どちらが正しいか」ではなく、**どちらも API キーを守っていない**という点にある。ADR が求める削除は実装されておらず（F2）、実装されているのは認証メタデータの削除だけである（F2/F3）。結果として ciphertext は `chrome.storage.local` に残り続け（読めないが削除されない）、ユーザーは成功メッセージだけを見て（F12）API キーが読めなくなったことに気付かない。さらに setting / change も同じ欠陥を持つ（F6/F7/F8）ため、影響範囲は解除だけでなく 3 経路すべてに及ぶ。

### 決定事項 1: 削除ではなく、匿名 KEK への再暗号化を裁定

**裁定: 匿名 KEK への再暗号化を採用する。ADR は supersede する。**

- 比較軸ごとの評価:
  - データ損失: 削除案は 6 フィールド分の API キーを消失させる。再暗号化案は保持する。
  - ADR 整合性: 削除案は ADR の現行文言と一致するが、その文言の前提（`popup.ts` に削除コードが存在する）が既に失われている（F2）。再暗号化案は ADR の改訂を必要とする。
  - 再開可能性: 再暗号化案は Service Worker 再起動後も匿名 KEK の経路がそのまま成立する。削除案はユーザーが API キーを入力し直すまで状態が変わらない。
  - ADR が挙げる concern（残存データによるセキュリティリスク）: 現状は ciphertext が残っており、この concern は**すでに満たされていない**。PBI 25-25 で KEK が non-extractable かつ別の store に入るため、削除せずともこの concern はより強く満たされる。削除案の「残存データを消す」という主張は、現状で ciphertext が local に残っていることに対して成立していない。
- 採否: 削除案を不採用。理由は、concern が未充足である現状に対して削除案は API キーの消失という実害を発生させるだけになること。
- 残存リスク: 匿名 KEK は拡張機能内の IndexedDB に住むため、拡張機能内部への侵入者は復号できる。PBI 25-25 の residual risk をそのまま引き継ぐ（`chrome.storage.local` 単体漏洩では復号不可）。

### 決定事項 2: 復号不能な ciphertext は処理を中止する

**裁定: 1 件でも復号不能なら、認証メタデータを削除せず解除を中止して再認証を促す。削除も空文字上書きもしない。**

- 5 Whys の回答:
  1. なぜ中止か: 復号できない API キーを再暗号化も削除もできないまま KEK を切り替えると、値は残るが二度と読めなくなる（F10 が禁じている空文字潰しと同型の恒久損失）。
  2. なぜ空文字潰しは不可か: 唯一の ciphertext コピーを壊し、あとから鍵を回復できた場合でも復元できない。
  3. なぜ「先に復号確認してから切り替える」順序を取るか: 認証メタデータを先に消すと、復号確認に使う旧 KEK の手掛かりが失われるため。
  4. なぜ全件ではなく 1 件でも中止か: 1 件でも読めない値を放置すると、成功表示のあとで「一部だけ壊れている」状態になり、用户在 UI で壊れている項目を特定できなくなるため。部分成功は許さない。
  5. なぜ再認証を促すか: 当該 1 項目は再入力でしか回復しないため、UI の警告はその旨を明示すべき。
- 対象値が空文字の項目は変換不要（すでに暗号化対象ではない）として扱う。
- 残存リスク: 再認証しても当該 1 項目は復旧しない。UI で「他の項目は保持され、この 1 項目のみ再入力が必要」と明示する必要がある。

### 決定事項 3: set / change / remove の 3 経路を同じ契約に揃える

**裁定: 3 経路すべてを再暗号化する対象とする。解除だけが安全になる非対称を残さない。**

- 5 Whys の回答:
  1. なぜ change も含めるか: change は KEK を新しいパスワード由来の鍵に切り替える点で remove と同じ欠陥を持つ（F7/F8）。放置すると「解除は安全、change は壊す」という非対称が残る。
  2. なぜ set も含めるか: set は最も発生しやすい経路であり、既存 API キーがある状態で有効化すると即座に読めなくなる（F6）。解除より影響範囲が広い。
  3. なぜ共通契約が要るか: 3 経路で別々の再暗号化処理を書くと、フィールド一覧の食い違い（F9）が再発する。
  4. なぜ canonical 一覧を 1 つにまとめるか: `API_KEY_FIELDS`（6 フィールド）が既存の唯一の SSOT であり、複製元を作らない。
  5. なぜ 1 つの関数に集約するか: 復号、再暗号化、確認、認証メタデータ更新という順序を 1 か所にまとめると、監査とテストの対象を 1 経路に絞れる。
- 対象: `API_KEY_FIELDS` の 6 フィールド（`obsidian_api_key`, `gemini_api_key`, `openai_api_key`, `openai_2_api_key`, `provider_api_key`, `github_pat`）。旧 4 フィールド helper は canonical 一覧の複製に使い回さない。
- 残存リスク: 既存 4 フィールド helper は production から未使用（F8）なので、後続 fix で canonical 一覧へ委譲するか削除する。helper 自体の整理は別 PBI の対象とし、この PBI では裁定のみ。

### 決定事項 4: 確定手順と再開規則

**裁定: 次の順序を唯一の確定手順とする。認証メタデータの更新は最後で、durable な確認が通るまで行わない。**

1. settings の write lock を取得する（`StorageTransaction.withLock('settings')`）。
2. nested `settings` blob と legacy scattered key の両方から、canonical 6 フィールドの現在値を取得する。
3. 対象フィールドごとに旧 KEK で復号する。1 件でも失敗したら、その時点で全体を中止して UI に再認証を促す（決定事項 2）。認証メタデータには触れない。
4. 復号済みの値を新 KEK で再暗号化し、delta write で書き戻す。snapshot 全量を書き戻さない。
5. 書き戻し後に、read back して新 KEK で復号できることを確認する（durable な確認）。
6. 復号確認が通った後に限り、認証メタデータを更新する。remove では 4 キーを削除、set / change では salt と hash を新しい値にする。
7. キーのキャッシュと `IS_LOCKED` を最終状態に合わせて更新する。

- 両配置の扱い: nested と scattered のどちらに値があっても両方を検出し、6 フィールドだけを再暗号化する。片方だけを対象にすると、もう片方に残る API キーが読めなくなる。
- 再開規則: Service Worker はいつでも終了するため、cached password や module state を次の操作の前提にしない。各ステップは永続化された状態から読み直して再実行できる形にし、途中終了は「認証メタデータがまだ更新されていない状態」として再開する。再実行しても、同じ値へ到達することを確認してから認証メタデータを更新する。
- 競合: 手順 5 と 6 の間に他 writer が settings を更新した場合は、認証メタデータを更新する前に中断する。delta write 契約（PBI 17）に従い、古い snapshot を書き戻さない。
- 残存リスク: 6 フィールド × 2 配置の検出手順が 1 か所に閉じるため、canonical 一覧との食い違いを再発させないことが条件になる。

### 決定事項 5: UI、i18n、IS_LOCKED の最終状態

**裁定: dashboard の直接 remove を service 経路へ置き換える。失敗時は checkbox を元に戻す。**

- service 経路: `removeMasterPassword()` を再暗号化と解除の唯一の入口にし、dashboard からは直接 `chrome.storage.local.remove()` を呼ばない。これにより F5 の `IS_LOCKED` の食い違いも解消する（service 側は既に含めている）。
- 成功時: 認証メタデータと `IS_LOCKED` を最終状態に合わせて更新し、チェックボックスを unchecked にしてから完了メッセージを出す。順序は「保存の完了 → UI 更新」。
- 失敗時: エラーを表示し、チェックボックスは checked のまま維持する。認証メタデータは一切変更しない（決定事項 2 の順序が保証する）。UI と実際の認証状態が食い違う状態を許さない。
- i18n: 既存 `passwordRemoved` は意味が合わない（API キーが消えることを通知しないため F12）。キーを 2 つ追加する。1 つは「API キーは再暗号化された」旨の完了メッセージ、もう 1 つは「再暗号化できなかったため解除を中止した」旨の失敗メッセージ。`passwordIncorrect` は「パスワードが違う」専用であり流用しない。追加は `public/_locales/en/messages.json` と `ja` の両方に行う。
- 既存 pin の更新対象: `dashboard/__tests__/masterPassword.test.ts:343-377`（3 キー直接 remove を pin している）を service 呼び出しの検証へ差し替える。`encryptionSession-branch.test.ts:272+` と `storage-security.test.ts:569+` に canonical 6 フィールドの保持検証を追加する。
- 残存リスク: `src/utils/__tests__/master-password-cleanup.test.ts` は production 関数を呼ばないため、この PBI の裁定の安全性の根拠にはできない（DoD の契約どおり、後続 fix の実経路テストが担保する）。

### ADR supersede の要否

**要る。** `dev-docs/ADR/2026-03-24-master-password-data-cleanup.md` の「解除時に API キー暗号化データを削除する」方針は、F2（削除コードが存在しない）と F6/F7（set と change も未変換）の下で、Positive に挙げられた「残存データによるセキュリティリスクを排除」を満たしていない。PBI 25-25 により KEK が `chrome.storage.local` から別の store へ移ったため、「削除」を採る根拠は消えた。後続 fix で「匿名 KEK へ再暗号化」を規定する ADR が本 ADR を supersede する。

### 後続 fix への変換

**起票する fix PBI**: `2026-09-27-fix-master-password-reencrypt-preserve-api-keys.md`（estimate 3 SP、RICE は本 PBI 完了後の再採点）

変更対象:

| ファイル | 変更 |
|---|---|
| `src/utils/storage/encryptionSession.ts` | 6 フィールドの再暗号化を 1 つの関数に集約し、`setMasterPassword` / `changeMasterPassword` / `removeMasterPassword` から呼ぶ。`removeMasterPassword` は復号不能時に throw し、認証メタデータに触れない |
| `src/dashboard/masterPassword.ts` | 直接 `chrome.storage.local.remove()` をやめ、service 関数を呼ぶ。失敗時は checkbox を checked に戻し、成功時だけ unchecked にする |
| `public/_locales/{en,ja}/messages.json` | 完了用と失敗用のキーを 2 つ追加 |
| `dev-docs/ADR/2026-03-24-master-password-data-cleanup.md` | superseded として、supersede する ADR への参照と裁定理由を追記 |

テスト順（Outside-In）:

1. 単体: canonical 6 フィールド × 2 配置 × 4 状態（nested のみ / scattered のみ / 双方 / なし）の検出し、復号不能 1 件で中止することを pure logic として検証する。
2. 単体: 3 経路の KEK 遷移と、復号確認を通るまで認証メタデータが変わらないこと。
3. 統合: `encryptionSession-branch.test.ts` と `storage-security.test.ts` に canonical 6 フィールドの保持検証を追加する。
4. 統合: `dashboard/__tests__/masterPassword.test.ts:343-377` の 3 キー直接 remove pin を service 呼び出しの検証へ差し替える。
5. 統合: SW 終了を復号途中・再暗号化途中・確認直後・認証メタデータ削除前へ注入し、再開後に同じ値へ到達することを確認する。
6. E2E: 解除後も各 API キーが読み出せること、復号不能時に解除が停止し認証メタデータと元 ciphertext が保持されること、解除失敗時に checkbox が rollback されることを確認する。

制約: async/await、既存 timeout、CSP fetch path、repository の delta write 契約、ESM import の `.js` 拡張子を継承する。オフライン queue payload へ API キーや認証情報を追加しない。動的コード実行経路を追加しない。
