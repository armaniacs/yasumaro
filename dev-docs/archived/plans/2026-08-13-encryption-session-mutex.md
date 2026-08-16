# encryptionSession排他制御 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `getOrCreateEncryptionKey()`のsession→local復元処理を`Mutex`で排他制御し、アップデート直後の並行呼び出しによって既存の暗号化済みAPIキーが復号不能になる事故を防ぐ。

**Architecture:** 既存の`src/utils/Mutex.ts`をそのまま使い、`getOrCreateEncryptionKey()`内の「マスターパスワード無効と判明した後〜新規secret生成の書き込み完了まで」の区間をロックする。ロック取得後は`chrome.storage.local`を必ず再読み込みする（ダブルチェック）ことで、ロック待ち中に他の呼び出しが復元・生成を完了させていた場合にそれを検知し、二重の新規生成を防ぐ。

**Tech Stack:** TypeScript, Vitest（`environment: 'node'`, `globals: true`）, Chrome Extension `chrome.storage.local`/`chrome.storage.session` API

---

## 事前に必ず読むこと（このプロジェクト特有の注意点）

1. **テストランナーはVitestです。Jestではありません。** `describe`/`it`/`expect`/`vi`はグローバルに使えるため`import`不要ですが、このプロジェクトの既存テストは明示的に`import { describe, it, expect, vi, beforeEach } from 'vitest';`と書くスタイルが多いので、それに合わせます。
2. **`chrome.storage`のモックは`testDir/vitest.setup.ts`で既にグローバルに用意されています。** 個々のテストファイルで`chrome`オブジェクト全体を作り直す必要はありません。`vi.spyOn(chrome.storage.session, 'get')`のように、必要な部分だけスパイ（差し替え）します。
3. **`beforeEach`でstorageの中身は自動的に空にリセットされます。** 各テストの冒頭で`chrome.storage.local.set(...)`で必要な初期状態を作ってください。
4. **JavaScriptの非同期処理は「awaitのある場所でだけ」他の処理に実行が切り替わります。** `await`を含まない同期的なコードブロックは、他の処理に横入りされることはありません。このPBIで問題になっているのは、`await chrome.storage.session.get(...)`のような`await`をまたぐ処理の間に、別の呼び出しが割り込むケースです。

---

## Task 1: Mutexで保護する区間を特定し、既存コードを読む

**Files:**
- Read（変更しない）: `src/utils/storage/encryptionSession.ts:93-191`
- Read（変更しない）: `src/utils/Mutex.ts`

- [ ] **Step 1: 対象ファイルを読む**

以下のコマンドで対象関数の現在のコードを確認してください。

```bash
sed -n '93,191p' src/utils/storage/encryptionSession.ts
```

以下のような内容が表示されるはずです（要点だけ抜粋、実際のコードには日本語コメントが多数あります）:

```typescript
export async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    if (cachedEncryptionKey) {
        // ... ロック確認して cachedEncryptionKey を return（105-108行目）
        return cachedEncryptionKey;
    }

    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.ENCRYPTION_SALT,
        StorageKeys.ENCRYPTION_SECRET,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.IS_LOCKED
    ]);

    const masterPasswordEnabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;

    if (masterPasswordEnabled) {
        // ... マスターパスワード分岐、この中でreturnする（125-140行目）
        return cachedEncryptionKey;
    }

    // ここから下（143行目以降）が今回ロックする対象
    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT] as string;
    let secret = result[StorageKeys.ENCRYPTION_SECRET] as string;

    if (saltBase64 && !secret && chrome.storage.session) {
        const sessionResult = await chrome.storage.session.get(StorageKeys.ENCRYPTION_SECRET);
        const sessionSecret = sessionResult[StorageKeys.ENCRYPTION_SECRET] as string | undefined;
        if (sessionSecret) {
            secret = sessionSecret;
            await chrome.storage.local.set({ [StorageKeys.ENCRYPTION_SECRET]: secret });
            await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
        }
    }

    if (!saltBase64 || !secret) {
        const salt = generateSalt();
        saltBase64 = btoa(String.fromCharCode(...salt));
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));

        await chrome.storage.local.set({
            [StorageKeys.ENCRYPTION_SALT]: saltBase64,
            [StorageKeys.ENCRYPTION_SECRET]: secret
        });
    }

    const salt = base64ToUint8Array(saltBase64);
    cachedEncryptionKey = await deriveKey(secret, salt);
    return cachedEncryptionKey;
}
```

**なぜこの範囲を読むか**: ロックをどこからどこまでにするか（Task 3で実装）を正確に決めるために、まず全体の構造を把握します。

- [ ] **Step 2: Mutexクラスの使い方を確認する**

```bash
cat src/utils/Mutex.ts
```

使い方のポイント（`src/background/obsidianClient.ts`の実例と同じパターン）:

```typescript
const myMutex = new Mutex();

async function protectedFunction() {
    await myMutex.acquire();
    try {
        // ロック中に実行したい処理
    } finally {
        myMutex.release(); // 例外が起きても必ず解放する
    }
}
```

**なぜ`try`/`finally`が必須か**: ロック中の処理でエラーが起きても`release()`を呼ばないと、Mutexが永久にロックされたままになり、以降すべての呼び出しが最大30秒待たされた末にタイムアウトエラーになってしまいます。

- [ ] **Step 3: このタスクにはコミットするコード変更がないため、次のタスクへ進む**

（このタスクは調査のみです。ファイルを変更していないので `git commit` は不要です。）

---

## Task 2: 遅延注入テストヘルパーを用意し、失敗するテストを書く

**Files:**
- Create: `src/utils/storage/__tests__/encryptionSession-concurrency.test.ts`

- [ ] **Step 1: テストファイルを作成する**

以下の内容で新規ファイルを作成してください。

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateEncryptionKey, clearEncryptionKeyCache } from '../encryptionSession.js';
import { StorageKeys } from '../types.js';

/**
 * Resolves `value` after `ms` milliseconds using setTimeout instead of an
 * immediately-resolved Promise. A plain Promise.resolve() would let Node's
 * microtask queue interleave calls unpredictably, making the race we want
 * to test flaky. setTimeout forces a macrotask boundary so we can control
 * ordering deterministically in the test below.
 */
function delayedValue<T>(value: T, ms: number): Promise<T> {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('getOrCreateEncryptionKey concurrency', () => {
    beforeEach(() => {
        // モジュールスコープのキャッシュ変数をテスト間でリセットする。
        // これをしないと、前のテストで生成された cachedEncryptionKey が
        // 残ったままになり、このテストが意味をなさなくなる。
        clearEncryptionKeyCache();
        vi.restoreAllMocks();
    });

    it('does not regenerate a new secret when two calls race during session-to-local migration', async () => {
        // 前提条件を作る: saltはlocalにあるがsecretはまだ無く（＝復元前の状態）、
        // session側に旧バージョンから引き継がれたsecretが残っている状態を再現する。
        await chrome.storage.local.set({
            [StorageKeys.MASTER_PASSWORD_ENABLED]: false,
            [StorageKeys.ENCRYPTION_SALT]: 'ZmFrZS1zYWx0LWJhc2U2NA==',
        });
        await chrome.storage.session.set({
            [StorageKeys.ENCRYPTION_SECRET]: 'ZmFrZS1zZWNyZXQtYmFzZTY0',
        });

        // Aのsession.removeが呼ばれた「直後」にBの呼び出しを開始することで、
        // 「Aが復元を終えてsessionをクリアした直後に、Bが空のsessionを読んで
        // しまい、誤って新しいsecretを生成してしまう」というPBIで報告された
        // レースを確実に再現する。
        let callBPromise: Promise<CryptoKey> | null = null;
        const removeSpy = vi.spyOn(chrome.storage.session, 'remove');
        removeSpy.mockImplementation(async (keys: string | string[]) => {
            // 元のモック実装を手動で呼ぶ代わりに、直接sessionのバックエンドを
            // 操作する。testDir/vitest.setup.ts のモックは内部でクロージャに
            // 閉じたオブジェクトを使っているため、chrome.storage.session.remove
            // の「本来の」振る舞い（該当キーの削除）をここで再現する。
            const keyList = Array.isArray(keys) ? keys : [keys];
            const current = await chrome.storage.session.get(null);
            const remaining = { ...current };
            for (const k of keyList) delete remaining[k];
            await chrome.storage.session.clear();
            await chrome.storage.session.set(remaining);

            // Aのremoveが完了した直後にBを起動する。
            callBPromise = getOrCreateEncryptionKey();
            return Promise.resolve();
        });

        const keyA = await getOrCreateEncryptionKey();
        expect(callBPromise).not.toBeNull();
        const keyB = await callBPromise!;

        // 両方の呼び出しが同一のsecretから導出されたキーを返すはず。
        // secretそのものは比較できない（CryptoKeyはopaqueなオブジェクトの
        // ため）ので、localに保存されたENCRYPTION_SECRETが1回しか
        // 書き換えられていないこと（＝新規生成が2回発生していないこと）を、
        // 導出されたキー同士が同じ内容で暗号化・復号できることで間接的に
        // 確認する。
        const encoder = new TextEncoder();
        const plaintext = encoder.encode('race-condition-check');
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipherFromA = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyA, plaintext);
        const decryptedWithB = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyB, cipherFromA);
        expect(new TextDecoder().decode(decryptedWithB)).toBe('race-condition-check');
    });
});
```

**なぜこの検証方法か**: `CryptoKey`オブジェクト同士を`toBe`や`toEqual`で直接比較することはできません（不透明な鍵オブジェクトのため）。そこで「Aが導出したキーで暗号化したデータを、Bが導出したキーで復号できるか」を確認することで、間接的に「AとBが同じsecretからキーを導出できたか」を検証します。もし修正前のバグが再現していれば、Bは別のランダムなsecretから別のキーを導出してしまうため、この復号は失敗します（例外が投げられるか、内容が一致しません）。

- [ ] **Step 2: `clearEncryptionKeyCache`が既にexportされているか確認する**

```bash
grep -n "export.*clearEncryptionKeyCache" src/utils/storage/encryptionSession.ts
```

期待する出力: `export function clearEncryptionKeyCache(): void {` のような行が表示されること（既存の関数なので、新規作成は不要のはずです）。もし見つからない場合は、`src/utils/storage/encryptionSession.ts`を検索して同等の関数名を探し、テストコードのimportをその名前に合わせてください。

- [ ] **Step 3: テストを実行し、失敗することを確認する**

```bash
npx vitest run src/utils/storage/__tests__/encryptionSession-concurrency.test.ts
```

**期待される結果**: テストが失敗する（`expect(...).toBe('race-condition-check')`が一致しない、または復号時に例外が発生する）。これは、まだMutexによる排他制御を実装していないため、意図通りバグが再現されている状態です。

もしテストがこの時点で**成功してしまう場合**は、レースが正しく再現できていません。その場合は以下を疑ってください：
- `removeSpy`のモック実装内で`callBPromise`への代入が実際に実行されているか（`console.log`を一時的に挟んで確認する）
- `chrome.storage.session.remove`が本当に`getOrCreateEncryptionKey`の実装内から呼ばれているか（`src/utils/storage/encryptionSession.ts`の該当行を`grep`で再確認する）

- [ ] **Step 4: コミットする**

```bash
git add src/utils/storage/__tests__/encryptionSession-concurrency.test.ts
git commit -m "test(encryption-session): add failing test for session-restore race condition"
```

---

## Task 3: Mutexを導入してテストをグリーンにする

**Files:**
- Modify: `src/utils/storage/encryptionSession.ts`

- [ ] **Step 1: `Mutex`をimportし、モジュールスコープのインスタンスを作る**

`src/utils/storage/encryptionSession.ts`の先頭付近、既存のimport群のすぐ下に以下を追加してください。

```typescript
import { StorageKeys } from './types.js';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '../rateLimiter.js';
import { Mutex } from '../Mutex.js';
```

そして、`let cachedEncryptionKey: CryptoKey | null = null;`など、モジュールスコープの変数が定義されているブロック（24-27行目付近）に以下を追加してください。

```typescript
let cachedEncryptionKey: CryptoKey | null = null;
let cachedMasterPassword: string | null = null;
let isMasterPasswordRequired = false;
let cachedHmacSecret: string | null = null;
// getOrCreateEncryptionKey の session→local 復元・新規secret生成を排他制御する。
// アップデート直後に複数のメッセージハンドラからほぼ同時に呼ばれた場合、
// この区間をロックしないと片方が誤って新しいsecretを生成し、既存の
// 暗号化済みAPIキーが復号不能になる（2026-08-12インシデントの再発防止）。
const encryptionKeyMutex = new Mutex();
```

**なぜモジュールスコープに置くか**: `getOrCreateEncryptionKey`が呼ばれるたびに新しい`Mutex`を作ってしまうと、ロックの意味がなくなります（別々のMutexインスタンスは互いに排他しません）。プロセス（Service Worker）が生きている間、ずっと同じインスタンスを使い続ける必要があります。

- [ ] **Step 2: ロック対象の区間を`try`/`finally`で囲む**

`src/utils/storage/encryptionSession.ts`内の`getOrCreateEncryptionKey`関数を、以下のように書き換えてください。**「// ここから下」というコメントより前は変更しません。**

変更前（143行目あたりから、マスターパスワード無効と判明した直後）:

```typescript
    // マスターパスワード未設定の場合：従来の方式を使用（マイグレーション準備）
    // 【重要】ENCRYPTION_SECRET は chrome.storage.local に保存する。
    // (中略、既存の日本語コメントはそのまま残す)
    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT] as string;
    let secret = result[StorageKeys.ENCRYPTION_SECRET] as string;

    // 救済マイグレーション: (中略、既存コメントはそのまま残す)
    if (saltBase64 && !secret && chrome.storage.session) {
        const sessionResult = await chrome.storage.session.get(StorageKeys.ENCRYPTION_SECRET);
        const sessionSecret = sessionResult[StorageKeys.ENCRYPTION_SECRET] as string | undefined;
        if (sessionSecret) {
            secret = sessionSecret;
            await chrome.storage.local.set({
                [StorageKeys.ENCRYPTION_SECRET]: secret
            });
            await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
        }
    }

    if (!saltBase64 || !secret) {
        // 初回: ソルトとシークレットを生成
        const salt = generateSalt();
        saltBase64 = btoa(String.fromCharCode(...salt));
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));

        await chrome.storage.local.set({
            [StorageKeys.ENCRYPTION_SALT]: saltBase64,
            [StorageKeys.ENCRYPTION_SECRET]: secret
        });
    }

    const salt = base64ToUint8Array(saltBase64);

    // ランダムなsecretとsaltからPBKDF2でキー導出
    cachedEncryptionKey = await deriveKey(secret, salt);
    return cachedEncryptionKey;
}
```

変更後（この全体で置き換えてください）:

```typescript
    // マスターパスワード未設定の場合：従来の方式を使用（マイグレーション準備）
    // 【重要】ENCRYPTION_SECRET は chrome.storage.local に保存する。
    // (中略、既存の日本語コメントはそのまま残す)
    // この時点の saltBase64/secret はロック取得"前"に読んだ値であり、
    // ロック待ち中に別の呼び出しが状態を変えている可能性がある。実際に
    // 使う値は下の recheck で読み直すため、ここでの代入はロック取得前の
    // 一時的なプレースホルダに過ぎない（未使用変数警告を避けるためだけに残す）。
    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT] as string;
    let secret = result[StorageKeys.ENCRYPTION_SECRET] as string;

    // session→local復元と新規secret生成は排他制御する。ロック待ち中に
    // 別の呼び出しが復元・生成を完了させている可能性があるため、ロック
    // 取得後は必ず chrome.storage.local を読み直す（ダブルチェック）。
    await encryptionKeyMutex.acquire();
    try {
        const recheck = await chrome.storage.local.get([
            StorageKeys.ENCRYPTION_SALT,
            StorageKeys.ENCRYPTION_SECRET,
        ]);
        saltBase64 = recheck[StorageKeys.ENCRYPTION_SALT] as string;
        secret = recheck[StorageKeys.ENCRYPTION_SECRET] as string;

        // 救済マイグレーション: (中略、既存コメントはそのまま残す)
        if (saltBase64 && !secret && chrome.storage.session) {
            const sessionResult = await chrome.storage.session.get(StorageKeys.ENCRYPTION_SECRET);
            const sessionSecret = sessionResult[StorageKeys.ENCRYPTION_SECRET] as string | undefined;
            if (sessionSecret) {
                secret = sessionSecret;
                await chrome.storage.local.set({
                    [StorageKeys.ENCRYPTION_SECRET]: secret
                });
                await chrome.storage.session.remove(StorageKeys.ENCRYPTION_SECRET);
            }
        }

        if (!saltBase64 || !secret) {
            // 初回: ソルトとシークレットを生成
            const salt = generateSalt();
            saltBase64 = btoa(String.fromCharCode(...salt));
            // 32バイトのランダムシークレットを生成
            const secretBytes = crypto.getRandomValues(new Uint8Array(32));
            secret = btoa(String.fromCharCode(...secretBytes));

            await chrome.storage.local.set({
                [StorageKeys.ENCRYPTION_SALT]: saltBase64,
                [StorageKeys.ENCRYPTION_SECRET]: secret
            });
        }
    } finally {
        encryptionKeyMutex.release();
    }

    const salt = base64ToUint8Array(saltBase64);

    // ランダムなsecretとsaltからPBKDF2でキー導出
    cachedEncryptionKey = await deriveKey(secret, salt);
    return cachedEncryptionKey;
}
```

**このステップで何をしたか**:
1. `encryptionKeyMutex.acquire()`でロックを取得（既にロック中なら、解放されるまで待つ）
2. ロック取得直後に`chrome.storage.local`を再読み込みし、`saltBase64`/`secret`をロック取得後の最新状態で上書き（ダブルチェック）
3. 元々あった復元・新規生成のロジックはそのまま`try`ブロックの中に移動
4. `finally`で必ずロックを解放

**なぜダブルチェックが必要か**: Mutexは「順番」を保証するだけです。もしダブルチェックをせずに、関数の最初（111行目）で読んだ古い`saltBase64`/`secret`をそのまま使うと、ロック待ちしている間に別の呼び出しが既に復元・生成を完了させていても、それに気づかず重複して新規生成してしまいます。

- [ ] **Step 3: 型チェックを実行する**

```bash
npm run type-check
```

**期待される結果**: エラーなく終了すること。もし`Mutex`の型に関するエラーが出た場合は、`src/utils/Mutex.ts`の`acquire()`/`release()`のシグネチャを再確認してください（`acquire(): Promise<void>`、`release(): void`のはずです）。

- [ ] **Step 4: Task 2で書いたテストを実行し、グリーンになることを確認する**

```bash
npx vitest run src/utils/storage/__tests__/encryptionSession-concurrency.test.ts
```

**期待される結果**: テストが成功すること（`PASS`と表示される）。

もし依然として失敗する場合、以下を確認してください：
- `encryptionKeyMutex.acquire()`と`encryptionKeyMutex.release()`が正しくペアになっているか
- ダブルチェックの`chrome.storage.local.get`が本当に`acquire()`の**後**に呼ばれているか（`acquire()`の前に書いてしまうと意味がありません）

- [ ] **Step 5: コミットする**

```bash
git add src/utils/storage/encryptionSession.ts
git commit -m "fix(encryption-session): mutex-protect session-to-local secret migration"
```

---

## Task 4: 既存の正常系テストが壊れていないことを確認する

**Files:**
- Read/Run（変更しない）: `src/utils/__tests__/storage-security.test.ts`

**重要（確認済みの事実）**: このファイルは`src/utils/storage.ts`（`../storage.js`）経由で`getOrCreateEncryptionKey`をimportしています（`encryptionSession.ts`から再エクスポートされたもの）。478-491行目に以下のテストが**既に存在**しており、これはまさに今回Mutexで保護する「救済マイグレーション」の正常系（並行呼び出しではない単一呼び出し）をカバーしています。

```typescript
test('直前バージョンでsession storageに移されていた秘密をlocal storageへ救済マイグレーションする', async () => {
    storageData['encryption_salt'] = 'dGVzdA==';
    sessionData['encryption_secret'] = 'secret_stranded_in_session';

    const key = await getOrCreateEncryptionKey();
    expect(key).toBeDefined();

    expect(storageData['encryption_secret']).toBe('secret_stranded_in_session');
    expect(sessionData['encryption_secret']).toBeUndefined();
});
```

Task 3でロックを追加した後もこのテストが通り続けることが、変更が単一呼び出し時の挙動を壊していないことの直接的な証拠になります。もしこのテストが失敗するようになった場合、Task 3で追加したダブルチェック（`chrome.storage.local`の再読み込み）のロジックに誤りがある可能性が高いです（例えば、再読み込みした`saltBase64`/`secret`を使わずに、関数の最初で読んだ古い変数をそのまま使ってしまっている等）。

このファイル自体は`(global as any).chrome = {...}`でグローバルモックを独自に上書きする古いパターンで書かれています（`testDir/vitest.setup.ts`のグローバルモックとは別物）。新規テストを追加する必要はなく、既存のテストがそのまま通ることだけを確認します。

- [ ] **Step 1: 既存の暗号化関連テスト全体を実行する**

```bash
npx vitest run src/utils/__tests__/storage-security.test.ts
```

**期待される結果**: 全テストが成功すること。`describe('getOrCreateEncryptionKey', ...)`ブロック（402-492行目）には以下5つのテストが含まれています。いずれも今回の変更で壊れてはいけません。
- `マスターパスワード設定済み時はロックエラーをスロー`（403行目）
- `アンロック後にキーを取得できる`（409行目）
- `マスターパスワード未設定時にIS_LOCKEDがtrueでもキャッシュ済みキーで失敗しない`（419行目）
- `マスターパスワード未設定時は秘密がlocal storageに永続化される`（433行目）
- `再起動後もlocal storageの秘密は保持され、同じキーが導出される`（449行目）
- `直前バージョンでsession storageに移されていた秘密をlocal storageへ救済マイグレーションする`（478行目）

もし失敗するテストがあれば、そのテストの`test(...)`名を読み、Task 3で変更したコードのどの部分が原因かを特定してください。特に`再起動後もlocal storageの秘密は保持され、同じキーが導出される`（449行目）は「`chrome.storage.local.set`が呼ばれていないこと（＝秘密を再生成していないこと）」を検証しています。Task 3で追加したダブルチェック用の`chrome.storage.local.get`は読み取りのみで`set`ではないため影響しないはずですが、もし失敗する場合はロック内のロジックが意図せず新規生成ブロックに入ってしまっていないか確認してください。

- [ ] **Step 2: プロジェクト全体のテストと型チェックを実行する**

```bash
npm run validate
```

**期待される結果**: 型チェック・テストの両方が成功すること。このコマンドはこのプロジェクトのpre-commitゲートとして定義されているものです。

- [ ] **Step 3: 問題があれば修正し、再度コミットする**

もしStep 1やStep 2で修正が必要だった場合は、修正後に以下を実行してください。

```bash
git add -A -- src/utils
git commit -m "fix(encryption-session): adjust existing tests for mutex-protected key derivation"
```

**なぜ`-- src/utils`で範囲を絞るか**: このプロジェクトのCLAUDE.mdは`git add -A`や`git add .`の使用を禁止しています。変更したファイルが`src/utils`配下に閉じていることが分かっている場合でも、対象を明示的に絞ってください。もし変更ファイルが分散している場合は、`git status`で確認しながら1ファイルずつ`git add <path>`してください。

---

## Task 5: PBIをDONEとしてアーカイブする

**Files:**
- Modify: `pbi/00-INDEX.md`
- Move: `pbi/2026-08-13-01-fix-encryption-session-mutex.md` → `dev-docs/archived/pbi/`

- [ ] **Step 1: PBIファイルをアーカイブディレクトリへ移動する**

```bash
mkdir -p dev-docs/archived/pbi
git mv pbi/2026-08-13-01-fix-encryption-session-mutex.md dev-docs/archived/pbi/
```

- [ ] **Step 2: `pbi/00-INDEX.md`を更新する**

`pbi/00-INDEX.md`を開き、以下の行を「進行中」テーブルから削除してください：

```markdown
| [2026-08-13-01-fix-encryption-session-mutex.md](2026-08-13-01-fix-encryption-session-mutex.md) | 🟡中 | 🔴あり | 🔧非機能追加 | encryptionSessionのsecret復元処理をMutexで排他制御し、アップデート直後の競合による暗号化データ永久損失を防ぐ |
```

そして「アーカイブ履歴」セクションの末尾（一番新しい日付のセクションの下、なければ新しい見出しを作成）に以下を追記してください：

```markdown
### 2026-08-13 アーカイブ済み

- 2026-08-13-01-fix-encryption-session-mutex.md (getOrCreateEncryptionKeyのsession→local復元をMutexで排他制御、ダブルチェックロッキングで二重の新規secret生成を防止)
```

- [ ] **Step 3: コミットする**

```bash
git add pbi/00-INDEX.md dev-docs/archived/pbi/2026-08-13-01-fix-encryption-session-mutex.md
git commit -m "docs(pbi): archive completed encryption-session-mutex PBI"
```

---

## 完了チェックリスト

- [ ] `npx vitest run src/utils/storage/__tests__/encryptionSession-concurrency.test.ts` がグリーン
- [ ] `npx vitest run src/utils/__tests__/storage-security.test.ts` がグリーン
- [ ] `npm run validate`（型チェック＋全テスト）がグリーン
- [ ] `pbi/00-INDEX.md`が更新され、PBIがアーカイブされている
