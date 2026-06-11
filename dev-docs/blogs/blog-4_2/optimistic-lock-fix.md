# chrome.storage に CAS はない ── `withOptimisticLock` の誤った実装を直した話

ポップアップを開いたら、こんなエラーが出ていました。

```
× エラー: Max retries (5) exceeded for key: savedUrlsWithTimestamps
```

楽観的ロックが 5 回リトライしてすべて失敗したということです。競合が多発しているわけでもなく、ストレージが壊れているわけでもない。原因はコードそのものにありました。

## 楽観的ロックが機能するための前提条件

楽観的ロック（Optimistic Locking）は、データベースのトランザクション処理でよく使われるパターンです。「書き込む前にバージョンを確認し、変わっていなければ書き込む」という流れです。

```
1. 読み込み（currentValue, version = N を取得）
2. 計算（newValue = f(currentValue)）
3. 書き込み（version == N なら newValue と version = N+1 を書く）
4. 別プロセスが N+1 を書いていたら競合 → やり直し
```

これが正しく機能するには、手順 3 がアトミックである必要があります。「バージョン確認」と「書き込み」が分割できない操作でなければなりません。RDB なら `UPDATE ... WHERE version = N` という 1 つの SQL 文で実現できます。

`chrome.storage.local` にはそういった CAS（Compare-And-Swap）操作がありません。

## 実装されていたコードの問題

修正前の `withOptimisticLock` は、書き込みのあとに読み直して検証していました。

```typescript
// 書き込む
await chrome.storage.local.set({ [key]: newValue, [versionKey]: currentVersion + 1 });

// 書き込んだあとに読み直す
const verifyResult = await chrome.storage.local.get([key, versionKey]);
const verifyVersion = verifyResult[versionKey] as number;

if (verifyVersion === currentVersion + 1 &&
    JSON.stringify(verifyValue) === JSON.stringify(newValue)) {
    return newValue; // 成功
}
// 失敗と判定してリトライ
```

これは「自分が書いた直後に、自分の書き込みが残っているかを確認する」という操作です。問題は明確で、`set` と次の `get` の間に別の書き込みが割り込んだ場合、自分の正常な書き込みを「競合」と誤判定してしまいます。

`savedUrlsWithTimestamps` は同一のリコーディング操作中に複数箇所から書き込まれます。`updateUrlTimestamp`、`setSavedUrlsWithTimestamps`、`setUrlRecordType`、それぞれが `withOptimisticLock` を呼び出す設計になっていて、連続書き込みのたびに誤検知が積み重なり、5 回すべてが失敗してエラーになっていました。

## chrome.storage.local.set はアトミックか

`chrome.storage.local.set` 自体はアトミックです。1 回の `set` 呼び出しで渡したオブジェクトは、まとめて書き込まれます。つまり「書き込み」は保証されています。問題は「書き込む前に他の変更が入っていないか」という確認を、API が提供していないことです。

Service Worker のシングルスレッドな JavaScript 実行モデルを信頼するならば、同一プロセス内での競合は起きません。異なる Service Worker インスタンス（たとえば複数タブ）からの競合は理論上ありえますが、ほとんどの操作において読み込みから書き込みまでの間に非同期の中断が入らなければ問題になりません。

## 修正後のコード

書き込み後の検証ロジックを削除し、読み込み前に取得したバージョンと書き込み直前のバージョンを比較する事前チェックに変えました。

```typescript
export async function withOptimisticLock<T>(key: string, updateFn: (currentValue: T) => T): Promise<T> {
    conflictStats.totalAttempts++;

    try {
        // Step 1: 現在の値とバージョンを読み込み
        const result = await chrome.storage.local.get([key, `${key}_version`]);
        const currentValue = result[key] as T;
        const currentVersion = result[`${key}_version`] as number || 0;

        // Step 2: 新しい値を計算
        const newValue = updateFn(currentValue);

        // Step 3: 書き込み直前にバージョンを再確認（事前チェック）
        const currentResult = await chrome.storage.local.get([key, `${key}_version`]);
        const currentVersionAfterRead = currentResult[`${key}_version`] as number || 0;

        if (currentVersionAfterRead !== currentVersion) {
            conflictStats.totalConflicts++;
            throw new ConflictError(key, currentVersion, currentVersionAfterRead);
        }

        // Step 4: バージョンをインクリメントしてアトミックに書き込み
        await chrome.storage.local.set({
            [key]: newValue,
            [`${key}_version`]: currentVersion + 1
        });

        return newValue;
    } catch (error) {
        conflictStats.totalFailures++;
        throw error;
    }
}
```

修正のポイントは「書き込んだあとに読み直す」から「書き込む直前に再確認する」への変更です。事後検証では自分の正常な書き込みを誤って競合と判定してしまいますが、事前チェックであれば「自分が最初に読んだ時点から他の書き込みが入っていないか」を確認できます。

バージョンキー（`${key}_version`）はこの事前チェックのために保持しています。`chrome.storage.local.set` は value と version をまとめてアトミックに書き込むため、バージョンが一致していれば書き込みの整合性が保たれます。

## Q. 事前チェックも完全ではないのでは

A. その通りです。再確認の `get` と `set` の間にも別の書き込みが割り込む余地は理論上あります。ただし Service Worker のシングルスレッド実行モデル上、同一プロセス内での非同期割り込みは `await` をまたがなければ発生しません。この実装は「同一プロセス内の連続書き込みによる誤検知を防ぐ」ことを主な目的としており、その範囲では正しく機能します。

真の競合対策が必要になった場合（複数タブから同時に頻繁に書き込むケースなど）は、メッセージパッシングを使って Service Worker 側でシリアライズする設計が適切です。

## おわりに

「楽観的ロック」という概念を `chrome.storage` に適用しようとしたこと自体は理解できます。ただ、CAS がない環境でバージョン検証を後付けしても、検証のタイミングを間違えると「正しく機能する楽観的ロック」にはなりません。事後検証から事前チェックへの変更で、同一プロセス内の誤検知は解消されました。API の制約を理解した上で、実現できることを実装する。それが今回の修正の要点でした。
