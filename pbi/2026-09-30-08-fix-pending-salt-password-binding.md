# PBI: KEK 回転アンカーをパスワードに紐付けて別パスワード再試行時の詰まりを防ぐ

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを変更中に中断されたユーザーとして、再試行時に別のパスワードを入力しても「なぜ失敗し続けるのか」が分かる状態を目指す。なぜなら、アンカーには salt しか保存されておらず、中断後に異なるパスワードで再試行すると部分的に移行済みの ciphertext がどちらの KEK でも読めず、明示的な案内のないまま恒久的に abort を繰り返すから。

## 優先度

- 順位: 8 / 13
- RICE スコア: 4.0(Reach=2 / Impact=1 / Confidence=1.0 / Effort=0.5)
- 根拠: 回復経路(同じ失敗パスワードの再入力)は実在するためデータ喪失ではないが、ユーザーにそれが伝わらず詰まって見える。docs 不整合の解消も含む。

## 証拠(レビュー由来・反証済み)

- `src/utils/storage/encryptionSession.ts` の `rotateToNewMasterPassword` — アンカー(`MASTER_PASSWORD_PENDING_SALT`)には salt 文字列のみを保存し、パスワード・hash との束縛がない
- 同関数 — 再試行時も `anchoredSalt` を再利用し、`next` KEK は入力パスワード依存で導出される
- `apiKeyTransition.ts` の `planKekTransition` — 旧 KEK でも新 KEK でも復号不能な field は `unrecoverable`
- `encryptionSession.ts` の `reencryptApiKeysToKek` — `unrecoverable` があると `ReencryptionAbortedError` を投げて恒久 abort(異なるパスワードでの再試行時)
- `rotateToNewMasterPassword` の `finally` — `MASTER_PASSWORD_SALT === saltBase64` のときだけアンカーを削除。metadata 未書き込みの abort ではアンカーが残り続ける(回復経路は閉じない — これ自体は resume 機構として正しい)
- `src/utils/storage/types.ts` の `MASTER_PASSWORD_PENDING_SALT` のコメントに「中止時に削除」とあるが abort 時削除の実装は存在しない(コードとドキュメントが矛盾)
- 回復性: 同じ失敗パスワードの再入力なら、移行済み field は新 KEK で読めるため skip され収束する(`encryptionSession-reencrypt.test.ts` の `KEK rotation — resume` が回帰として固定。このテストはアンカーに salt だけを手植えするため、hash なしの旧形式アンカーも受理し続ける必要がある)

## BDD 受け入れシナリオ

```gherkin
  Scenario: 中断後に異なるパスワードで再試行すると明示的に案内される
    Given KEK 回転が中断され PENDING_SALT アンカーが残っている
    When 元の回転と異なるパスワードで再試行する
    Then 専用エラーで中断中の回転が存在することが示される
    And ciphertext と metadata は一切変更されない
    And エラー文言は回復手順(元のパスワードでの再試行)を示す

  Scenario: 同じパスワードでの再試行は resume して完了する
    Given 同じ中断状態である
    When 元の回転と同じパスワードで再試行する
    Then 既存の resume 挙動のとおり収束する
```

## 受け入れ基準

- [ ] アンカーレコードに回転開始時の新パスワード検証子(hash)を追加し、再試行時に一致検証する
- [ ] 不一致時は専用エラー(既存の `ReencryptionAbortedError` と区別可能)を投げ、回復手順をメッセージに含める
- [ ] ciphertext・metadata・アンカーは不一致時に一切変更されない
- [ ] `types.ts:105` のコメントを実際の挙動(成功時に昇格、abort 時は resume 用に保持)へ修正する。または abort 時削除を実装する場合は resume テストとの整合を先に確認する
- [ ] `dashboard/masterPassword.ts` のエラー表示(`abortMessage`)が新エラーを適切に扱う
- [ ] i18n 2 言語でメッセージを追加する

## テスト戦略

### 統合
- 中断 → 異なるパスワード再試行(専用エラー・不変性確認)→ 同じパスワード再試行(収束)の一連を検証する

### 単体
- anchor 一致検証の分岐(一致 / 不一致 / アンカー不在)を検証する

## 制約

- 既存の resume 収束テストを壊さない
- pending_hash からパスワードが復元できないこと(hash であり PBKDF2 で保護済み)
- async/await のみ。ESM import は `.js` 拡張子

## 実装ガイド(低コストモデル向け)

### 0. リポジトリ規則(必読)

- ファイルは Read ツール(offset / limit 指定)で読む。`sed` / `awk` / `head` / `tail` / `cat` は使わない。検索は `grep -n`
- コードとコード内コメントは英語。コメントは非自明な WHY のみ(WHAT・変更履歴・タスク ID は書かない)
- 本番コードに `any` / `unknown` 型を使わない(テストは許容)
- ESM import は必ず `.js` 拡張子
- テストを通すために固定時間待ち(`setTimeout` / `sleep` / `waitForTimeout`)や retry 回数の引き上げをしない。await した Promise か `testDir/waitPolicy.ts` の `waitForMock` を使う
- `vi.useFakeTimers()` を既定オプションで呼ばない
- CRLF のファイルは CRLF を維持する(編集前に `file <path>` で確認)
- ツール呼び出しが権限で拒否されたら、回避せず停止して報告する
- シェルは zsh。パス一覧は配列に入れる(`files=(a b c)` と `"${files[@]}"`)。クォートなしの文字列変数は分割されない

### 1. 前提と着手前チェック

先行 PBI 01 / 02 / 03 / 04 / 05 / 07 / 12 / 13 が着地済みであること。次のコマンドで確認する。

```bash
grep -n "class MasterPasswordAlreadySetError" src/utils/storage/encryptionSession.ts   # 1 件(PBI 02)
grep -n "encryptApiKey(item.plaintext, keys.next, item.field)" src/utils/storage/encryptionSession.ts   # 1 件(PBI 03)
grep -n "function validateStoredIterations" src/utils/storage/encryptionSession.ts   # 1 件(PBI 04)
grep -n "MASTER_PASSWORD_PENDING_SALT" src/utils/storage/encryptionSession.ts   # 5 件(JSDoc 1 + rotateToNewMasterPassword 内 4)
grep -n "MASTER_PASSWORD_PENDING_HASH" -r src   # 0 件(未着手の証拠)
```

期待と異なる場合(特に最後が 1 件以上、または先行 PBI の grep が 0 件)は実装を始めず、状況を報告して停止する。後続 PBI 09 / 06 も同じファイルを編集するため、行番号ではなく関数名で位置を特定する。

### 2. 変更対象ファイル

編集する:
- `src/utils/storage/types.ts`(`StorageKeys` に新キー、`MASTER_PASSWORD_PENDING_SALT` のコメント修正、型マップ)
- `src/utils/storage/encryptionSession.ts`(新エラークラス、`rotateToNewMasterPassword`)
- `src/utils/storage/settingsMigration.ts`(`TOP_LEVEL_ONLY_KEYS` に追加)
- `src/utils/sensitiveDataMask.ts`(`LEVEL1_FIELDS` に追加)
- `src/dashboard/masterPassword.ts`(`savePasswordInner` の catch)
- `public/_locales/en/messages.json` / `public/_locales/ja/messages.json`
- `dev-docs/ADR/2026-09-28-master-password-kek-reencryption.md`(再開規則の記述に hash を追記)
- テスト: 新規 `src/utils/storage/__tests__/encryptionSession-pending-binding.test.ts`、新規 `src/dashboard/__tests__/masterPassword-pending-rotation.test.ts`、既存 `src/utils/__tests__/storage-keys.test.ts`、`src/utils/storage/__tests__/settingsMigration-completion-state.test.ts`、`src/dashboard/__tests__/masterPassword.test.ts` / `masterPassword-ui-state.test.ts` / `masterPassword-branches.test.ts` / `masterPassword-set-guard.test.ts`(モック factory 追加)

触らない:
- `src/utils/storage/apiKeyTransition.ts`(`ReencryptionAbortedError` は変更しない。新エラーは別クラス)
- `src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts`(hash なしの旧形式アンカーで resume できる回帰として無変更で通ること)
- `reencryptApiKeysToKek` / `removeMasterPassword` / `unlockWithPassword` / `changeMasterPassword` / `setMasterPassword` の本体
- 他の PBI ファイル、`public/PRIVACY.md`

### 3. 設計(確定事項)

- アンカー = `MASTER_PASSWORD_PENDING_SALT` + 新キー `MASTER_PASSWORD_PENDING_HASH`(値は `'master_password_pending_hash'`)。値は `hashPasswordWithPBKDF2(password, anchoredSalt)` の結果で、`MASTER_PASSWORD_HASH` と同じ形式(PBKDF2 出力の Base64。パスワードは復元できない)
- 判定は `rotateToNewMasterPassword` 内、いかなる書き込み・KEK 導出よりも前に行う
  - アンカーなし: salt と hash を 1 回の `port.set` で同時に書く(従来は salt のみ)
  - アンカーあり + hash あり: 入力パスワードの hash を `constantTimeCompare` で比較。不一致なら `PendingRotationMismatchError` を投げる(書き込みなし)
  - アンカーあり + hash なし(旧形式): 従来どおり検証せず resume する(hash は書き足さない)
- 削除は `finally` で salt と hash を 1 回の `port.remove([...])` で行う
- `types.ts` のコメントは実挙動(成功時に `MASTER_PASSWORD_SALT` へ昇格して削除、中断時は resume 用に保持)へ直す。abort 時削除は実装しない

### 4. 手順

各手順の後に `npm run type-check` を流すこと。

**手順 1: `src/utils/storage/types.ts`**

`StorageKeys` の `MASTER_PASSWORD_PENDING_SALT` 行の直後に追加し、同行のコメントを修正する。

```ts
MASTER_PASSWORD_PENDING_SALT: 'master_password_pending_salt', // KEK 切替中の新 salt 一時置き場。成功時に MASTER_PASSWORD_SALT へ昇格して削除、中断時は再開用に保持。再開可能性のアンカーであり認証状態は変えない
MASTER_PASSWORD_PENDING_HASH: 'master_password_pending_hash', // 上記 salt で導出した新パスワードの hash。別パスワードでの再試行を検出する
```

型マップ(`[StorageKeys.MASTER_PASSWORD_PENDING_SALT]: string;` の直後)にも `[StorageKeys.MASTER_PASSWORD_PENDING_HASH]: string;` を追加する。

**手順 2: `settingsMigration.ts` と `sensitiveDataMask.ts`**

`TOP_LEVEL_ONLY_KEYS` の `StorageKeys.MASTER_PASSWORD_PENDING_SALT,` の直後に `StorageKeys.MASTER_PASSWORD_PENDING_HASH,` を追加(settings blob へ移すと resume が壊れる)。`LEVEL1_FIELDS` の `'master_password_hash',` の直後に `'master_password_pending_hash',` を追加する。

**手順 3: `encryptionSession.ts` に新エラークラス**

`MasterPasswordAlreadySetError` クラスの直後に追加する(`reencryptApiKeysToKek` の `ReencryptionAbortedError` とは別クラスにして UI で区別する)。

```ts
/** Thrown when a rotation is retried with a different password than the interrupted one. */
export class PendingRotationMismatchError extends Error {
  constructor() {
    super('PendingRotationMismatchError: an interrupted master password rotation exists; retry with the password you entered before');
    this.name = 'PendingRotationMismatchError';
  }
}
```

パスワード・hash・salt をメッセージや `console`/`logWarn` に含めない。

**手順 4: `rotateToNewMasterPassword` の判定**

Before(`const port = new ChromeStoragePort();` の直後から `const hash = ...` まで):

```ts
const anchored = await port.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT);
const anchoredSalt = anchored[StorageKeys.MASTER_PASSWORD_PENDING_SALT] as string | undefined;
const saltBase64 = anchoredSalt ?? bytesToBase64(generateSalt());
if (anchoredSalt === undefined) {
  await port.set({ [StorageKeys.MASTER_PASSWORD_PENDING_SALT]: saltBase64 });
}
const salt = base64ToBytes(saltBase64);
const hash = await hashPasswordWithPBKDF2(options.password, salt);
```

After:

```ts
const anchored = await port.get([
  StorageKeys.MASTER_PASSWORD_PENDING_SALT,
  StorageKeys.MASTER_PASSWORD_PENDING_HASH,
]);
const anchoredSalt = anchored[StorageKeys.MASTER_PASSWORD_PENDING_SALT] as string | undefined;
const anchoredHash = anchored[StorageKeys.MASTER_PASSWORD_PENDING_HASH] as string | undefined;
const saltBase64 = anchoredSalt ?? bytesToBase64(generateSalt());
const salt = base64ToBytes(saltBase64);
const hash = await hashPasswordWithPBKDF2(options.password, salt);
if (anchoredSalt === undefined) {
  await port.set({
    [StorageKeys.MASTER_PASSWORD_PENDING_SALT]: saltBase64,
    [StorageKeys.MASTER_PASSWORD_PENDING_HASH]: hash,
  });
} else if (anchoredHash !== undefined && !(await constantTimeCompare(hash, anchoredHash))) {
  // Thrown before the try/finally below: nothing has been written yet, so the
  // anchor and every ciphertext stay exactly as the interrupted run left them.
  throw new PendingRotationMismatchError();
}
```

`constantTimeCompare` は既に import 済み。hash 計算をアンカー書き込みの前へ移すのは、salt と hash を 1 回の `set` で書くため(片方だけ残る状態を作らない)。

**手順 5: `finally` のアンカー削除**

Before: `await port.remove(StorageKeys.MASTER_PASSWORD_PENDING_SALT)`。After:

```ts
if (port.remove) {
  await port.remove([StorageKeys.MASTER_PASSWORD_PENDING_SALT, StorageKeys.MASTER_PASSWORD_PENDING_HASH]);
} else throw new Error('StoragePort.remove is required to clean up the rotation anchor');
```

(`if (port.remove) await ...; else throw ...` の既存構造を保つ。`StoragePort.remove` は `string | string[]` を受ける。)あわせて関数直前の JSDoc に「anchor は salt と、入力パスワードの hash の組。異なるパスワードでの再試行は `PendingRotationMismatchError` で拒否する」を 1〜2 文足す。

**手順 6: `src/dashboard/masterPassword.ts`**

import に `PendingRotationMismatchError` を追加し、`savePasswordInner` の catch に、`MasterPasswordAlreadySetError` 分岐の直後(最後の `else` の前)へ追加する。

```ts
} else if (e instanceof PendingRotationMismatchError) {
  showStatus('status', getMessage('masterPasswordPendingRotationMismatch'), 'error');
}
```

`abortMessage` は `ReencryptionAbortedError` 専用なので変更しない。`authenticatePassword` の catch も変更しない(そこで実行される action は export / import で、rotation を呼ばない)。

**手順 7: i18n(2 言語とも同じキー)**

`public/_locales/en/messages.json` と `public/_locales/ja/messages.json` の `masterPasswordAlreadySet` エントリの直後に追加する。

```json
"masterPasswordPendingRotationMismatch": {
  "message": "A previous master password change was interrupted. Enter the same new password you used last time to finish it. Nothing was changed."
},
```

ja:

```json
"masterPasswordPendingRotationMismatch": {
  "message": "前回のマスターパスワード変更が中断されています。前回入力した新しいパスワードをもう一度入力して完了してください。何も変更していません。"
},
```

**手順 8: ADR**

`dev-docs/ADR/2026-09-28-master-password-kek-reencryption.md` の再開規則(項番 4)の「新 salt を `master_password_pending_salt` に先行保存する」を「新 salt と入力パスワードの hash を `master_password_pending_salt` / `master_password_pending_hash` に先行保存する。異なるパスワードでの再試行は書き込み前に専用エラーで拒否する」へ直し、項番 5 の top-level 固定の記述に `master_password_pending_hash` も加える。経緯・履歴は書かない。

### 5. テスト先行(RED)

手順 1〜8 より先に、次の 2 ファイルを作る。各テストは修正前に実行して必ず失敗を確認する(`npx vitest run <file>`)。失敗しない場合はテストが誤っているので直す。

**5-1. 新規 `src/utils/storage/__tests__/encryptionSession-pending-binding.test.ts`**

ヘッダ・モック・`beforeEach` は `encryptionSession-reencrypt.test.ts` からそのまま写す(冒頭の `vi.mock('../../crypto/cryptoParams.js', ...)` で PBKDF2 を 1,000 回に下げる、`rateLimiter` / `authGuard` のモック、`setSecretKeyStorageOverride` による KEK 差し替え、`chrome.runtime.sendMessage` のスタブ)。import は `setMasterPassword`, `changeMasterPassword`, `unlockWithPassword`, `clearEncryptionKeyCache`, `getOrCreateEncryptionKey`(`../encryptionSession.js`)、`PendingRotationMismatchError`(同)、`ReencryptionAbortedError`(`../apiKeyTransition.js`)、`StorageKeys`、`encryptApiKey` / `generateSalt` / `bytesToBase64`(`../../crypto/index.js`)。

共通の中断状態の作り方(Given): 匿名 KEK で読める `obsidian_api_key` を `seedCiphertext` 相当で settings に入れ、さらにどの KEK でも読めない scattered 値を入れる。

```ts
const garbageField = 'provider_api_key';
await chrome.storage.local.set({
  [garbageField]: { ciphertext: btoa('unrelated-ciphertext-payload-000'), iv: btoa('unrelated-iv-0') },
});
const first = await setMasterPassword('FirstP@ssw0rd123!').catch((e: unknown) => e);
expect(first).toBeInstanceOf(ReencryptionAbortedError); // anchor is now left behind
```

テストと期待値:

1. `records the password hash next to the pending salt when a rotation is interrupted`: 上の Given の後、`MASTER_PASSWORD_PENDING_SALT` と `MASTER_PASSWORD_PENDING_HASH` がどちらも文字列で存在する(RED の理由: hash キーが未実装で `undefined`)
2. `rejects a different password with PendingRotationMismatchError and changes nothing`: Given の後に `snapshot`(`AUTH_KEYS` + `MASTER_PASSWORD_PENDING_SALT` + `MASTER_PASSWORD_PENDING_HASH` と、settings / garbageField の `JSON.stringify`)を取り、`setMasterPassword('SecondP@ssw0rd123!')` が `rejects.toBeInstanceOf(PendingRotationMismatchError)`。`ReencryptionAbortedError` ではないこと(`not.toBeInstanceOf`)、snapshot が完全一致、`error.message` に両パスワードが含まれないこと(RED の理由: 現状は `ReencryptionAbortedError`)
3. `resumes with the same password (guard passes, then the normal abort path runs)`: Given の後に同じ `'FirstP@ssw0rd123!'` で再実行すると `ReencryptionAbortedError`(`PendingRotationMismatchError` ではない)。アンカーの salt が 1 回目と同一
4. `accepts a legacy anchor that has a salt but no hash`: `MASTER_PASSWORD_PENDING_SALT` だけを `chrome.storage.local.set` で手植えし(値は `bytesToBase64(generateSalt())`)、別パスワードで `setMasterPassword` が成功する(`true`)。成功後に salt / hash 両キーが消えている(これは修正前も通る回帰ガード。RED 対象外)
5. `removes both anchor keys after a successful rotation`: 何も seed せず `setMasterPassword('NewP@ssw0rd123!')` が成功し、両キーが `undefined`(RED の理由: 修正前は hash キーが書かれないので単体では通るが、手順 4 だけ入れて手順 5 を忘れると失敗する。回帰ガード)
6. `binds the change flow too`: `setMasterPassword('OldP@ssw0rd123!')` → `unlockWithPassword` → 中断状態(garbage を入れる)→ `changeMasterPassword('OldP@ssw0rd123!', 'FirstNew1!Passw0rd')` が `ReencryptionAbortedError` → `changeMasterPassword('OldP@ssw0rd123!', 'OtherNew1!Passw0rd')` が `PendingRotationMismatchError`

RED 確認: `npx vitest run src/utils/storage/__tests__/encryptionSession-pending-binding.test.ts`(PendingRotationMismatchError の import が未定義でも失敗して構わない。手順 3 の空クラスだけ先に入れて、テスト 1・2・6 が assertion で落ちることを確認するとより確実)。

**5-2. 新規 `src/dashboard/__tests__/masterPassword-pending-rotation.test.ts`**

`masterPassword-set-guard.test.ts` を丸ごと写して土台にする(`// @vitest-environment jsdom`、各種 `vi.mock`、`setupDOM`、`initController`、`checkCheckbox`、`waitForMock`)。`vi.mock('../../utils/storage/encryptionSession.js', ...)` の factory に次を足す。

```ts
PendingRotationMismatchError: class PendingRotationMismatchError extends Error {},
```

テスト: `shows the localized pending-rotation message when the service reports a mismatch`。`isMasterPasswordSet` を `false`、`setMasterPasswordService` を `mockRejectedValue(new PendingRotationMismatchError())` にし、`initController` → `checkCheckbox` → `passwordModal` 表示待ち → `savePasswordBtn` クリック → `waitForMock(() => expect(showStatus).toHaveBeenCalledWith('status', 'i18n_masterPasswordPendingRotationMismatch', 'error'))`。もう 1 件、`the mismatch message differs from the generic abort message`(`showStatus` が `i18n_masterPasswordReencryptAborted` で呼ばれていないこと)。RED の理由: 現状は汎用 `errorMessage(e)` が表示される。

### 6. 既存テストへの影響

- `src/dashboard/__tests__/masterPassword.test.ts`、`masterPassword-ui-state.test.ts`、`masterPassword-branches.test.ts`、`masterPassword-set-guard.test.ts` は `encryptionSession.js` を factory で `vi.mock` している。各 factory の `MasterPasswordAlreadySetError: class ... extends Error {},` の行の直後へ `PendingRotationMismatchError: class PendingRotationMismatchError extends Error {},` を足す。忘れると `No "PendingRotationMismatchError" export is defined on the mock` で落ちる
- `src/utils/__tests__/storage-keys.test.ts` の `internalKeys` 配列: `StorageKeys.MASTER_PASSWORD_PENDING_SALT,` の直後に `StorageKeys.MASTER_PASSWORD_PENDING_HASH,` を足す(足さないと「全 StorageKeys が getSettings に含まれる」検証が落ちる)
- `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts`: `keeps the keyring and the device-local trust database at the top level` に `expect(isMigratableStorageKey(StorageKeys.MASTER_PASSWORD_PENDING_HASH)).toBe(false);` を追加する
- `src/utils/storage/__tests__/encryptionSession-set-guard.test.ts` の `AUTH_KEYS` は変更不要(hash キーは成功後に消えるため)。`encryptionSession-reencrypt.test.ts` は無変更で通ること(旧形式アンカーの resume が保たれている確認)
- `src/utils/__tests__/storage-locking.test.ts` のように `crypto.subtle` を空の `vi.fn()` で差し替えるテストは hash が空文字になる。新しい判定は「アンカーの hash が存在し、かつ不一致」のときだけ発火し、アンカーなしの初回は書き込みのみなので影響しない。判定を広げない(例: 空 hash を不一致扱いしない)

### 7. 検証コマンド(順番どおり)

```bash
npm run type-check
files=(src/utils/storage/types.ts src/utils/storage/encryptionSession.ts src/utils/storage/settingsMigration.ts src/utils/sensitiveDataMask.ts src/dashboard/masterPassword.ts src/utils/storage/__tests__/encryptionSession-pending-binding.test.ts src/dashboard/__tests__/masterPassword-pending-rotation.test.ts)
npx eslint "${files[@]}"
npx vitest run src/utils src/dashboard src/background src/popup
npx vitest run src/utils/storage/__tests__/encryptionSession-pending-binding.test.ts src/dashboard/__tests__/masterPassword-pending-rotation.test.ts --repeats=20
npx vitest run src/utils/storage/__tests__/encryptionSession-reencrypt.test.ts
```

3 番目は全件 green が必須。`npm run test:e2e` は UI 文言のみの追加なので必須ではない。en / ja の JSON は `node -e "JSON.parse(require('fs').readFileSync('public/_locales/en/messages.json','utf8'))"` と ja 側で構文を確認する。

### 8. 落とし穴

- 判定を `try` / `finally` の内側に置かない: `finally` は salt が metadata と一致しないとアンカーを消さないので実害は小さいが、判定は「一切の書き込み前」という受け入れ基準を構造で満たすため `try` の前に置く
- 不一致時に `port.set` / `port.remove` / `chrome.storage.local.set` を呼ばない(ciphertext・metadata・アンカー不変)。エラー・ログにパスワード、hash、salt を含めない
- salt と hash は必ず 1 回の `port.set` で書く。別々に書くと、間で中断した場合に hash のないアンカーが残る(旧形式として受理されるため安全側だが、束縛が効かない)
- 旧形式アンカー(salt のみ)は拒否しない。拒否すると、旧バージョンで中断したユーザーの resume が恒久的に閉じる(fail-open は意図的で、束縛のない状態は従来と同じ挙動)
- `constantTimeCompare` を使う。`===` にしない(hash 比較のタイミング差を避けるため)
- `ReencryptionAbortedError` を継承・再利用しない: dashboard では別のメッセージ(回復手順が異なる)を出す必要がある
- hash はパスワードの検証子であり、`MASTER_PASSWORD_HASH` と同じ扱い(`sensitiveDataMask` に追加済み)。settings export に載せない: `TOP_LEVEL_ONLY_KEYS` と、`DEFAULT_SETTINGS` に追加しないことで担保する
- 元のパスワードを忘れた場合、アンカーは残り続けて別パスワードでは進められない。この PBI では解除手段を追加しない(範囲外)。メッセージは「前回入力した新しいパスワード」を案内する
- 後続の PBI 09 / 06 は同じ `rotateToNewMasterPassword` を編集する。判定は関数の冒頭側(`validatePasswordPolicy` の後、アンカー読み取り直後)に置き、ロック取得などの追加が前後どちらに入っても意味が変わらないようにする

### 9. コミットとアーカイブ手順

(a) この PBI の受け入れ基準と Definition of Done のチェックボックスを `[x]` にする。`コードレビュー完了` だけは `[ ]` のまま。

(b)(c) 実装コミット(対象ファイルだけを個別に add):

```bash
files=(src/utils/storage/types.ts src/utils/storage/encryptionSession.ts src/utils/storage/settingsMigration.ts src/utils/sensitiveDataMask.ts src/dashboard/masterPassword.ts public/_locales/en/messages.json public/_locales/ja/messages.json dev-docs/ADR/2026-09-28-master-password-kek-reencryption.md src/utils/storage/__tests__/encryptionSession-pending-binding.test.ts src/dashboard/__tests__/masterPassword-pending-rotation.test.ts src/utils/__tests__/storage-keys.test.ts src/utils/storage/__tests__/settingsMigration-completion-state.test.ts src/dashboard/__tests__/masterPassword.test.ts src/dashboard/__tests__/masterPassword-ui-state.test.ts src/dashboard/__tests__/masterPassword-branches.test.ts src/dashboard/__tests__/masterPassword-set-guard.test.ts)
git add "${files[@]}"
git commit -m "fix(security): 中断中の KEK 回転アンカーを入力パスワードの hash に束縛する" -m "アンカーが salt だけだと、中断後に別のパスワードで再試行した際に部分移行済みの ciphertext がどちらの KEK でも読めず、原因の分からない abort を繰り返していた。アンカーに hash を併記して書き込み前に不一致を検出し、回復手順(前回と同じ新パスワードの再入力)を示す専用エラーで拒否する。hash のない旧形式アンカーは従来どおり resume できる。" -- "${files[@]}"
```

(d) アーカイブ:

```bash
git add pbi/2026-09-30-08-fix-pending-salt-password-binding.md
git mv pbi/2026-09-30-08-fix-pending-salt-password-binding.md dev-docs/archived/pbi/
git commit -m "docs(pbi): 09-30 PBI 08(PENDING_SALT のパスワード束縛)をアーカイブする" -- pbi/2026-09-30-08-fix-pending-salt-password-binding.md dev-docs/archived/pbi/2026-09-30-08-fix-pending-salt-password-binding.md
```

### 10. 完了条件

- [ ] 着手前 grep が期待どおりだった
- [ ] 新規テスト 2 ファイルが修正前に失敗し、修正後に通る
- [ ] `encryptionSession-reencrypt.test.ts` が無変更で通る
- [ ] type-check / eslint / `npx vitest run src/utils src/dashboard src/background src/popup` が全て green
- [ ] 新規テスト 2 ファイルが `--repeats=20` で全て green
- [ ] en / ja に同じ i18n キーがある
- [ ] 不一致時にアンカー・ciphertext・metadata が変化しない(テスト 2)
- [ ] ログ・エラー文言にパスワード・hash・salt が含まれない
- [ ] `types.ts` のコメントが実挙動と一致している
- [ ] 実装コミットとアーカイブコミットが分かれ、明示パスのみを対象にしている

## 見積もり

2 SP

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] i18n 更新済み(en/ja)
- [ ] コードレビュー完了
