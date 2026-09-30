# PBI: `withLock` の object 競合ポリシーの契約強化（lock 迂回の撤廃と updater の非突然変異化）

## ユーザーストーリー

保守者として、`withLock` を使う 15 の object write 経路がすべて「version を唯一の durable conflict signal として扱う」という 1 つの契約に服従し、`withLock` を迂回して version を増やさずに object を書き換える経路が 1 つも残っていない状態が欲しい。同時に、in-place に更新する updater が 1 つも残っていない状態が欲しい。これで、Service Worker・タブ・dashboard が同時に走る環境で、denied domains・pending pages・saved URLs が黙って上書きされる経路を消すことができる。

## ビジネス価値

- version を増やさずに `withLock` を迂回する 2 経路を消し、version signal が対象 key で完全になる。
- in-place updater が比較対象の値と store を更新前に書き換える構造を消し、将来 value 比較を入れたときの false conflict と、test port の fidelity 差の双方の原因を除く。
- lock key への直接 `chrome.storage.local.set` の再発を機械的に検出する契約を持ち、裁定が時間とともに崩れないようにする。
- 高頻度 write path に canonicalization の実行時費用を追加しない。
- `ConflictError`、backoff、post-write verification、fake timer での挙動を一切変えない。

## 優先度

- 種別: fix
- 順位: 31 / 31
- RICEスコア: 2.4（Reach=3 / Impact=2 / Confidence=80% / Effort=2 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: lock key への直接 set が 0 件になる
  Given pending_pages と savedUrlsWithTimestamps が withLock の version 管理下にある
  When production code 全体の直接 chrome.storage.local.set を列挙する
  Then 対象 6 key への version 非 bumping な直接 set が 1 件も存在しない
  And pendingStorage の legacy key migration が withLock 経由で merge される
  And savedUrlRepository のクォータ cleanup が withLock 経由で commit される
  And cleanup 中に並行した CAS write があるとき、cleanup の結果が ConflictError ではなく retry で収束する

Scenario: object updater が非突然変異になる
  Given permissionManager の 5 updater が denied_domains を更新する
  When 各 updater を実行する
  Then 渡された current オブジェクトが更新後に変更されていない
  And 新しいオブジェクトが返り、そのオブジェクトだけが storage に commit される
  And evictOldestEntry が LRU 削除を新しいオブジェクトに対して行う
  And removeDeniedDomain が delete を新しいオブジェクトに対して行う
  And cleanupOldDeniedEntries と cleanupDismissedEntries の既存挙動を保っている

Scenario: port が本番と同じ structured clone 境界を持つ
  Given InMemoryStoragePort と test の chrome.storage.local mock が参照を返す
  When 両 port の get が本番の structured clone 相当の新しい値を返す
  Then in-place updater が store を CAS verify より前に書き換えない
  And storageTransaction-contract.test.ts が 2 port で同一の契約として通る
  And port をまたいでも保存済み object の同一性が保存されないことを契約として pin している

Scenario: 契約外の値が混入しても write path は壊れない
  Given storage に structuredClone 非対応な値が存在する
  When withLock の object write を実行する
  Then pre-write は version のみを比較するため例外を投げない
  And ConflictError、backoff、post-write verification の挙動が裁定前と同一である
  And canonicalization を write path に追加していない

Scenario: 既存契約が維持される
  Given version が唯一の durable conflict signal である
  When 2 つの writer が同一 key に競合する
  Then 後着者は ConflictError を受け取り、backoff 後に最新値で再試行する
  And post-write verification は常に有効で、改ざんを検出する
  And 直列化は microtask のみにより、fake timer を進めずに完了する
```

## 受け入れ基準

- [ ] `dev-docs/ADR/2026-09-26-withlock-object-conflict-policy.md` の裁定（R1〜R5）を実装している。
- [ ] `withOptimisticLock` 12 経路（`src/background/retryPendingWrites.ts:20`、`src/utils/pendingStorage.ts:215,282,308`、`src/utils/permissionManager.ts:103`、`src/utils/storage/savedUrlRepository.ts:191,340,364`、`src/utils/storage/settingsMigration.ts:67,258,297`、`src/utils/trustDb/TrustDbKernel.ts:210`）と `SettingsRepository` からの直接 `tx.withLock` 3 経路（`src/utils/storage/SettingsRepository.ts:54,86,223`）の合計 **15 経路**を、裁定の適用対象として列挙している。
- [ ] `src/utils/pendingStorage.ts:167` の `{ [PENDING_PAGES_KEY]: mergedPages }` を `withLock` 経由へ移しており、legacy migration の merge 意味論を保っている。
- [ ] `src/utils/storage/savedUrlRepository.ts:478` の `{ savedUrlsWithTimestamps: cleaned }` を `withLock` 経由へ移しており、entry 上限とメタデータ strip の意味論を保っている。
- [ ] version を増やさずに object lock key（`settings` / `savedUrls` / `savedUrlsWithTimestamps` / `pending_pages` / `denied_domains` / `trust_db`）へ `chrome.storage.local.set` する production 箇所が **0 件**である。
- [ ] `src/utils/permissionManager.ts` の `recordDeniedVisit`（`:157-177`）、`recordDomainDismissal`（`:192-199`）、`removeDeniedDomain`（`:328-334`）、`evictOldestEntry`（`:65-79`）が新しいオブジェクトを返す非突然変異形이며、渡された `current` を変更しない。
- [ ] `src/utils/permissionManager.ts:92-94` の `saveDeniedDomains`（version 非 bumping な直接 set、呼び出し元なし）を削除している。
- [ ] `InMemoryStoragePort`（`src/utils/storage/storagePort.ts:121,77-113`）が `get` / `set` の境界で structured clone 相当の新しい値を返し、保存済み object の同一性を保存しない。
- [ ] `testDir/vitest.setup.ts:174-194` の `chrome.storage.local` mock が本番と同じく structured clone 相当の境界を持つ。
- [ ] lock key への直接 `chrome.storage.local.set` を検出する契約テスト（lint ルールまたは契約テストのいずれか）が 1 通りあり、迂回を再導入すると失敗する。
- [ ] 契約テストが、version を増やさずに値だけ書き換える direct set と同等の race を `withLock` 経由で再現したとき lost update が発生しないことを確認する。
- [ ] `src/utils/storage/storageTransaction.ts:273-275` の pre-write 値比較は object を skip したままであり、`canonical deep-equal` を追加していない。
- [ ] `src/utils/storage/storageTransaction.ts:280-285` の post-write verification が `deepEqual` による version + 値検証のままであり、常に有効である。
- [ ] `ConflictError`（`src/utils/storage/storageTransaction.ts:73-81`）の `name` / `message` / `key` / `expectedVersion` / `actualVersion` を変更していない。
- [ ] retry の `maxRetries` 既定 5、`initialDelay` 既定 100、`backoffDelayMs(attemptCount - 1, { baseMs: initialDelay })`（`:161`）、上限到達時の `new ConflictError(key, -1, -1)`（`:160`）を変更していない。
- [ ] 直列化を microtask チェーン（`runSerialized`, `:33-44`）のまま維持し、fake timer を進めずに `withLock` が完了する。
- [ ] `withAtomic`（`:169-229`）と `withAtomicKeys` の判定ロジックを変更していない。
- [ ] `src/utils/storage/__tests__/storageTransaction-contract.test.ts`、`storageTransaction-idempotency.test.ts`、`src/utils/__tests__/optimisticLockSerialization.test.ts`、`src/utils/__tests__/withAtomicKeys.test.ts`、`src/utils/storage/__tests__/savedUrlStore-cas.test.ts`、`src/utils/trustDb/__tests__/lockContract.test.ts` の既存 pin を維持している。
- [ ] port の structured clone 化で落ちた既存テストの期待値を裁定どおり修正し、修正の理由を各テストに記している。
- [ ] すべての非同期処理を `async` / `await` で実装し、ESM の import に `.js` 拡張子を付けている。
- [ ] 実時間待ち（`setTimeout` 直書き、`page.waitForTimeout`）をテストへ追加していない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は storage 層の契約変更であり、E2E の追加は裁定の検証に要る範囲に限る。
- denied domains の記録と tab 遷移を同時に行い、`denied_domains` に取りこぼしと重複がないことを確認する。
- pending page の追加と保存 URL の記録を同時に行い、`pending_pages` と `savedUrlsWithTimestamps` の両方が取りこぼしなしであることを確認する。
- クォータ cleanup 中に同時保存が発生しても、cleanup が保存済みの entry を消さないことを確認する。
- 2つのタブから同時に設定を変更し、`settings` の片方が黙って上書きされないことを確認する。

### 統合テスト

- `src/utils/storage/__tests__/storageTransaction-contract.test.ts` を `ChromeStoragePort` と `InMemoryStoragePort` の両方で実行し、裁定後の port が 2つとも本番の clone 境界を持つことを確認する。
- `src/utils/storage/__tests__/storageTransaction-idempotency.test.ts:42-84` を利用し、純粋かつ冪等な `updateFn` の pin が引き続き通ることを確認する。
- `src/utils/__tests__/optimisticLockSerialization.test.ts:81-104` を利用し、同 key 直列化と fake timer 完了の pin を維持する。
- `src/utils/__tests__/withAtomicKeys.test.ts:64-112` を利用し、`withAtomicKeys` の canonical equality が変更されていないことを確認する。
- `src/utils/storage/__tests__/savedUrlStore-cas.test.ts:68-104` を利用し、version conflict の retry が競合 write と自分の patch を両方残すことを確認する。
- `src/utils/trustDb/__tests__/lockContract.test.ts:111-121` を利用し、`mergeTrustDatabase` の非突然変異 pin を維持する。
- `src/utils/__tests__/permissionManager.test.ts` で、5 updater が `current` を変更せず、新しいオブジェクトを commit することを確認する。
- `pendingStorage.ts:152-181` の legacy migration と、`savedUrlRepository.ts:458-479` の cleanup について、`withLock` 経由でもマージ・strip・上限の挙動が変わらないことを確認する。
- port の structured clone 化により、in-place updater が store を CAS より前に書き換える情况的 test が落ち、その test を裁定どおり修正する。

### 単体テスト

- `permissionManager` の 5 updater それぞれについて、入力 `current` が deep-equal で不変であることと、出力が新しい参照であることを検証する。
- `evictOldestEntry` が新しいオブジェクト上で LRU 削除を行い、`lastDenied` が最も古い entry を残さないことを検証する。
- 値比較に canonical deep-equal を入れないため、`structuredClone` 非対応値が write path を壊さないことを裁定どおり検証する。
- object conflict、object 非 conflict、version conflict の 3 分岐が裁定前の判定を保つことを検証する。
- lock key への直接 set を検出する契約テストが、`pendingStorage` / `savedUrlRepository` に対する迂回を書くと失敗することを確認する。
- `ConflictError` の `name` と `message` 文字列が変わっていないことを検証する。

## 実装アプローチ

1. 裁定 PBI の probe を再現する失敗する契約テストを先に追加し、直接 set と同等の race が lost update を起こすことを固定する。
2. `src/utils/pendingStorage.ts:167` を `withLock` 経由の merge へ置き換え、legacy key の URL dedupe 意味論を維持する。
3. `src/utils/storage/savedUrlRepository.ts:478` を `withLock` 経由の commit へ置き換え、上限とメタデータ strip を updater の内側へ移す。
4. `src/utils/permissionManager.ts` の 5 updater を非突然変異形へ書き換える。`evictOldestEntry` と `removeDeniedDomain` は新しいオブジェクトを受け取る。
5. 呼び出し元のない `src/utils/permissionManager.ts:92-94` の `saveDeniedDomains` を削除する。
6. `InMemoryStoragePort` と `testDir/vitest.setup.ts` の `chrome.storage.local` mock を structured clone 相当にする。
7. port 変更で落ちた既存テストの期待値を裁定どおり修正する。
8. lock key への直接 `chrome.storage.local.set` を検出する契約テストを追加する。
9. 影響範囲のテストと `npm run type-check` / `npm run lint` / `npm run lint:adr-links` を通し、`ConflictError`・backoff・post-write verification・fake timer の pin が不変であることを確認する。
10. `npm run bench:micro` を変更前後で比較し、高頻度 write path に canonicalization が追加されていないことを確認する。

## 見積もり

2 SP

- 直接 set 2 経路の `withLock` 化と契約テスト: 1 SP
- permissionManager の非突然変異化と port fidelity 修正、既存テスト修正: 1 SP

## 技術的考慮事項

- 裁定の根拠は `dev-docs/ADR/2026-09-26-withlock-object-conflict-policy.md` に記録済みであり、本 PBI はその R1〜R5 を実装する。
- `src/utils/storage/storageTransaction.ts:273-275` の object skip は意図的に維持する。根拠なく canonical deep-equal へ切り替えない。
- `runSerialized`（`:33-44`）の `chains` は module 状態の Map であり、Service Worker の再起動や別 context には効かない。`${key}_version` だけが durable である。
- port の structured clone 化はテスト基盤の変更であり、production 挙動の変更ではない。ただし参照で成立していた既存テストの前提を変える。
- `savedUrlRepository.ts:458-479` の cleanup は storage 使用量を解放する経路であり、`withLock` 化により version 致的整合が成立する。cleanup 自体の strip 対象フィールドは変えない。
- `pendingStorage.ts:152-181` の migration は 1 回きりの処理であり、`withLock` 化しても冪等性は崩れない。
- `denied_domains` は 100 件上限（`permissionManager.ts:41`）を持つ。上限判定は updater の内側で行い、lock 内で変更しない。
- `withAtomic`（`:169-229`）は version のみの pre-write check を持つ別の契約であり、本 PBI では変更しない。
- `structuredClone` を write path に追加しない。裁定の却下理由の一つが、この失敗モードの追加である。
- ADR の R5 昇格条件（迂回の再発、second writer の増加、version で検出できない cross-context race）が成立した場合、本 PBI ではなく別 PBI で value-level CAS を再評価する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/storage/storageTransaction.ts:115-131` に、updateFn の純粋性・冪等性と object conflict を version で検出する JSDoc 契約がある。
- `src/utils/storage/storageTransaction.ts:267-275` が pre-write 検証（version 必須、値は primitive だけ比較）。
- `src/utils/storage/storageTransaction.ts:280-285` が post-write verification で、`deepEqual`（`:98-100`、実装は `:83-96` の `structuredClone` + キーソート `JSON.stringify`）を使う。
- `src/utils/storage/storageTransaction.ts:73-81` が `ConflictError`、`:160-163` が retry と backoff。
- `src/utils/storage/storageTransaction.ts:169-229` の `withAtomic` と `:246-252` の `withAtomicKeys` は別契約である。
- 対象は `withOptimisticLock` 12 経路と `SettingsRepository` からの直接 `tx.withLock` 3 経路の合計 **15 経路**。裁定 PBI の記載「14 経路」は `settingsMigration.ts` の 2 経路として数えていたが、実測は 3 経路（`:67,258,297`）である。
- in-place に更新するのは `src/utils/permissionManager.ts:103-109` の 1 経路だけ。残り 14 経路は非突然変異である。
- version を増やさない直接 `chrome.storage.local.set` は `src/utils/pendingStorage.ts:167` と `src/utils/storage/savedUrlRepository.ts:478` の 2 箇所。`src/utils/permissionManager.ts:92-94` の `saveDeniedDomains` は 3 つめだが dead code。
- `src/utils/storage/storagePort.ts:121` は参照を store に保存し、`:77-113` の `get` はその参照を返す。
- `testDir/vitest.setup.ts:174-194` の `chrome.storage.local` mock も参照を返す。本番の `chrome.storage.local` は structured clone を返す。
- 関連テストは `src/utils/storage/__tests__/storageTransaction-contract.test.ts`、`storageTransaction-idempotency.test.ts`、`src/utils/__tests__/optimisticLockSerialization.test.ts`、`src/utils/__tests__/withAtomicKeys.test.ts`、`src/utils/storage/__tests__/savedUrlStore-cas.test.ts`、`src/utils/__tests__/permissionManager.test.ts`、`src/utils/trustDb/__tests__/lockContract.test.ts` である。

### 実装手順

1. 直接 set と同等の race で lost update が生じることを、裁定と逆向きの契約テストとして再現する。
2. pendingStorage の legacy migration を `withLock` へ移す。
3. savedUrlRepository の quota cleanup を `withLock` へ移す。
4. permissionManager の 5 updater を非突然変異形へ書く。
5. dead code の `saveDeniedDomains` を削除する。
6. 2 port の storage 境界を structured clone 相当へ変更する。
7. 落ちた既存テストの期待値を裁定どおり修正する。
8. lock key への直接 set を禁じる契約テストを追加する。
9. `ConflictError`・backoff・post-write verification・fake timer・`withAtomic` の pin が不変であることを既存テストで確認する。
10. `npm run type-check`、`npm run lint`、`npm run lint:adr-links` と `npm run bench:micro` を通す。

### 落とし穴

- port を先に structured clone 化すると、in-place updater の既存テストが落ちる。updater の書き換えと同じ変更に含め、分離しない。
- `savedUrlRepository.ts` の cleanup を `withLock` 化すると strip 対象フィールドと上限の挙動が変わりうる。updater の内側へ移す際に出力形を変えない。
- `pendingStorage.ts` の migration は legacy key を消すため、`withLock` 内の updater からは `remove` しない。set 後に留在する。
- `permissionManager` の `evictOldestEntry` を非突然変異化すると、呼び出し側から `delete` が消える。LRU の選択基準（`lastDenied` が最古）を変えない。
- port の structured clone 化で、性能を測る test が参照同一性に依存していると落ちる。clone の deep-equal は維持する。
- `ConflictError` の `key` / `expectedVersion` / `actualVersion` は `Object.defineProperty` で enumerable に設定されている（`:77-79`）。文字列化に依存する test があるため変更しない。
- 直接 set の撤去で `chrome.storage.local.set` の呼び出し回数が変わる test があれば、version の加算回数で判定する。

## 決定事項

1. **version を唯一の durable conflict signal として維持する。** `runSerialized` の module state は context をまたげないため、`${key}_version` だけが耐久的な競合可視化手段である。pre-write の object skip（`storageTransaction.ts:273-275`）は維持する。
2. **lock key への直接 `chrome.storage.local.set` を 0 件にする。** 競合の原因は値比較の不足ではなく lock の迂回であるため、`pendingStorage.ts:167` と `savedUrlRepository.ts:478` を `withLock` へ移す。
3. **object updater は非突然変異でなければならない。** in-place updater は比較対象の値と、参照を返す port では store 自体を更新前に変更する。`permissionManager` の 5 updater を書き換え、port の境界を structured clone 相当にして port fidelity の差を消す。
4. **`withAtomicKeys` は対象外とする。** `withAtomic`（`:169-229`）は version のみの pre-write check と独自 retry・独自 post-write verification を持つ別の契約であり、同じ契約として扱うと変更範囲を混同する。
5. **value-level CAS は本 PBI で導入しない。** 昇格条件（迂回の再発、second writer の増加、version で検出できない cross-context race）を満たした場合に別 PBI で再評価し、その時点で clone 済み baseline と値サイズ上限を必須とする。

## Definition of Done

- [ ] `withOptimisticLock` 12 経路と直接 `tx.withLock` 3 経路の合計 15 経路が裁定の適用対象として特定されている。
- [ ] version を増やさずに object lock key へ直接 `chrome.storage.local.set` する箇所が production に 0 件である。
- [ ] `pendingStorage.ts:167` と `savedUrlRepository.ts:478` が `withLock` 経由になり、元のマージ・strip・上限の意味論を保っている。
- [ ] `permissionManager` の 5 updater が非突然変異で、渡された `current` を変更せず新しいオブジェクトを返す。
- [ ] `permissionManager.ts:92-94` の dead code な直接 set が削除されている。
- [ ] `InMemoryStoragePort` と `testDir/vitest.setup.ts` の storage 境界が structured clone 相当になっている。
- [ ] lock key への直接 set を検出する契約テストがあり、迂回を再導入すると失敗する。
- [ ] `storageTransaction.ts:273-275` が object を skip したままであり、canonical deep-equal を追加していない。
- [ ] post-write verification が version + `deepEqual` のままであり、常に有効である。
- [ ] `ConflictError` の識別子とメッセージ、`maxRetries` / `initialDelay` / backoff、上限到達時の throw が裁定前と同一である。
- [ ] 直列化が microtask チェーンのままであり、fake timer を進めない。
- [ ] `withAtomic` と `withAtomicKeys` の判定ロジックが変更されていない。
- [ ] 7 つの既存契約 test（contract / idempotency / serialization / withAtomicKeys / savedUrlStore-cas / permissionManager / lockContract）が裁定どおり通る。
- [ ] port 変更で落ちた既存テストの期待値が裁定どおり修正され、修正理由が各テストに記されている。
- [ ] すべての関連 BDD シナリオが自動検証され、パスする。
- [ ] `npm run bench:micro` で、高頻度 write path に canonicalization が追加されていないことを確認している。
- [ ] `async` / `await` と ESM の `.js` import の規約、および実時間待ちの禁止が維持されている。
