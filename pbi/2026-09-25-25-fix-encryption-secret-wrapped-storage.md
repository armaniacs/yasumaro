# PBI: ENCRYPTION_SECRET のラップ形保存

## ユーザーストーリー

拡張機能内アクセスを前提とし、API キーを登録するユーザーとして、マスターパスワード未設定時に `chrome.storage.local` へ `ENCRYPTION_SECRET` が Base64 平文で保存されないようにしたい。local ストレージ単体への漏洩だけでは API キー群を復号できないようにする必要があるため、鍵素材は durable KEK でラップした envelope として保存する。

## ビジネス価値

- `chrome.storage.local` の単独漏洩から API キー群を復号できないようにする。
- 復号に必要な追加材料を local とは別の store である IndexedDB の non-extractable `CryptoKey` に分ける。
- API キーの repository 経由暗号化を維持し、secret 値をログへ出さない。
- 既存データを無停止でラップ形へ移行し、Service Worker 再起動と拡張機能更新後も復号可能な状態を維持する。

## 優先度

- 種別: fix（セキュリティ欠陥。着手前の裁定次第では backlog へ格下げ）
- 順位: 25 / 30
- RICEスコア: 0.5（Reach=1 / Impact=3 / Confidence=50% / Effort=3 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: マスターパスワード未設定時の新規 secret をラップして保存する
  Given マスターパスワードが未設定で、IndexedDB に non-extractable KEK が利用できる
  When 拡張機能が新たな ENCRYPTION_SECRET を生成して保存する
  Then chrome.storage.local にはラップ済み envelope だけが保存される
  And ENCRYPTION_SECRET の値に raw key bytes または平文 Base64 は含まれない
  And API キーは引き続き repository 経由で暗号化されて保存される
  And secret 値はログへ出力されない

Scenario: Service Worker 再起動と拡張機能更新後も API キーを復号する
  Given ENCRYPTION_SECRET がラップ済み envelope として保存されている
  And API キーがその secret を使って暗号化されている
  When Service Worker が再起動した拡張機能を再度読み込み、API キーを復号する
  Then IndexedDB の non-extractable KEK を用いて envelope を unwrap できる
  And 保存済み API キー群を復号できる
  And chrome.storage.local にはラップ済み envelope だけが保持される

Scenario: legacy な平文 secret を無停止で移行する
  Given chrome.storage.local に legacy な Base64 平文 ENCRYPTION_SECRET が残っている
  And 対応する暗号化済み API キーが残っている
  When 新しい保存経路が secret を読み込む
  Then IndexedDB の non-extractable KEK を用いて平文 secret をラップする
  And 平文の代わりにラップ済み envelope を chrome.storage.local に保存する
  And 移行後に既存 API キー群を復号できる

Scenario: 未移行ユーザーが legacy fallback を通る
  Given 以前保存された平文 secret で暗号化された API キーが残っている
  When kdfNegotiator が legacy fallback による復号を試行する
  Then 平文 Base64 との直接変換によって secret を復元できる
  And 復号後の key negotiation が成功する
  And 新しい保存形式への移行が完了する

Scenario: IndexedDB の KEK が利用できない状態から既存データを失わない
  Given ENCRYPTION_SECRET のラップ済み envelope と暗号化済み API キーが残っている
  And IndexedDB の KEK が利用できない、または消去されている
  When 既存 secret の unwrap を試行する
  Then 既存の暗号化済み API キーを削除または上書きしない
  And 復号不能を新しい secret の生成へ進めない
  And IDB 利用不可時のエラーを利用者へ示す
```

## 受け入れ基準

- [ ] マスターパスワード未設定時の新規保存で、`ENCRYPTION_SECRET` はラップ済み envelope として `chrome.storage.local` に保存される。
- [ ] `ENCRYPTION_SECRET` の永続領域を session に戻していない。
- [ ] `chrome.storage.local` に raw key bytes または平文 Base64 の `ENCRYPTION_SECRET` を保存しない。
- [ ] ラップと unwrap には既存の AES-GCM の `wrapSecretString` / `unwrapSecretString` helper を再利用する。
- [ ] KEK は IndexedDB に保存された non-extractable `CryptoKey` とし、Service Worker 再起動と拡張機能更新後も利用できる。
- [ ] legacy な平文 `ENCRYPTION_SECRET` は読み取り後にラップ済み envelope へ移行され、移行後も既存 API キー群を復号できる。
- [ ] `kdfNegotiator` の legacy fallback は、移行済みユーザーと未移行ユーザーの双方で正しい secret を復元できる。
- [ ] IndexedDB または KEK が利用できない場合は、`durableKeyStore` の fail-open をそのまま適用せず、IDB 利用不可時の挙動を明示する。
- [ ] 復号不能な状態から既存 API キーを失わせる新規 secret の自動生成へ進まない。
- [ ] API キーは引き続き `SettingsRepository` 経由で暗号化され、secret 値はログへ出力されない。
- [ ] ESM import は `.js` 拡張子を使用し、Promise の `.then()` チェーンを使用しない。
- [ ] Manifest V3 の制約を維持する。
- [ ] `public/PRIVACY.md` と `docs/PRIVACY.md` の更新要否と `PRIVACY_POLICY_VERSION` の更新要否を裁定する。
- [ ] プライバシー文書を更新する場合は、両ファイルがバイト一致することを検証する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- マスターパスワード未設定で API キーを登録し、`chrome.storage.local` の実値に平文 Base64 がなく、ラップ済み envelope だけが保存されることを確認する。
- Service Worker 再起動後も保存済み API キー群を復号できることを確認する。
- 拡張機能更新後も IndexedDB の KEK とラップ済み envelope を利用し、保存済み API キー群を復号できることを確認する。
- 検証中に secret 値がログへ出力されないことを確認する。

### 統合テスト

- `SettingsRepository` と key provider の動的 import 経路で、ラップ済み envelope の保存・読み込み・unwrap と API キーの暗号化・復号が連携することを確認する。
- `settingsMigration.ts` の完了状態 migration と共有する復号経路で、legacy 平文 secret の無停止移行と移行後の復号を確認する。
- `kdfNegotiator` の legacy fallback で、移行済み secret と未移行の平文 secret をそれぞれ正しく復元できることを確認する。
- `hmacKeyStoreChain.test.ts` と `hmacKeyStoreRestart.test.ts` 相当の既存検証で、durable KEK と wrap / unwrap helper の動作に回帰がないことを確認する。
- IDB 利用不可・KEK 欠損時に、既存 envelope を保持し、自動再生成で データ損失 を起こさないことを確認する。

### 単体テスト

- `encryptionSession` で新規 secret が durable KEK を用いてラップされ、local に平文を残さないことを検証する。
- `encryptionSession` の legacy 分岐で、旧 secret をラップ済み envelope へ移行できることを検証する。
- `encryptionSession` の並行生成で、raw secret や無効な envelope が競合結果として保存されないことを検証する。
- `kdfNegotiator` で legacy Base64 の復号と、ラップ済み envelope の復号を検証する。
- durable KEK の取得失敗、unwrap 失敗、IDB 利用不可時に、裁定済みの fail closed または明示的復旧動作だけを返し、自動再生成を行わないことを検証する。
- `src/utils/__tests__/storage-security.test.ts:433-476` の「local に文字列で保存される」期待値を、ラップ済み envelope のみを保存する期待値へ変更する。
- `src/utils/storage/__tests__/encryptionSession-branch.test.ts:65-83` の旧 secret 救済テストを、ラップ済み envelope への移行検証へ更新する。
- `src/utils/storage/__tests__/encryptionSession-concurrency.test.ts:29-103` を、並行する secret 生成と envelope 永続化の競合検証へ更新する。

## 実装アプローチ

1. 着手前に 5 Whys の裁定を完了し、backlog へ格下げすべきセキュリティ欠陥か、そのまま fix として進めるべきかを確定する。
2. 脅威モデルを「local ストレージ単体への漏洩」に固定し、IndexedDB の non-extractable KEK にはアクセスできない前提で受け入れテストを先に追加する。
3. HMAC と API 暗号で KEK を共有せず、ENCRYPTION_SECRET 専用の durable KEK と rotation の境界を確定する。
4. 新しい永続表現を version 付き object envelope として定義し、raw key bytes や平文 Base64 を保持しない型へ変更する。
5. 既存の `wrapSecretString` / `unwrapSecretString` helper を ENCRYPTION_SECRET の保存経路へ接続する。
6. IndexedDB の non-extractable KEK を利用できる状態と、利用不能または欠損した状態を明示的に分岐させる。
7. 既存 API キーの復号不能を理由に新規 secret を自動生成しない IDB 障害時の方針を実装する。
8. `SettingsRepository` の key provider 動的 import と `settingsMigration.ts` の key provider 利用箇所を同じ保存契約へ接続する。
9. `kdfNegotiator` の legacy fallback を維持し、未移行の Base64 secret を読み取れるようにする。
10. legacy 平文 secret を読み込んだら、ラップした envelope を unwrap して確認し、確認後にだけ保存して local の平文を除去する。
11. envelope の unwrap 確認後だけ保存を完了する移行順序を定義し、途中失敗時に既存暗号化データを上書きしない。
12. `PRIVACY.md` と `PRIVACY_POLICY_VERSION` の更新要否を裁定し、更新が必要なら対象を明確にする。
13. 必要なら `public/PRIVACY.md` と `docs/PRIVACY.md` を同時に更新し、バイト一致を確認する。

## 見積もり

3 SP

## 技術的考慮事項

- 依存関係: `pbi/2026-09-25-27-investigate-master-password-removal-reencrypt.md` が本 PBI の anonymous secret 形式に依存する。
- 依存関係: `pbi/2026-09-25-17-fix-settings-migration-completion-state.md` と復号経路の migration テストを共有する。
- 既存契約: `src/utils/storage/types.ts:343-344` は `ENCRYPTION_SECRET: string` を定義しているため、永続表現の変更時に契約と migration を整合させる。
- 既存保存経路: `src/utils/storage/encryptionSession.ts:135-149` は salt と secret を Base64 平文で保存し、`:166-198` は平文 secret を読み込む。
- legacy 経路: `src/utils/crypto/kdfNegotiator.ts:86-113` は `ENCRYPTION_SECRET` を Base64 として直接 `atob` する。
- 既存暗号機能: `src/utils/crypto/hmacKeyStore.ts:159-225,348-384` に durable KEK と AES-GCM の `wrapSecretString` / `unwrapSecretString` がある。
- 障害時の危険: `src/utils/crypto/durableKeyStore.ts:98-118` は fail-open であり、そのまま使うと復号不能から新規 secret の生成へ進み、既存 API キーのデータ損失につながる。
- 記憶媒体の寿命: KEK は Service Worker と拡張機能更新をまたいで保持する必要があり、IndexedDB の non-extractable `CryptoKey` を利用する。
- セキュリティ: raw key bytes、平文 Base64、unwrap 後 secret を local やログへ残さない。
- 移行安全性: legacy secret の移行失敗が既存 API キー群の上書きや削除へつながらない順序にする。
- 互換性: ESM import の `.js` 拡張子、async / await のみ、Manifest V3 を維持する。
- 文書整合性: `public/PRIVACY.md` と `docs/PRIVACY.md` のバイト一致を維持する。
- ADR: `dev-docs/ADR/2026-08-12-encryption-secret-storage-area-must-be-local.md:5-38` の「session-only は不可」という決定を維持する。
- 過去資料: `dev-docs/archived/pbi/2026-08-01-17-fix-encryption-key-session-storage.md` も同じ領域を扱っているため、意図と重複する変更がないことを確認する。

## 実装者向け注記

### 現状コード Accessor の確認

着手前に以下を確認し、既存実装との重複や契約変更を PBI の範囲内に収める。

- `src/utils/storage/encryptionSession.ts:135-149`: `ENCRYPTION_SALT` と `ENCRYPTION_SECRET` の Base64 平文保存を確認する。
- `src/utils/storage/encryptionSession.ts:166-198`: 平文 secret の読み込み経路を確認する。
- `src/utils/crypto/kdfNegotiator.ts:86-113`: legacy fallback の直接 `atob` 経路を確認する。
- `src/utils/storage/types.ts:343-344`: `ENCRYPTION_SECRET: string` 契約を確認する。
- `src/utils/crypto/hmacKeyStore.ts:159-225,348-384`: durable KEK と `wrapSecretString` / `unwrapSecretString` の契約を確認する。
- `src/utils/crypto/durableKeyStore.ts:98-118`: fail-open 動作を確認する。
- `src/utils/storage/SettingsRepository.ts:76-79`: key provider の動的 import を確認する。
- `src/utils/storage/settingsMigration.ts:114,165`: legacy fallback と key provider の利用箇所を確認する。
- `dev-docs/ADR/2026-08-12-encryption-secret-storage-area-must-be-local.md:5-38`: session-only 禁止の決定を確認する。
- `dev-docs/archived/pbi/2026-08-01-17-fix-encryption-key-session-storage.md`: 既存領域の意図を確認する。

### 実装手順

1. `storage-security.test.ts:433-476` の平文保存 pin を削除せず、ラップ済み envelope のみを保存する期待値へ置き換える。
2. ENCRYPTION_SECRET の永続型を object envelope として定義し、Base64 平文を保存できない契約にする。
3. IndexedDB の non-extractable KEK を専用キーとして取得し、`wrapSecretString` で secret をラップする。
4. `encryptionSession` から local へ書き込む値を envelope に限定し、raw key bytes と平文 Base64 を除外する。
5. `SettingsRepository` の二つの key provider 利用経路と `settingsMigration.ts` の利用経路を同じ envelope 契約へ接続する。
6. `kdfNegotiator` の legacy fallback を残し、移行前の平文 secret を読み取れるようにする。
7. legacy secret の移行時に、ラップと unwrap の確認後に envelope を保存し、平文を local から除去する。
8. IDB 利用不可・KEK 欠損・unwrap 失敗を明示的な状態として扱い、自動再生成による既存 API キー上書きを止める。
9. HMAC と API 暗号で KEK を共有せず、ENCRYPTION_SECRET 専用 KEK の rotation が HMAC の寿命へ依存しないことをテストする。
10. `settingsMigration` の完了状態と共有する migration テストを追加する。
11. `PRIVACY.md` 2 ファイルと `PRIVACY_POLICY_VERSION` の更新要否を裁定し、必要な更新を同時に適用する。
12. `pbi/2026-09-25-27-investigate-master-password-removal-reencrypt.md` が参照する anonymous secret 形式に精通できるよう、確定した envelope 契約を依存先へ引き渡す。

### 落とし穴

- `src/utils/__tests__/storage-security.test.ts:433-476` は「平文で保存される」ことを正として pin しているため、期待値の変更が必須。
- `kdfNegotiator` の legacy fallback を忘れると、移行済みユーザーまたは未移行ユーザーが復号不能になる。
- `durableKeyStore` の fail-open をそのまま暗号 secret へ適用すると、復号不能から新規 secret 生成へ進み、既存 API キーを失う。
- `hmacKeyStore.ts:179-193` の local legacy candidate を流用すると、実質的に local を保護できない可能性がある。
- local の旧平文 secret を削除する前に envelope の unwrap を確認しないと、移行途中から API キーを失う可能性がある。
- object envelope と JSON string の選択を実装時に放置すると、`ENCRYPTION_SECRET: string` 契約と migration の扱いが分裂する。
- Service Worker 再起動と拡張機能更新を同じ検証に含めず、KEK の永続性を確認する。
- プライバシー文書の片方だけを更新すると、バイト一致ゲートに失敗する。

## 決定事項

以下は 5 Whys に基づく着手前裁定であり、実装とテストの期待値に反映する。

1. **脅威モデル**: 「local ストレージ単体への漏洩」を対象とし、攻撃者が IndexedDB にもアクセスできる場合は本 PBI の保護対象外とする。local 単独の漏洩だけで API キー群を復号できないことを主受け入れ条件とする。
2. **KEK の分離**: HMAC と API 暗号で同じ KEK を共有しない。共有すると rotation と自己修復が API 暗号の寿命に結合するため、ENCRYPTION_SECRET 専用の non-extractable KEK を IndexedDB に分離する。
3. **IDB 利用不可時の動作**: fail closed を基本方針とし、既存 envelope からの自動再生成を行わない。再生成は既存 API キーの喪失につながるため、復旧を許可する場合も裁定済みの明示的復旧手順だけを実装する。
4. **永続表現**: 新しい `ENCRYPTION_SECRET` は version 付き object envelope とする。JSON string は採用せず、型契約で envelope 構造を区別する。legacy 平文 string は読み取り後、同じ envelope へ移行する。
5. **legacy candidate の流用**: `hmacKeyStore.ts:179-193` の local legacy candidate は流用しない。保護鍵は IndexedDB の non-extractable `CryptoKey` とし、local には wrap 済み envelope だけを保存する。

## Definition of Done

- [ ] 5 Whys の裁定内容を実装、型契約、受け入れテストに反映した。
- [ ] BDD 受け入れシナリオが自動テストとして実装され、IDB 利用不可・KEK 欠損時も既存 API キー群を失わない。
- [ ] `chrome.storage.local` の `ENCRYPTION_SECRET` に raw key bytes または平文 Base64 が残らない。
- [ ] ラップ済み envelope のみが local に保存され、IndexedDB の non-extractable KEK を用いて Service Worker 再起動と拡張機能更新後に復号できる。
- [ ] legacy 平文 secret の移行と `kdfNegotiator` の legacy fallback を統合テストで確認した。
- [ ] `src/utils/__tests__/storage-security.test.ts:433-476` の旧 pin を新しい期待値へ更新した。
- [ ] `src/utils/storage/__tests__/encryptionSession-branch.test.ts:65-83` と `src/utils/storage/__tests__/encryptionSession-concurrency.test.ts:29-103` の関連検証を更新した。
- [ ] `hmacKeyStoreChain.test.ts` と `hmacKeyStoreRestart.test.ts` 相当の既存検証で回帰がないことを確認した。
- [ ] API キーが `SettingsRepository` 経由で暗号化されたまま、secret 値がログへ出力されないことを確認した。
- [ ] `public/PRIVACY.md` と `docs/PRIVACY.md` の更新要否と `PRIVACY_POLICY_VERSION` の更新要否を裁定し、必要なら両文書をバイト一致で更新した。
- [ ] ESM import の `.js` 拡張子、async / await のみ、Manifest V3 の制約を満たした。
- [ ] `pbi/2026-09-25-27-investigate-master-password-removal-reencrypt.md` の anonymous secret 形式と `pbi/2026-09-25-17-fix-settings-migration-completion-state.md` の migration 完了状態との依存整合を確認した。
- [ ] ロールバック時に旧平文データと新 envelope の切替が データ損失 を出さないことを確認した。
- [ ] セキュリティ欠陥の修正として、IDB 障害時、KEK 分離、移行順序、secret のログ出力防止の観点をレビューした。
- [ ] コードレビュー、関連ドキュメント更新、受け入れテストの結果を記録した。
