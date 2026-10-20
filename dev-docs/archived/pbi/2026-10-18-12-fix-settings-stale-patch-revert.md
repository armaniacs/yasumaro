# PBI: ロック前の read から組み立てた patch を CAS で再 merge する設定書き込みを廃止し、popover/dashboard の資格情報セーブが再暗号化旧値で巻き戻されるのを防ぐ

## ユーザーストーリー

API キーを日常的に差し替える利用者（複数プロバイダを運用する power user）として、**「保存した API キーが、拡張機能を再起動するまで消えないでほしい」**。いまは、ダッシュボードで新しいキーを入力して「保存しました」と表示された直後に、service worker 側の読み取り処理が古い値を書き戻し、次の AI 要約が `401` で失敗する。UI は成功を報告し、ストレージのバージョン番号も整合し、エラーも一切出ない。ユーザーは「保存したはずのキーが欠落している」ことに気づかず、同じキーを再入力して、また同じことを繰り返す。

「この設定は保存した」と確信してから Obsidian への同期と要約処理を進めたい。業務価値は「API キー更新の信頼性」そのものである。企業利用では API キーの再入力に社内統制上のコストが伴い、課金だけが重複する。しかも消失は恒久的だ: 一度上書きされた API キーは、拡張機能を再起動しても戻らない。

## 優先度

- 順位: 12 / 25
- RICE: 1200（Reach=200 / Impact=1 / Confidence=100% / Effort=0.2）
- 根拠: 監査12件中、影響範囲が利用設定（API キー配列）に及ぶもの。CAS が正しくても防げない類型: 3つの production writer が merge lock 取得「前」の read から patch を組み立てるため、CAS のリトライは最新 blob から再導出しても同じ古い patch を再 merge する。最大の実例は SW 側 read-path の再暗号化: `getAll` が plaintext/legacy-100k API キーを含む blob を読むたびに `persistReEncrypted` patch（旧値の再暗号化）を生成し、blob read から PBKDF2-600k 派生を set するまでの窓が暗号処理＋複数 IPC をまたぐため、その窓に収まった popup/dashboard の資格情報セーブは、UI が成功を報告したまま再暗号化旧値で上書きされる。`whitelistWriter` と `settingsBackup` も同じ根本原因の狭い版。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中（CAS の契約を再設計するため）
- 副作用: 🔴あり。設定書き込みの契約が変わる。delta-write 契約（`SettingsRepository.ts:219-225`「古いスナップショットを渡すな」注釈）は**強まる**方向であり、保存されたキーが黙って上書きされる既知の経路を塞ぐが、一方で「patch の世代を持ち越さない」設計は**意図的に捨てられた reader-side 書き込み**（`restoreLatestSettingsBackup` のような full-payload 復元や settings インポート）を壊す可能性がある。加えて、競合が検出された場合に UI が「再読み込みしてください」を出さないまま黙って成功を返す経路が残ると、API キー更新が巻き戻る体験をそのまま残す。UI へのフィードバック設計（`src/dashboard/` / `src/popup/` の保存通知）が本 PBI のスコープに含まれる点が副作用の出所であり、単なる storage 層の内部修正ではない。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `settings-blob:stale-patch-prelock-read-revert`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 21番 / `findings.json`）。

根本原因（claimed root cause）: `persistMerged` は「呼び出し側が渡した patch」を lock 時に読み直した blob に spread する。patch の**内容**は 3 つの production writer で lock 取得「前」の read から capture されている。`ConflictError` 時のリトライは updater を最新値で再実行するが、**patch 定数はそのまま**なので（`SettingsRepository.ts:103`）、patch が名指しするキーへの並行 commit は CAS が正しくても黙って上書きされる。

trace（entrypoint → sink、実ファイルで確認した行番号）:

| # | ファイル:行 | 役割 |
|---|---|---|
| 1 | `src/background/allowedUrlsSync.ts:36` | entrypoint（SW realm）。`initAllowedUrlsSync` が起動時に `getAll()` を発火 |
| 2 | `src/background/allowedUrlsSync.ts:48` | entrypoint（SW realm）。`chrome.storage.onChanged` が `settings` blob の変化ごとに `getAll()` を再実行 → 再暗号化窓を乗算する |
| 3 | `src/utils/storage/SettingsRepository.ts:153` | propagation。`this.port.get(['settings', ...])` による blob read。ここで API キー現行値が capture される。並行 writer と協調されていない |
| 4 | `src/utils/storage/settingsMigration.ts:470` | propagation。`applyMigrationsCore` の入口 |
| 5 | `src/utils/storage/settingsMigration.ts:505` | propagation。legacy-100k 復号成功時に現行 KDF で**旧値**を再暗号化し `reEncrypted[field]` に詰める |
| 6 | `src/utils/storage/settingsMigration.ts:521-531` | propagation。plaintext API キー分岐。`encryptApiKey(value, ...)` で旧値の再暗号化 + WARN |
| 7 | `src/utils/storage/settingsMigration.ts:562` | propagation。`applyMigrationsAndDecryptWithReEncrypt` が `reEncrypted` を返す |
| 8 | `src/utils/storage/SettingsRepository.ts:170-173` | propagation。`getAll` が `Object.keys(reEncrypted).length > 0` なら `await this.persistReEncrypted(reEncrypted)` を呼ぶ |
| 9 | `src/utils/storage/SettingsRepository.ts:108-111` | propagation。`persistReEncrypted` が capture 済み record をそのまま patch として `persistMerged` に渡す |
| 10 | `src/utils/storage/storageTransaction.ts:259` | propagation。`const newValue = updateFn(currentValue)` ― merge は lock 内で fresh な current を取るが、patch は stale |
| 11 | `src/utils/storage/storageTransaction.ts:368` | propagation。`performCasUpdate` の version チェック。**競合は正しく検出される**が、この経路では version は整合しているため何も起きない |
| 12 | `src/utils/storage/storageTransaction.ts:374` | sink。`port.set({ [key]: newValue, ... })` が再暗号化旧値を commit。post-write verify（`:377`）もその値で成功判定するため ConflictError も post-write 不整合も表面化しない |

evidence（実ファイルで確認した行番号）:

- `src/utils/storage/settingsMigration.ts:320` ― `migrateToSingleSettingsObject` が legacy 値を `assignSettingValue` でそのまま blob に写し込む（再暗号化なし）。したがって plaintext / legacy-100k 前提条件は移行済みプロファイルで実在し、再暗号化 write が着地するまで窓が開く。
- `src/utils/storage/settingsRepository.ts:219-225` ― delta-write 契約注釈。「Do NOT pass a full cached snapshot ― its unrelated keys would overwrite concurrent writers' changes with stale values」。再暗号化 patch はまさに API キー項目についての captured-snapshot write であり、注釈が禁じている形そのもの。
- `src/popup/whitelistWriter.ts:59` / `:65-67` ― `settingsRepository.getAll()` で array を読み、`:65-67` で `[...whitelist, normalized]` を `setAll` に渡す。read と set の間に落ちた並行 whitelist write は黙って巻き戻り、同一 realm の `ConflictError` リトライも同じ stale array を再 merge する。
- `src/utils/storage/settingsBackup.ts:30` / `:41` ― `restoreLatestSettingsBackup` が `port.get(null)` で backup snapshot（`:30`）を読み、`:41` で `{ ...(current ?? {}), ...restored }` を `withLock` に渡す。前提条件は「空 blob + authoritative migration record」で、blob write path 自体からは到達しにくいエッジ状態。
- `src/background/allowedUrlsSync.ts:48` ― onChanged listener が settings 変化ごとに `getAll()` を再実行するため、blob が plaintext/legacy KDF ciphertext を持つ限り SW の再暗号化窓が乗算される。
- `src/utils/crypto/cryptoParams.ts:11-12` ― `PBKDF2_ITERATIONS: 600_000` / `LEGACY_PBKDF2_ITERATIONS: 100_000`。`getOrCreateEncryptionKey`（`src/utils/storage/encryptionSession.ts:566`）が PBKDF2-600k を派生させるため、trace の窓は数十〜数百 ms 規模になり得る。
- `src/utils/crypto/primitives.ts:327` ― `isEncrypted` は構造判定（object）であり、plaintext 文字列は false。
- `src/utils/storage/apiKeyFields.ts` ― `API_KEY_FIELD_NAMES`（`obsidian_api_key` / `gemini_api_key` / `openai_api_key` / `openai_2_api_key` / `provider_api_key` / `github_pat`）が patch が名指しするキー集合。

blockers（needs_validation、着手前に潰すべき owner 確認）:

1. 交錯（`getAll` の blob read → 再暗号化 `set` の間に popup/dashboard の credential save が落ちる）は **cross-context timing であり source-only では観測できない**。対象制御の実行 sandbox が当該 run で利用できなかった。
2. 特定プロファイルの blob が plaintext を持つか legacy-100k ciphertext を持つか（= `reEncrypted` 非空という前提条件）は、インストール/移行履歴に依存する **runtime の事実**で source からは判定できない。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. dashboard の API キーセーブが SW 再暗号化と競合してもユーザーの新しい値が残る
  Given 設定 blob の provider_api_key が、平文のダミー値 "old-dummy-key" で保存されている
  And   その blob に対する service worker 側の getAll が、平文検出による再暗号化 patch を組み立て始めた直後である
  When  ユーザーがダッシュボードで provider_api_key を "new-dummy-key" に保存する
  And   再暗号化 patch の書き込みが merge lock 内に到達する
  Then  最終的な設定 blob の provider_api_key はユーザーの新しい値 "new-dummy-key" である
  And   古い値 "old-dummy-key" で上書きされない
  And   どのパスもエラーを投げず、保存 UI は成功を報告する

Scenario: 2. legacy-100k 暗号文からの再移行でもユーザーの新しい API キーが残る
  Given 設定 blob の gemini_api_key が legacy-100k KDF で暗号化された旧値の dummy である
  And   service worker の getAll が legacy 復号に成功し、現行 600k KDF で**旧値**を再暗号化する patch を生成中である
  When  その patch が merge lock に到達する寸前に、ユーザーがダッシュボードで gemini_api_key を新しい dummy 値に更新する
  Then  最終 blob の gemini_api_key はユーザーの新しい値であり、600k KDF で暗号化されている
  And   再移行による巻き戻りが起きない

Scenario: 3. 同じ窓で並行して走る他の設定 delta も失われない
  Given 設定 blob の DOMAIN_WHITELIST に "a.example" が入っている
  And   service worker の getAll による再暗号化 patch が保留されている
  When  ユーザーがポップアップで "b.example" をホワイトリストへ追加し、その後 merge lock が取得される
  Then  最終 blob の DOMAIN_WHITELIST は "a.example" と "b.example" の両方を含む
  And   patch が名指ししていないキーは上書きされない

Scenario: 4. ホワイトリストへの同時2件追加でどちらも黙って失われない
  Given 空の DOMAIN_WHITELIST を持つ設定 blob がある
  When  2つの拡張コンテキストがそれぞれ "one.example" と "two.example" を並行してホワイトリストへ追加する
  Then  最終 blob の DOMAIN_WHITELIST は "one.example" と "two.example" の両方を持つ
  And   どちらの追加も例外を投げずに成功として報告される

Scenario: 5. 後勝ちのケースでも「誰の値が残ったか」が UI で可視化される
  Given ユーザーが API キー保存中に、競合による再読み込みが必要と判定される
  And   検出された delta が coalesce できる
  When  conflict handling が完了する
  Then  ストレージ上の値は lock 内で再導出された最新 base にユーザーの意図がマージされた結果である
  And   保存 UI は「再読み込み後に反映されました」等のフィードバックを 1 度以上出す（無言の成功にしない）

Scenario: 6. settings インポート（意図的な full-payload 復元）は引き続き全量を反映する
  Given 空 blob + authoritative migration record という復元前提状態を持つ
  When  ユーザーが設定バックアップを復元する
  Then  backup snapshot の全キーが blob に反映される
  And   この full-payload 経路は delta-write 契約の例外として明示的に文書化されている
```

## 受け入れ基準

- [x] `persistMerged` / `persistReEncrypted` が「呼び出し側が lock 取得前に capture した patch 定数」を merge する経路を持たないこと。具体的には `SettingsRepository.ts:108-111` / `:170-173` / `:198-204` の 3 箇所が、lock 内で fresh read → 変換 → merge を行う形（patch 世代を持ち越さない形）に変わっている
- [x] `StorageRepository.getAll` の再暗号化副作用が、lock 内で current blob を読み直してから「現行 KDF で読めない値」だけを再暗号化するように変わり、lock 外で capture した値を書かないこと。現行の `reEncrypted` は「変換後の値の map」であり「意図の map」ではない、という区別がコードと注釈で明示されている
- [x] `src/popup/whitelistWriter.ts:59-67` の array patch が、lock 内で current whitelist を読む `setAll` 系（例: `updateDomainWhitelist(updater)`）に置き換わり、read→set の窓に落ちた並行追加が失われないこと（Scenario 4 が自動テストで pass）
- [x] `src/utils/storage/settingsBackup.ts:30-41` の snapshot spread が、空 blob 前提を明示的に検証する（「current が空 or backup 側が authoritative」でなければ触らない）形に guard されるか、あるいは PBI 06 の merge 方策と揃えた意向ベースの merge に置き換わること。full-payload 復元が意図的例外である旨が注釈に書かれる
- [x] delta-write 契約注釈（`SettingsRepository.ts:219-225`）が更新され、「patch 世代を持ち越さない」新しい契約（lock 内 read→変換→merge）と、許される full-payload 例外（settings import / backup restore）が明記されている
- [x] 競合を coalesce できなかった場合に UI が無言成功しない。保存通知（dashboard / popup の API キー保存経路）に conflict feedback が 1 経路以上増える（Scenario 5）。i18n は `_locales/ja` と `_locales/en` の両方に追加されている
- [x] 既存契約テストが緑のまま: 並行 delta 追加が両ライターの分に残る契約、`performCasUpdate` の post-write verify、`withLock` の「updateFn MUST be pure and idempotent」契約（`storageTransaction.ts:230-244`）。変更によって既存の `ConflictError` リトライ経路が黙って無効化されていない
- [x] `npm run validate`（type-check + lint + 全テスト）が緑。競合系テストは `npx vitest run <file> --repeats=20` で安定（AGENTS.md の「実時間 sleep 禁止」に従い、並行は in-flight Promise のゲートで表現する）

## テスト戦略

### 単体

- **Red を先に書く**: mock StoragePort（`src/utils/storage/storagePort.ts` の `InMemoryStoragePort`、または `testDir/storageMock.ts`）を作り、`getAll` の blob read と `persistMerged` の set の間に **並行 set を差込むゲート**を置く。`settings` blob を `provider_api_key: "old-dummy-key"`（平文 dummy）で seed し、`getAll()` を開始 → read ゲートを保留 → 並行 `setAll({ provider_api_key: "new-dummy-key" })` を commit → read ゲートを開放、の順で交錯させる。最終 blob の `provider_api_key` を dummy 値で assert する。実時間 sleep は使わず、ゲート用の deferred Promise（`vi.fn` 内の resolve 保持）で表現し、`await` するイベントで進める。
- 同じゲートを `whitelistWriter` の並行追加にも置く: 2つの `addDomainToWhitelist` 呼び出し（別 instance / 同一 port）の間に read ゲートを差込み、`one.example` / `two.example` の両方が最終 blob に残ることを assert する。既存 `src/popup/__tests__/whitelistWriter.test.ts` は**改変せず**、隣に describe を新設する（既存テストの書き換えによる証拠の抹消は禁止）。
- `reEncrypted` payload の純粋性: 変換関数単体を「現在の KDF で復号できない値だけを再暗号化する」セマンティクスで pin（legacy 成功・plaintext 検出・現行 KDF 成功の 3 分岐）。
- 空 blob + authoritative migration record の backup restore が従来どおり全量反映されることの回帰 pin（`src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts` / `settingsBackupLiteralPin.test.ts` 相当）。

### 統合

- `SettingsRepository` と `StorageTransaction` の CAS リトライ経路を通した交錯: `ConflictError` が出ても patch 世代が持ち越されず、lock 内 fresh read からの再導出.Inspect 対象は `StorageRepository.persistMerged` → `new StorageTransaction(this.port).withLock('settings', ...)` → `performCasUpdate` → `verifyPostWrite`（`storageTransaction.ts:246-276`, `:356-378`）。
- 3 realm 相当（SW / dashboard / popup）の並行を同一 `StoragePort` に対して起こし、API キー delta・whitelist delta・re-encrypt が同時に走っても delta がすべて残ることを確認する。`__resetStorageTransactionForTest()`（`storageTransaction.ts:59`）で per-realm chain をリセットできることに注意（chain は module-level Map で context を跨げない = PBI 18 の窓）。
- `src/background/allowedUrlsSync.ts` の onChanged → `getAll()` → 再暗号化経路。onChanged が再暗号化 write を発生させ、それが次の onChanged を再発火させない（再入の非循環性）が維持されていること。

### E2E（owner 観測）

- 旧バージョン移行プロファイル（6.7.89 より前の install Preliminaries、legacy-100k KDF で API キーが残っているもの）を用意し、service worker の `getAll` と dashboard の API キーセーブを重ね、**blob の前後を比較**してコミット済み credential delta が再暗号化旧値で巻き戻らないことを確認する。監査の deployment validation plan と対応。
- 展開済み拡張で (1) ダッシュボードで API キーを保存 → (2) service worker を `chrome://extensions` から停止・再開 → (3) 設定が保持されていること（恒久性）、さらに (4) 保存 UI が競合時にフィードバックを 1 度以上出すことを目視。
- 実ブラウザでは cross-context の verify→set window（PBI 18）が同時に開いているため、E2E は再現不能の観測用であり、決定的な Red の根拠にはしない。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認）

| ファイル | 行 | 役割 |
|---|---|---|
| `src/utils/storage/SettingsRepository.ts` | 100-106 | `persistMerged`。lock 内で fresh read する点は正しい。問題は **patch 定数** |
| `src/utils/storage/SettingsRepository.ts` | 108-111 | `persistReEncrypted`。空なら skip、それ以外は stale patch をそのまま merge。**修正の中心1** |
| `src/utils/storage/SettingsRepository.ts` | 140-180 | `getAll`。:153 blob read、:160 authoritative 判定、:170 migration、:171-173 再暗号化 persist |
| `src/utils/storage/SettingsRepository.ts` | 198-204 | `__getAllScatteredFallback` の同じ再暗号化 persist（legacy 経路） |
| `src/utils/storage/SettingsRepository.ts` | 219-228 | delta-write 契約注釈 + `setAll`。**契約文の更新先** |
| `src/utils/storage/SettingsRepository.ts` | 230-249 | `writeSettings`。API キー暗号化 → `persistMerged`。delta の書き方自体は正しい |
| `src/utils/storage/storageTransaction.ts` | 246-276 | `withLock`。:259 `updateFn(currentValue)`、:262 `performCasUpdate` へ。CAS は正しく動く |
| `src/utils/storage/storageTransaction.ts` | 230-244 | 「updateFn MUST be pure and idempotent」契約注釈（新しい updater 設計の前提） |
| `src/utils/storage/storageTransaction.ts` | 356-378 | `performCasUpdate`。:368 version チェック、:374 set、:377 post-write verify。**sink** |
| `src/utils/storage/storageTransaction.ts` | 35-46 | `runSerialized` の per-realm promise chain（module-level。context を跨げない） |
| `src/utils/storage/settingsMigration.ts` | 470-543 | `applyMigrationsCore`。:505 legacy 再暗号化、:521-531 plaintext 再暗号化 |
| `src/utils/storage/settingsMigration.ts` | 562-566 | `applyMigrationsAndDecryptWithReEncrypt` の戻り値 |
| `src/utils/storage/settingsMigration.ts` | 286-340 | `migrateToSingleSettingsObject`。:320 で legacy 値を再暗号化せず blob へ写す |
| `src/utils/storage/settingsMigration.ts` | 128 | `isSettingsBlobAuthoritative` |
| `src/popup/whitelistWriter.ts` | 51-69 | `addToWhitelist`。:59 read、:60-63 dedup、:65-67 stale array `setAll`。**修正の中心2** |
| `src/utils/storage/settingsBackup.ts` | 29-43 | `restoreLatestSettingsBackup`。:30 snapshot read、:41 snapshot spread。**修正の中心3** |
| `src/background/allowedUrlsSync.ts` | 34-63 | :36 startup `getAll`、:48-49 onChanged listener、:52 re-sync `getAll` |
| `src/utils/storage/apiKeyFields.ts` | 13-20 | `API_KEY_FIELD_NAMES`。patch が名指しするキー集合 |
| `src/utils/crypto/cryptoParams.ts` | 10-14 | `PBKDF2_ITERATIONS: 600_000` / `LEGACY_PBKDF2_ITERATIONS: 100_000`（窓の大きさ） |
| `src/utils/crypto/primitives.ts` | 327 | `isEncrypted` の構造判定（plaintext 文字列は false） |
| `src/utils/storage/encryptionSession.ts` | 566 | `getOrCreateEncryptionKey`（PBKDF2-600k 派生） |

### 最小変更の選択肢

**選択肢 1（推奨）: `persistReEncrypted` を「patch ではなく lock 内の変換関数」に変更する**

- 実装方針: `persistMerged(patch)` を「patch 定数を merge する」のではなく「lock 内で current blob を受け取る `updater` を merge する」形に拡張する。`persistReEncrypted` は「どのフィールドが再暗号化されたか」という**意図キー集合**だけを lock 内に持ち、lock 内で `current` を読んで「そのキーの値が現行 KDF で復号可能でない場合に限り再暗号化する」。これにより patch の**値**は lock 内で生成され、世代は持ち越されない。
- delta-write 契約との整合: `SettingsRepository.ts:219-225` の注釈（「Do NOT pass a full cached snapshot」）は**強化される**方向、つまり「patch は lock 内で current から導出せよ」に書き換える。既存の正しい実装（`writeSettings` が delta 定数を渡す経路、`setAll` の delta 経路）はそのまま生存する。
- 変更範囲: `SettingsRepository.ts`（`persistMerged` / `persistReEncrypted` / `getAll` / `__getAllScatteredFallback`）と契約注釈。storage キー・schema・version 方式は不変なので既存プロファイルの互換性は保つ。
- コスト: PBKDF2-600k 派生を lock 内で行うと lock 保持時間が伸びる。`runSerialized` の per-realm chain は context を跨げないため PBI 18 の窓とは別の話だが、lock 内 crypto は検討対象。代替として「lock 内で「そのフィールドが再暗号化必要か」を判定し、必要なら**その瞬間の値**で patch を生成する」形なら crypto は lock 内で走るが、判定と暗号化の間にもう一度窓が開くため、懸念を明記して owner に確認する。

**選択肢 2: `whitelistWriter` / `settingsBackup` の snapshot patch を同様に lock 内構築へ組み直す**

- `whitelistWriter.ts:59-67`: `getAll()` による array read を廃し、`SettingsRepository` に「lock 内で current whitelist を受け取る updater」を渡す（例 `updateDomainWhitelist((cur) => [...(cur ?? []), normalized])`）。CAS リトライは updater を最新値で再実行するので、2件同時の追加は両件残る。upsert の冪等性は normalized entry が同一なので担保される。
- `settingsBackup.ts:30-41`: backup snapshot の spread は「full-payload 復元」という意図的な例外。現状の前提（空 blob + authoritative migration record）を**明示的に検証**してから書き、`current` が非空なら「復元が追跡マージになる」旨を注釈するか、PBI 06 の merge 方策（意向ベース merge）と揃える。**異なる契約を混ぜないこと**。

**選択肢 3: CAS リトライ時に patch を再導出する（updater が lock 時に fresh read を受け取る）**

- 実装方針: `withLock` の updater が「lock 時に読めた fresh current」を受け取るのは既に正しい（`storageTransaction.ts:259`）。問題は caller が patch を定数として用意して marshalling している点。したがって選択肢 3 は本質的に選択肢 1 と同じ方向だが、「`StorageTransaction` 側に updater 用の fresh-read 保証を明示する」点が違う。`withLock` の契約注釈（`:230-244`）に「updater は capture した値を使ってはならない」を追記し、`mergeSettingsBlob` を「patch spread」から「updater 適用」に置き換える。
- 推奨: 選択肢 1 と 3 を同時に採用（storage 層の updater 契約注釈の強化 + `SettingsRepository` の該当3経路の組み替え）。選択肢 2 は `whitelistWriter` / `settingsBackup` に同じ原則を適用する。

**推奨**: 選択肢 1 + 3（storage 層の契約の強化と repository 3 経路の組み替え）を主軸に、選択肢 2 を併せて適用する。いずれも storage キー・schema・version を変えないためロールバックは `git revert` で効く。

### 着手前に潰すべき owner 確認（blockers 対応）

監査 needs_validation の blocker は 2 件で、いずれも source-only では閉じられない。**この 2 つが閉じるまで「直した」と宣言しない**:

1. **交錯の再現（blocker 1）**: 対象制御の実行 sandbox で「read ゲートに並行 set を差込む」テストを書き、修正前に**確実に赤**になることを観測する。赤が出なかった場合、監査の根本原因（stale patch が delta を殺す）が誤りであり、設計に着手せず原因を再考し、監査へ是正を返す。
2. **owner-observed（blocker 2）**: 6.7.89 より前の install 由来の移行プロファイルで、service worker `getAll` と dashboard の credential save を重ね、blob 前後を比較して、コミット済み credential delta が再暗号化旧値で巻き戻るかを 1 回実機確認する。監査の deployment validation plan と対応。結果が再現しない場合、想定窓（PBKDF2-600k + 複数 IPC）を実測し、PBI へ記録する。

### 既存テストへの追加項目

- `src/utils/storage/__tests__/SettingsRepository.test.ts` ― 平文 API キーで seed し、read ゲートに並行 set を差込む新規 describe。**既存テストは改変しない**。
- `src/utils/storage/__tests__/settingsMigration-port-unify.test.ts` / `settingsApiKeyFieldBinding.test.ts` / `settingsMigration-locked.test.ts` / `settingsMigration-unrecoverable.test.ts` ― `reEncrypted` の戻り値形状を前提にしている可能性があるので、戻り値が変わらない場合でも**関数シグネチャが変わるなら更新**（形状を変える場合は 4 ファイルすべて）。
- `src/popup/__tests__/whitelistWriter.test.ts` ― 並行追加の describe を**新設**（既存は改変しない）。
- `src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts` / `settingsBackupLiteralPin.test.ts` ― full-payload 復元が引き続き成立することの回帰 pin。
- AGENTS.md の test rule に従い、**実時間 sleep を追加しない**。並行ゲートは deferred Promise や `expect.poll` / `waitForMock()`（`testDir/waitPolicy.ts`）で表現する。

### ロールバック手順

- 変更は `src/utils/storage/SettingsRepository.ts` / `storageTransaction.ts`（注釈と updater 契約）/ `whitelistWriter.ts` / `settingsBackup.ts` とそのテストに閉じる。**storage キー構造・schema・version 方式を変更しない**ため、`git revert <commit>` で即座に旧挙動に戻せる。マイグレーション・バージョン bump は不要。
- ロールバック時に既存プロファイルの読み込みは壊れないが、**修正後に実際に残った user's delta** は、`persistReEncrypted` の旧値 patch に戻すと再上書きされうる（= 修正前の既知バグに戻る）。リリースノートに 1 行だけ明記し、巻き戻しリリース時は credential 再入力を呼ぶ旨を添える。
- 本 PBI で追加する UI フィードバック（conflict notice）は storage 層と独立した UI 変更なので、UI だけを revert しても storage の挙動は壊れない（逆に storage だけを revert すると UI が二度表示されるが、致命的ではない）。

## 見積もり

**3 SP**（🟡中）。理由: 変更量は 3〜4 ファイルに閉じておりstorage キー互換性を保つため一貫性は高い。ただし (a) CAS の updater 契約再設計（選択肢 1+3）、(b) lock 内 crypto の窓をどうするかという設計判断、(c) conflict feedback の UI 経路追加（i18n 2 言語）、(d) Red-first の交錯再現テスト（ゲート設計を含む）が支配的。最小でも 2 日、blocker の owner-observed 検証を含めて 1 スプリントに収まる範囲。

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス（Scenario 1〜6 の 6 件）
- [x] `npm run validate` が緑（type-check + lint + 全テスト）。競合系は `npx vitest run <file> --repeats=20` で安定
- [x] 監査 fingerprint `settings-blob:stale-patch-prelock-read-revert` を完了記録（CHANGELOG / 監査 ledger）に残す
- [x] コードレビュー完了（Security Review 観点: credential の消失経路が全て塞がれたか、i18n 両言語追加、delta-write 契約が強化されたか）
- [x] ドキュメント更新済み（`SettingsRepository.ts:219-225` の delta-write 契約注釈を新しい「patch を lock 内で導出せよ」に更新、`pbi/00-INDEX.md` への行追加、`CHANGELOG.md`）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（2 経路とも局所再現）
- 決め手: (1) `getAll` の blob read を保持中に新キーをコミットすると、再暗号化 patch が新値を **`old-dummy-key` に巻き戻す**。(2) lock 内 read の保留中に writer B を完了させると、最終 whitelist が **`['one.example']` のみ**になり `two.example` が黙って欠落する
- 影響: 実装メモに追記 ― node 環境には IndexedDB が無く匿名 KEK 生成が fail-closed throw するため、テストでは `getOrCreateEncryptionKey` を固定キーに差し替え、`__resetStorageTransactionForTest` を afterEach で呼ぶ必要がある

## 関連

- `pbi/00-INDEX.md`（本 PBI の登録先。完了後は `dev-docs/archived/pbi/` へ移動しアーカイブ履歴へ）
- ストレージ CAS 領域の PBI との合流の整合を確認すること:
  - PBI 06「信頼DB merge union」（`trust-db-save:merge-union-reverts-user-removals`）― 同じ「古いスナップショットが削除を殺す／復活させる」問題。merge 方策の原則を揃えること。
  - PBI 18「withOptimisticLock cross-context window」（監査 #25: verify→set が context 跨ぎで非原子）― `storageTransaction.ts:35-46` の `chains` は module-level Map で context を跨げない。本 PBI の lock 内再導出は**同一 realm 内**の交錯しか防げないため、PBI 18 と組んで読むこと。
  - PBI 20「session auto-lock」― 暗号化キーの availability と re-encrypt 窓の関連。
- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 21番、`findings.json`、`REPORT.md`）

## 完了記録（2026-10-20 補足）

- コミット: `6fcd0ec9`（コア修正）+ `b7e95e96`（既存テスト適応）。実装・検証の詳細は上記 完了記録（実装記録）のとおり。
- 5 Whys: 資格情報セーブが巻き戻る → re-encryption patch が lock 前読み取りの blob snapshot を無条件 spread → persistMerged の CAS は settings_version だけ比較し値を比較しない → patch が「どの元値から派生したか」を記録していない → マージに値レベルの資格検証が欠落。解: re-encryption は lock 内 fresh read に対し元値が現行 stored 値と deep-equal の間だけ適用（value-level CAS）、whitelist 追加は lock 内 updater seam で CAS 再試行時に再適用、backup restore は lock 内 empty-blob 前提の再検証。UI は onConflictCoalesced で競合マージ保存を明示し CAS 枯渇時は onError 表示。
- 検証: 対象モジュール 68 ファイル 733 テスト / フルスイート 1,102 ファイル 16,542 テスト / type-check / eslint / リピートゲート --repeats=20 全緑。