# ADR: `withLock` の object 競合検知は version を唯一の durable signal とし、value-level CAS は採用しない

## ステータス
採用済み

## 日付
2026-09-26

## コンテキスト
`StorageTransaction.withLock` は、全 storage read-modify-write の唯一の seam である。
object 値の競合判定が version だけに委ねられているが、その根拠を記録した ADR が存在しない。

### 現行の競合検知

`src/utils/storage/storageTransaction.ts` の CAS は 3 段で構成される。

| 段 | 箇所 | 比較対象 |
|---|---|---|
| 外側 read | `:144-146` | 値と `${key}_version` を読み、`updateFn` に渡す（`:147`） |
| pre-write verify | `:267-271` | `${key}_version` のみ。**不一致なら `ConflictError`** |
| pre-write 値比較 | `:273-275` | `typeof currentValue !== 'object'` が true のときだけ `!==` で比較。**object は比較を skip** |
| write | `:277` | 値と `${key}_version` を同時 set |
| post-write verify | `:280-285` | `postWriteVersion === newVersion` **かつ** `deepEqual(postWriteValue, newValue)`。常に有効 |

`canonicalStringify`（`:83-96`）は `structuredClone`（`:84`）後に `JSON.stringify` を
キーソート順の replacer で通す。`deepEqual`（`:98-100`）はこの 2 つを、比較だけに使う。
post-write verification（`:284`）と `withAtomic` の post-write（`:208`）はすでにこれを使っている。

`:125-130` の JSDoc が「object 競合は version check で検出する。design review なしに
deep-equal へ切り替えるな」と明記しているが、決定の根拠はコード内にない。

### version しか durable でない理由

`runSerialized`（`:33-44`）が使う `chains`（`:31`）は **module 状態の Map** である。
Service Worker の再起動で消え、dashboard / options ページという別の JS context とは共有されない。
`<key>_version` だけが `chrome.storage.local` に残り、context をまたいで競合を可視化する。
module state を根拠にできない以上、version は唯一の durable signal でなければならない。

### 実測した production call site

`withOptimisticLock` 12 経路、`SettingsRepository` からの直接 `tx.withLock` 3 経路。
合計 **15 経路**、対象 key は 6 個。

| key | 経路 | call site |
|---|---:|---|
| `settings` | 6 | `settingsMigration.ts:67,258,297` / `SettingsRepository.ts:54,86,223` |
| `savedUrlsWithTimestamps` | 3 | `savedUrlRepository.ts:340,364` / `retryPendingWrites.ts:20` |
| `pending_pages` | 3 | `pendingStorage.ts:215,282,308` |
| `savedUrls` | 1 | `savedUrlRepository.ts:191` |
| `denied_domains` | 1 | `permissionManager.ts:103` |
| `trust_db` | 1 | `TrustDbKernel.ts:210` |

この 15 経路のうち、**in-place に更新するのは 1 経路だけ**である。
`permissionManager.ts:103-109` の updater が `current` をそのまま返し、
呼び出し側の 4 箇所（`:167-171` `recordDeniedVisit`、`:194` `recordDomainDismissal`、
`:330` `removeDeniedDomain`、`:76-78` `evictOldestEntry`）が in-place に変更する。
残り 14 経路は新しい配列 / オブジェクトを組み立てる
（`pendingStorage.ts` は `filter` と spread、`savedUrlRepository.ts:340,364` は
`[...entries]`、`settingsMigration.ts` と `SettingsRepository.ts` は `{ ...base, ...patch }`、
`TrustDbKernel.ts:210` は `lockContract.test.ts:111-121` が非突然変異を pin している
`mergeTrustDatabase`）。

### version が見逃している実在の競合

object lock key に対して、version を増やさずに直接 `chrome.storage.local.set` する箇所が
**2 箇所**残っている。どちらも `withLock` を完全に迂回している。

- `src/utils/pendingStorage.ts:167` — `{ [PENDING_PAGES_KEY]: mergedPages }`
- `src/utils/storage/savedUrlRepository.ts:478` — `{ savedUrlsWithTimestamps: cleaned }`

（`src/utils/permissionManager.ts:92-94` の `saveDeniedDomains` も version を増やさずに
`denied_domains` を直接 set するが、呼び出し元が存在しない dead code である。）

probe で、外側 read と CAS verify read の間に version 非 bumping な直接 set が
落地した場合を再現した。`ConflictError` は発生せず、**競合側の書き込みは黙って消える**。
version しか見ていない限り、この race は検出できない。

### in-place updater と値比較の関係

probe で 2 つの port について確認した。

- **pre-write に値比較を入れても in-place updater は毎回 false conflict になる。**
  `withLock` は read した同じ参照を `updateFn` に渡す（`:145-147`）。updater が
  in-place に変更した後、`:263` の `currentValue` は更新済みの値であり、`:269` の
  `verifyValue` は更新前の値。`deepEqual` は false を返す。
  ただし `updateFn` の**実行前に** baseline を clone すれば、同じケースで conflict は起きず、
  競合による実際の変更は検出できる。
- **現行の test port は参照を返す。** `InMemoryStoragePort` は
  `storagePort.ts:121` で参照を store に保存し、`:77-113` の `get` はその参照を返す。
  `testDir/vitest.setup.ts:174-194` の `chrome.storage.local` mock も同じ。
  probe で、in-place updater が **CAS verify read より前に store 自体を変更する**ことを確認した。
  本番の `chrome.storage.local` は structured clone を返すため、この store 先行変更は
  本番では起きない。**つまり現行の test は、本番とは異なる同一性の store を相手に CAS を検証している。**

### canonicalization の費用

`canonicalStringify` は `structuredClone` + `JSON.stringify` で O(値サイズ)。
post-write verification（`:284`）で**すでに全 write につき 2 回**走っている。
pre-write 値比較を追加すると object write につき 2 回増える。
`:271` の version check が先に来るため、増加分は**競合のない通常経路だけに恒久的に課される**。
`chrome.storage.local.set` の IPC round trip と比べて小さいが、消除はされない。

## 関連するADR
- [module 級 singleton と composition root の併存方針](./2026-09-17-module-singleton-policy.md)
- [TrustDBアトミック性修正](./2026-03-20-trustdb-atomicity-fix.md)
- [ユニットテストの実行時間を契約として管理する](./2026-09-26-test-suite-execution-time-contract.md)

## 決定事項

**`Contracts 強化` を採用する。`canonical deep-equal + value-level CAS` は採用しない。**

### R1. version を唯一の durable conflict signal として維持する

pre-write 値比較（`:273-275`）は object を skip したままとする。
`runSerialized` の module state は context をまたげないため、`<key>_version` だけが
耐久的な競合可視化手段である。JSDoc（`:125-130`）は、この理由と「根拠なく
deep-equal へ切り替えない」禁止を明記したまま残す。

### R2. lock key への直接 `chrome.storage.local.set` を 0 件にする

`pendingStorage.ts:167` と `savedUrlRepository.ts:478` を `withLock` 経由へ移す。
競合の**原因**は値比較の不足ではなく、lock を迂回した呼び出しにある。
検出手段を高頻度 path に恒久的に課すより、迂回を 1 箇所ずつ絶ったほうが安い。

### R3. object updater は非突然変異でなければならない

in-place updater は比較対象の値を更新前に変更するため、値比較を将来導入した場合に
false conflict を生む。`permissionManager` の 5 updater を新しいオブジェクトを
返す形へ書き換える。併せて `InMemoryStoragePort` と `testDir/vitest.setup.ts` の
`chrome.storage.local` mock を structured clone 相当にし、**port fidelity の差を消す**。
現在の port は参照を返すため、in-place updater を使う test は updater が書き換えた
store を相手に CAS を検証している。

### R4. `withAtomicKeys` は本決定の対象外とする

`withAtomic`（`:169-229`）は version のみの pre-write check（`:191`）、独自 key の
直列化（`:46-54`）、独自 retry loop（`:214-226`）、独自 post-write verification
（`:203-211`）を持つ**別の契約**である。`withLock` と同じ契約として扱うと、変更範囲を混同する。
`withAtomicKeys.test.ts:64-112` が canonical equality を pin 済みのとおり、本 ADR では触らない。

### R5. value-level CAS への昇格条件を明示する

次のいずれかが成立した場合、`canonical deep-equal + value-level CAS` を再評価する。
その時点で clone 済み baseline（`updateFn` 実行前に `structuredClone`）を必須とし、
値サイズに上限を設けたうえで比較する（全値への無条件 `deepEqual` は課さない）。

- R2 の迂回が新しい形で再発し、R2 の防止が構造的に成立しなくなったとき
- lock key の second writer が `withLock` を通せないまま増えることが確認されたとき
- cross-context race の再現テストが version だけで検出できない競合を示したとき

## 却下した選択肢

### `canonical deep-equal + value-level CAS`

- **value 比較は window 内だけ有効。** pre-write verify（`:267-275`）と post-write
  verify（`:280-285`）が観測する値しか比較しない。CAS write の**後**、post-write read の
  **前**に入った直接 set は version 方式と同じ結果になる。
- **cross-context race は version で既に担保されている。** 脅威モデルである
  Service Worker と dashboard の競合は、`withLock` を通る全 write が
  `_version` を進めるため既に検出できる。value 比較が小さくする差分は
  lock 迂回 call だけだが、それは R2 で消す。
- **費用は競合のない通常経路に恒久的に課される。** `:271` の version check が先に来るため、
  canonicalization の増加は競合のない通常 path で毎回支払われる。
- **`structuredClone` の前提是新種の失敗を生む。** 非対応値が storage に混入すると
  例外が write path を壊す。version 方式にはこの失敗モードがない。
- **15 経路と `withAtomic` の整合に、費用が 2 倍。** value 比較を入れるなら
  `withAtomic` にも入れないと 2 つの契約が食い違い、`withAtomic` 側は
  version のみのまま残る。
- **in-place updater を先に直さないと破綻する。** baseline clone なしでは
  `permissionManager` の write が毎回 false conflict になる。baseline clone ありでも、
  現行 port が参照を返すため（probe で確認）in-place updater は CAS より前に
  store を書き換える。R3 を先に成立させなければ、この選択肢は成立しない。

## 結果

### メリット

- 高頻度 write path に runtime 費用が増えない。
- `structuredClone` 非対応値による write path の例外という新しい失敗モードが入らない。
- 競合の原因（lock 迂回）を除去する。検知機構を常に動かすより安い。
- cross-context 排他は version のまま原子的に守られ、脅威モデルを直接覆う。

### デメリット

- **新しい迂回 call は実行時に検出されない。** R2 で防ぐのは既知の 2 箇所であり、
  将来追加された非 locking writer は lost update を静かに戻す。防止は regression test
  （lock key への直接 set を禁止する lint / 契約 test）に依存する。test に載らない形で
  迂回が書き込まれた場合は検出できない。
- **`withAtomic` は version のみのまま残る**（R4）。その key 集合への直接 set は
  同じく検出されない。
- R3 の port fidelity 修正は、参照で成立していた test 前提を変えるため、
  既存 test の修正が必要になる。

### 影響範囲

- 変更対象: `src/utils/pendingStorage.ts`、`src/utils/storage/savedUrlRepository.ts`、
  `src/utils/permissionManager.ts`、`src/utils/storage/storagePort.ts`、
  `testDir/vitest.setup.ts`、および該当契約 test。
- 変更しない: `withLock` / `withAtomic` / `performCasUpdate` の判定ロジック、
  `ConflictError`、`backoffDelayMs` による retry、post-write verification、
  microtask のみによる直列化（fake timer で進捗する）。

### 実装計画

`pbi/2026-09-25-31-fix-withlock-object-conflict-policy.md`。
R2 → R3 の順で適用する。R3 の port fidelity 修正は、in-place updater の
書き換えと同じ変更に含める（分離すると、port を直した直後に in-place updater の
test が落ちるため）。

## 参照

- `pbi/2026-09-25-02-investigate-withlock-cas-deep-equal.md`
- `pbi/2026-09-25-31-fix-withlock-object-conflict-policy.md`
