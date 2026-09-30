# PBI: KEK 回転経路にクロスコンテキストの相互排他を追加する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを操作するユーザーとして、dashboard を複数タブで開いていても回転操作が競合しない状態を目指す。なぜなら、既存の再入ガードはページインスタンス単位のみで、回転経路の anchor read-modify-write と metadata 書き込みは無ロックのため、2 タブの同時実行で nested/scattered が別 KEK に割れ、検証失敗後のロールバックも無く API キーの再入力を強いられることがあるから。

## 優先度

- 順位: 9 / 13
- RICE スコア: 3.2(Reach=2 / Impact=1 / Confidence=0.8 / Effort=0.5)
- 根拠: 発生条件(dashboard 2 タブでの set/change 同時実行)は狭いが、命中時の実害は API キー損失。PBKDF2 600k の重なり窓は秒単位であり確率はゼロではない。

## 証拠(現行コード・反証済み)

- `src/utils/storage/encryptionSession.ts` の `encryptionKeyMutex` はモジュール内 `Mutex`(同一コンテキスト内のみ有効)。acquire/release は `getOrCreateAnonymousSecretKey` 内だけで、`rotateToNewMasterPassword` / `removeMasterPassword` は使わない
- `rotateToNewMasterPassword` の anchor 処理(`port.get(StorageKeys.MASTER_PASSWORD_PENDING_SALT)` → `port.set`)は無ロックの read-then-write
- `reencryptApiKeysToKek` の scattered 書き込みは per-field lock を避けた単一 `port.set(scatteredDelta)`(`<field>_version` を user-visible storage に書かないため)。nested は `StorageTransaction.withLock('settings', ...)`。`runSerialized` は per-context の microtask chain で、コンテキストを跨いだ排他にならない
- metadata 書き込み(`chrome.storage.local.set({ MASTER_PASSWORD_ENABLED, ... })`)と `removeMasterPassword` の `chrome.storage.local.remove([...DISABLE_REMOVED_KEYS])` も無ロック
- `src/dashboard/masterPassword.ts` の `saveInFlight` は `MasterPasswordController` インスタンス単位。2 タブは別コンテキストで互いに不可視
- `setMasterPassword` / `changeMasterPassword` / `removeMasterPassword` の呼び出し元は dashboard(`src/dashboard/masterPassword.ts`)のみ。SW は呼ばない(`src/utils/masterPassword.ts` の同名関数は別系統の死蔵コードで対象外)
- コードベースで Web Locks(`navigator.locks`)は本番コードに未使用。storage ベースのロック(lease)も存在しない。`chrome.storage.local` には原子的 CAS が無く、`StorageTransaction.withLock` の version CAS も get→set の間に他コンテキストが割り込める(コンテキスト内の直列化 + 楽観的検出であり、真の相互排他ではない)

## BDD 受け入れシナリオ

```gherkin
  Scenario: 2 タブの同時回転で後発が明示エラーで拒否される
    Given dashboard が 2 つのタブで開かれている
    When 両方で set または change を同時に実行する
    Then いずれか一方が専用エラーで失敗する
    And ciphertext が 2 つの KEK に割れて残存しない

  Scenario: 単一タブの連続操作は従来どおり成功する
    Given dashboard が 1 つのタブで開かれている
    When set → change → remove の順に実行する
    Then 全操作が成功する
```

## 受け入れ基準

- [x] set / change / remove の変更区間(検証〜再暗号化〜metadata 書き込み)を Web Locks の排他ロック(`ifAvailable: true`)でクロスコンテキスト直列化する
- [x] anchor の read-modify-write はロック内で行う(ロック取得後の再読み取りになるため別途 CAS は不要。storage 上の CAS は原子的でなく二重の保証にならない)
- [x] ロック取得失敗は専用エラー `RotationInProgressError` で即座に失敗し、dashboard が i18n(en/ja)メッセージで再試行を促す。ciphertext と metadata は変更されない
- [x] コンテキスト消滅(タブ close・crash・SW 終了)時のロックはブラウザが自動解放する。storage に holder record を持たないため TTL は不要
- [x] 既存の nested delta 書き込み(`tx.withLock`)と干渉しない(別機構のため同一 key を共有しない)

## テスト戦略

### 統合
- 2 コンテキスト相当の並列実行で後発が失敗し ciphertext が混在しないことを検証する

### 単体
- ロック取得・TTL 解放・残留ロックの検証する

## 制約

- ロックは storage key を増やさない(Web Locks は storage 外の状態)
- 非再入: ロック保持中に同じロックを再取得すると `RotationInProgressError` になるため、ロックは公開関数の最外周でのみ取る
- async/await のみ。ESM import は `.js` 拡張子

## 実装ガイド(低コストモデル向け)

### 0. 共通ルール(必読)

- ファイルは Read ツールの `offset` / `limit` で読む。`sed` / `awk` / `head` / `tail` / `cat` で読まない。検索は `grep -n`
- コードとコード内コメントは英語。コメントは非自明な WHY のみ(WHAT・変更履歴・タスク ID は書かない)
- 本番コードで `any` / `unknown` 型を使わない。ESM import は必ず `.js` 拡張子で終える
- 固定時間待ち(`setTimeout` / `sleep` / `waitForTimeout`)やリトライ回数の引き上げでテストを通さない。完了を示す Promise の await か、`testDir/waitPolicy.ts` の `waitForMock` を使う。`vi.useFakeTimers()` を既定オプションで呼ばない
- CRLF のファイルは CRLF を保つ(編集前に `file <path>` で確認)
- ツール呼び出しが権限で拒否されたら、回避せず停止して報告する

### 1. 前提と着手前チェック

方式の選定: ロックは **Web Locks API(`navigator.locks`)** を使う。理由: (a) dashboard タブ群と SW は同一 origin(chrome-extension://)で同じロック空間を共有する。(b) 排他が真に原子的。(c) コンテキストの消滅(タブ close・crash・SW 終了)でブラウザが自動解放するため TTL・holder token・残留対策が不要で、storage に key も増えない。不採用: `Mutex`(`src/utils/Mutex.ts`)と `runSerialized`(`storageTransaction.ts`)は同一コンテキスト内のみ。`StorageTransaction.withLock` / `withOptimisticLock` は `chrome.storage.local` に原子的 CAS が無く get→set の間に他コンテキストが割り込めるうえ、`<key>_version` を user-visible storage に書く。storage lease は残留と TTL の考慮が要る。

```bash
ls dev-docs/archived/pbi/ | grep -E '^2026-09-30-(01|02|03|04|05|07|08|12|13)-'
```
期待: 9 行(08 を含む)。08 が無ければ着手せず報告する(同じ `encryptionSession.ts` を編集するため順序を守る)。

```bash
grep -n "async function rotateToNewMasterPassword\|export async function setMasterPassword\|export async function changeMasterPassword\|export async function removeMasterPassword" src/utils/storage/encryptionSession.ts
```
期待: 4 行。異なれば関数名の変更を確認して停止・報告。

```bash
grep -rn "RotationInProgress\|withRotationLock\|rotationLock" src public/_locales eslint dev-docs/LAYERS.md
```
期待: 出力なし(未実装)。出力があれば実装済みの可能性があるので停止・報告。

```bash
node -e "console.log(typeof navigator.locks)"
```
期待: `object`。`undefined` なら Node を更新する(`package.json` の engines は >=24.0.0 だが、`navigator.locks` は 24.5 以降)。

### 2. 変更対象ファイル

編集する:
- 新規 `src/utils/storage/rotationLock.ts`
- `src/utils/storage/encryptionSession.ts`(`setMasterPassword` / `changeMasterPassword` / `removeMasterPassword`、re-export)
- `src/dashboard/masterPassword.ts`(エラー表示)
- `eslint/rules/utils-layer-boundary.mjs`(`LAYER1_FILES` に追加)、`dev-docs/LAYERS.md`(Layer 1 一覧に追加)
- `public/_locales/en/messages.json`、`public/_locales/ja/messages.json`
- 新規テスト 2 本、既存テスト 4 本(後述)

触らない: `rotateToNewMasterPassword` の内部(08 の領域。ロックは呼び出し側で取る)、`reencryptApiKeysToKek`、`getOrCreateAnonymousSecretKey` と `encryptionKeyMutex`、`storageTransaction.ts`、`src/utils/masterPassword.ts`(死蔵コード、別 PBI)、`unlockWithPassword`、他の PBI ファイル、`vitest.setup.ts`。

### 3. 手順

**手順 1: `src/utils/storage/rotationLock.ts` を新規作成する。**

```ts
// @layer 1 — Infrastructure: cross-context mutual exclusion for master-password KEK rotation
export const ROTATION_LOCK_NAME = 'yasumaro:master-password-rotation';

export class RotationInProgressError extends Error {
  constructor() {
    super('RotationInProgressError: another master password operation is in progress');
    this.name = 'RotationInProgressError';
  }
}

// The default is read per call (not at module load) so tests can inject a manager.
export async function withRotationLock<T>(
  fn: () => Promise<T>,
  locks: Pick<LockManager, 'request'> | null = globalThis.navigator?.locks ?? null,
): Promise<T> {
  if (locks === null) {
    // Fail closed: running unserialized is what this lock exists to prevent.
    throw new Error('ROTATION_LOCK_UNAVAILABLE: Web Locks API is not available');
  }
  return locks.request(ROTATION_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (lock === null) throw new RotationInProgressError();
    return fn();
  });
}
```
`ifAvailable: true` は取得できないとき待たずに callback へ `null` を渡す。callback が throw / reject すれば `request` も同じ理由で reject し、ロックは自動解放される。

**手順 2: `encryptionSession.ts` で import と re-export を追加する**(`export { ReencryptionAbortedError };` の直後)。

```ts
import { withRotationLock, RotationInProgressError } from './rotationLock.js';
export { RotationInProgressError };
```

**手順 3: `setMasterPassword` のガードと回転を 1 つのロックで囲む。** ガードだけロック外に置くと、2 タブが同時にガードを通過し後発が先発の完了後に salt/hash を上書きする。`withRotationLock` は関数の最初の await より前に呼ぶ(並列テストの決定性のため)。

```ts
// before
if (await isMasterPasswordEnabled()) { throw new MasterPasswordAlreadySetError(); }
await rotateToNewMasterPassword({ password, resolvePrevious: () => getOrCreateEncryptionKey(), lockAfter: true });
// after
await withRotationLock(async () => {
    if (await isMasterPasswordEnabled()) { throw new MasterPasswordAlreadySetError(); }
    await rotateToNewMasterPassword({ password, resolvePrevious: () => getOrCreateEncryptionKey(), lockAfter: true });
});
```
既存のガード直前コメント(Outside the re-encryption path ...)はそのままガードの上に残す。後続の `cachedMasterPassword = null` 等はロックの外(成功後)でよい。

**手順 4: `changeMasterPassword` は `unlockWithPassword` の後、`rotateToNewMasterPassword` だけを囲む。** unlock(レート制限・PBKDF2 検証)まで囲むとロック保持が長くなる。

```ts
await withRotationLock(() => rotateToNewMasterPassword({
    password: newPassword,
    resolvePrevious: () => getOrCreateEncryptionKey(),
    lockAfter: false,
}));
```

**手順 5: `removeMasterPassword` は既存本体を非公開関数へ移し、公開関数でロックする。**

```ts
async function removeMasterPasswordUnlocked(password?: string): Promise<void> { /* existing body unchanged */ }

export async function removeMasterPassword(password?: string): Promise<void> {
    return withRotationLock(() => removeMasterPasswordUnlocked(password));
}
```
JSDoc は公開関数側へ移す。

**手順 6: dashboard のエラー表示。** `src/dashboard/masterPassword.ts` の import(`from '../utils/storage/encryptionSession.js'` のブロック)に `RotationInProgressError` を追加し、2 箇所を直す。

```ts
// savePasswordInner catch: add before the generic else
} else if (e instanceof RotationInProgressError) {
  showStatus('status', getMessage('masterPasswordRotationInProgress'), 'error');
}
// authenticatePassword catch (remove flow)
this.dom.passwordAuthError.textContent = e instanceof ReencryptionAbortedError
  ? this.abortMessage(e)
  : e instanceof RotationInProgressError
    ? getMessage('masterPasswordRotationInProgress')
    : errorMessage(e);
```

**手順 7: i18n。** 同じキーを両ファイルの `masterPasswordAlreadySet` の直後に追加する。
- en: `"masterPasswordRotationInProgress": { "message": "Another tab or window is changing the master password. Wait for it to finish, then try again." }`
- ja: `"masterPasswordRotationInProgress": { "message": "別のタブまたはウィンドウでマスターパスワードを変更中です。完了してからもう一度お試しください。" }`

**手順 8: 層登録。** `eslint/rules/utils-layer-boundary.mjs` の `LAYER1_FILES` に `'src/utils/storage/rotationLock.ts',` を `settingsSnapshot.ts` の行の下へ、`dev-docs/LAYERS.md` の Layer 1 一覧の `settingsSnapshot.ts` 行の下へ `src/utils/storage/rotationLock.ts — KEK 回転のクロスコンテキスト排他(Web Locks)` を追加する。

### 4. テスト先行(RED)

各テストは手順 1 以降の実装より前に書き、`npx vitest run <file>` で実行して**失敗することを確認**してから実装する(新規ファイルは import 解決エラーで落ちてよい。落ちない場合はテストが無意味なので書き直す)。

**(a) `src/utils/storage/__tests__/rotationLock.test.ts`(単体)** — `import { withRotationLock, RotationInProgressError, ROTATION_LOCK_NAME } from '../rotationLock.js';`
- `it('runs fn and returns its value when the lock is granted')`: Given `const granted = { request: vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb({})) } as unknown as Pick<LockManager, 'request'>`。When `withRotationLock(async () => 'ok', granted)`。Then `'ok'`。
- `it('requests an exclusive ifAvailable lock under the fixed name')`: 上と同じ fake に対し `expect(granted.request).toHaveBeenCalledWith(ROTATION_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, expect.any(Function))`。
- `it('rejects with RotationInProgressError and skips fn when the lock is unavailable')`: fake が `cb(null)` を呼ぶ。`fn = vi.fn()`。Then `rejects.toBeInstanceOf(RotationInProgressError)` かつ `fn` 未呼び出し。
- `it('fails closed when the Web Locks API is missing')`: 第 2 引数 `null`。Then `rejects.toThrow(/ROTATION_LOCK_UNAVAILABLE/)`、`fn` 未呼び出し。
- `it('releases the lock when fn throws')`(実 `navigator.locks`): `await expect(withRotationLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom')`。続けて `await expect(withRotationLock(async () => 'again')).resolves.toBe('again')`、`(await navigator.locks.query()).held` に `ROTATION_LOCK_NAME` が無い。
- `it('is not re-entrant: a nested call fails instead of deadlocking')`: `withRotationLock(() => withRotationLock(async () => 'x'))` が `rejects.toBeInstanceOf(RotationInProgressError)`。
- `it('rejects the second of two concurrent callers')`: `let release!: () => void; const gate = new Promise<void>((r) => { release = r; });` A = `withRotationLock(() => gate)`、B = `withRotationLock(async () => 'b')`。B が `RotationInProgressError` で reject、`release()` 後に A が resolve。

**(b) `src/utils/storage/__tests__/encryptionSession-rotation-lock.test.ts`(結合)** — `encryptionSession-set-guard.test.ts` の先頭(`vi.mock('../../crypto/cryptoParams.js', ...)` の PBKDF2 反復を 1_000 に下げる mock、`rateLimiter` / `authGuard` の mock、`AUTH_KEYS`、`beforeEach` の `chrome.storage.local.clear()` / `setSecretKeyStorageOverride` / `clearEncryptionKeyCache()`、`snapshotAuth`)をそのままコピーする。他クロスコンテキストの保持者は、テスト内で実ロックを保持して再現する:

```ts
async function withForeignHolder<T>(body: () => Promise<T>): Promise<T> {
  let release!: () => void;
  let acquired!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const ready = new Promise<void>((r) => { acquired = r; });
  const holder = navigator.locks.request(ROTATION_LOCK_NAME, async () => { acquired(); await held; });
  await ready;
  try { return await body(); } finally { release(); await holder; }
}
```
テスト(Given/When/Then。すべて `RotationInProgressError` は `../rotationLock.js` から import):
1. `set is refused while another context holds the lock and writes nothing`: When `withForeignHolder(() => setMasterPassword('NewP@ssw0rd123!'))`。Then reject が `RotationInProgressError`、`vi.spyOn(chrome.storage.local, 'set')` が未呼び出し、`snapshotAuth()` が空(`ENABLED` / `PENDING_SALT` 含め undefined)。
2. `change is refused while another context holds the lock and leaves auth metadata untouched`: Given `setMasterPassword('OldP@ssw0rd123!')`、`before = await snapshotAuth()`。When holder 下で `changeMasterPassword('OldP@ssw0rd123!', 'NewP@ssw0rd123!')`。Then `RotationInProgressError`。比較は SALT / HASH / ENABLED / KDF_ITERATIONS / PENDING_SALT のみ(`unlockWithPassword` が `IS_LOCKED` を書くため `IS_LOCKED` は比較しない)。解放後 `unlockWithPassword('OldP@ssw0rd123!')` が true。
3. `remove is refused while another context holds the lock and keeps the password enabled`: Given set 済み。When holder 下で `removeMasterPassword('OldP@ssw0rd123!')`。Then `RotationInProgressError`、`isMasterPasswordEnabled()` が true、`set` / `remove` spy 未呼び出し。
4. `two simultaneous sets: exactly one wins`: `const [a, b] = await Promise.allSettled([setMasterPassword('FirstP@ssw0rd123!'), setMasterPassword('SecondP@ssw0rd456!')])`。Then `a.status === 'fulfilled'`、`b.status === 'rejected'` かつ reason が `RotationInProgressError`。実ロックの grant 順は要求順のため決定的。`unlockWithPassword('FirstP@ssw0rd123!')` が true。
5. `releases the lock after success and after a failed operation`: set 成功後、および 2 回目の `setMasterPassword`(`MasterPasswordAlreadySetError`)後に `(await navigator.locks.query()).held ?? []` が `ROTATION_LOCK_NAME` を含まない。
6. `sequential set, change, remove all succeed in one context`: set → `changeMasterPassword` → `removeMasterPassword` がすべて成功。
7. `error text carries no password`: 1 のエラー `message` が渡したパスワード文字列を含まない。

**(c) `src/dashboard/__tests__/masterPassword-set-guard.test.ts`(既存に追加)**: factory に `RotationInProgressError` を追加(§5)し、`it('shows the rotation-in-progress message when another tab holds the lock')`: `vi.mocked(setMasterPasswordService).mockRejectedValue(new RotationInProgressError())`、既存の already-set テストと同じ操作で `waitForMock(() => expect(showStatus).toHaveBeenCalledWith('status', 'i18n_masterPasswordRotationInProgress', 'error'))`。

### 5. 既存テストへの影響

- `vi.mock('../../utils/storage/encryptionSession.js', () => ({ ... }))` の factory を持つ次の 4 本に `RotationInProgressError: class RotationInProgressError extends Error {},` を追加する(無いと `No "RotationInProgressError" export is defined on the mock` で落ちる): `src/dashboard/__tests__/masterPassword.test.ts`、`masterPassword-ui-state.test.ts`、`masterPassword-branches.test.ts`、`masterPassword-set-guard.test.ts`。他に落ちる dashboard テストがあれば同様に対処。
- `encryptionSession-*.test.ts`(実モジュール)は実 `navigator.locks` で動き影響なし。ロックは操作ごとに解放されるため、テスト間で持ち越さない。
- `src/utils/__tests__/storage-locking.test.ts` は crypto.subtle を空の `vi.fn()` で stub するが、set/change/remove を呼ばないので影響しない。新ガードは「ロック取得失敗」のみで発火し、暗号出力を見ない。
- `vi.stubGlobal('navigator', ...)` する既存テスト(例 `browserSupport.test.ts`)は回転を呼ばないため影響しない。回転を呼ぶテストで `navigator` を stub している場合は `locks` を含めるか stub を外す。
- 層テスト: `npm run lint:layers-docs` が手順 8 の登録漏れを検出する。

### 6. 検証コマンド(順番どおり)

```bash
npm run type-check
npx eslint src/utils/storage/rotationLock.ts src/utils/storage/encryptionSession.ts src/dashboard/masterPassword.ts eslint/rules/utils-layer-boundary.mjs src/utils/storage/__tests__/rotationLock.test.ts src/utils/storage/__tests__/encryptionSession-rotation-lock.test.ts src/dashboard/__tests__/masterPassword-set-guard.test.ts
npm run lint:layers-docs
npx vitest run src/utils src/dashboard src/background src/popup
npx vitest run src/utils/storage/__tests__/rotationLock.test.ts src/utils/storage/__tests__/encryptionSession-rotation-lock.test.ts src/dashboard/__tests__/masterPassword-set-guard.test.ts --repeats=20
npm run build && npm run test:e2e -- dashboard-master-password-reencrypt.spec.ts
```
`src/utils src/dashboard src/background src/popup` は全件 green が必須。失敗を待ち時間で塞がない。`--repeats=20` は失敗ゼロが条件。E2E はビルド済み拡張を使い、単一タブの set/remove 回帰確認(2 タブ同時操作は結合テストで担保)。i18n は 2 言語同時追加済みであること(`grep -n masterPasswordRotationInProgress public/_locales/*/messages.json` が 2 行)。

### 7. 落とし穴

- ロックの解放は `request` の callback が settle した時点で自動。手動 release 用の try/finally を足さない(二重解放の余地を作るだけ)。callback 内で例外を握りつぶさない(握りつぶすと失敗が成功として返る)
- 非再入: ロック内から `setMasterPassword` 等の公開関数を呼ぶと必ず `RotationInProgressError` になる(デッドロックではなく即失敗)。ロックは公開関数の最外周のみに置き、`rotateToNewMasterPassword` の内部に足さない(`changeMasterPassword` → `rotate` と `setMasterPassword` → `rotate` で二重取得になる)
- `unlockWithPassword`(レート制限あり)をロック内に入れない。ロック内から `Mutex.acquire`(30 秒 timeout)を待つ処理は既存の `getOrCreateAnonymousSecretKey` のみで、`removeMasterPasswordUnlocked` 内から呼ばれる現状は再入にならない(別機構)。ロックを取る順序は常に「回転ロック → `encryptionKeyMutex`」で固定し、逆順を作らない
- フェイルクローズ: API 不在(`locks === null`)は成功させず `ROTATION_LOCK_UNAVAILABLE` で失敗させる。フェイルオープンにすると無防備な並行回転(API キー損失)を黙って許す
- 取得失敗は待たずに即失敗(`ifAvailable: true`)。待つ方式は PBKDF2 600k の間 UI が固まり、後発が先発の結果を上書きする
- SW / タブが保持中に終了してもロックはブラウザが解放する。途中終了した回転の再開は既存の `MASTER_PASSWORD_PENDING_SALT` anchor(resume)が担うため、ロック側に永続状態を持たせない
- ログ・エラー文言にパスワード、salt、hash、KEK、ciphertext を含めない。`RotationInProgressError` のメッセージは固定文字列のみ
- `changeMasterPassword` は `unlockWithPassword` 成功後に `RotationInProgressError` になり得る(セッションは旧パスワードで unlock 済みのまま)。これは既に検証済みの状態であり許容。ロック取得後の再検証は追加しない(他タブが先に回転していた場合は旧 KEK で復号できず `ReencryptionAbortedError` で書き込みゼロのまま中止される)
- ロック名は定数 `ROTATION_LOCK_NAME` に一本化し、文字列リテラルをテスト以外に散らさない

### 8. コミットとアーカイブ手順

(a) 本 PBI の受け入れ基準と Definition of Done のチェックボックスを `[x]` にする(`コードレビュー完了` は `[ ]` のまま)。

(b)(c) 実装コミット(zsh。配列に入れて `"${files[@]}"` で展開する。引用符なしの文字列変数は分割されない):

```bash
files=(
  src/utils/storage/rotationLock.ts
  src/utils/storage/encryptionSession.ts
  src/dashboard/masterPassword.ts
  eslint/rules/utils-layer-boundary.mjs
  dev-docs/LAYERS.md
  public/_locales/en/messages.json
  public/_locales/ja/messages.json
  src/utils/storage/__tests__/rotationLock.test.ts
  src/utils/storage/__tests__/encryptionSession-rotation-lock.test.ts
  src/dashboard/__tests__/masterPassword.test.ts
  src/dashboard/__tests__/masterPassword-ui-state.test.ts
  src/dashboard/__tests__/masterPassword-branches.test.ts
  src/dashboard/__tests__/masterPassword-set-guard.test.ts
)
git add "${files[@]}"
git commit -m "fix(security): マスターパスワード回転をコンテキスト間で排他する" -m "dashboard を 2 タブで開くと set/change/remove の再暗号化が並行し、nested と scattered の API キーが別 KEK に割れて再入力を強いられうる。ページ単位の再入ガードはコンテキストを跨げないため、コンテキスト消滅で自動解放される Web Locks を ifAvailable で取り、後発を RotationInProgressError で即失敗させる。" -- "${files[@]}"
```
(`git add -A` / `git add .` は使わない。)

(d) アーカイブ:

```bash
git add pbi/2026-09-30-09-fix-kek-rotation-cross-context-lock.md
git mv pbi/2026-09-30-09-fix-kek-rotation-cross-context-lock.md dev-docs/archived/pbi/
arch=(pbi/2026-09-30-09-fix-kek-rotation-cross-context-lock.md dev-docs/archived/pbi/2026-09-30-09-fix-kek-rotation-cross-context-lock.md)
git commit -m "docs(pbi): 09-30 PBI 09(KEK 回転の相互排他)をアーカイブする" -- "${arch[@]}"
```

### 9. 完了条件

- [x] `rotationLock.ts` が `withRotationLock` / `RotationInProgressError` / `ROTATION_LOCK_NAME` を export し、`encryptionSession.ts` が `RotationInProgressError` を再 export している
- [x] set(ガード込み)・change(`rotateToNewMasterPassword` のみ)・remove(本体全体)がロック内で実行され、`rotateToNewMasterPassword` 内部にはロックが無い
- [x] 新規テストを実装前に走らせて失敗を確認し、実装後に green(`--repeats=20` も green)
- [x] 既存 4 本の dashboard テストの factory に `RotationInProgressError` を追加し、`npx vitest run src/utils src/dashboard src/background src/popup` が全件 green
- [x] `type-check` / `eslint` / `lint:layers-docs` が green、i18n が en/ja 両方に存在
- [x] ログ・エラーにパスワード等の機微情報が出ない
- [x] 実装コミットとアーカイブコミットが分かれ、`git add -A` を使っていない

## 見積もり

2 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
