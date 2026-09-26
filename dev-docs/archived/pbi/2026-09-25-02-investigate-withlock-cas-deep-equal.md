# PBI: withLock の object 競合検知ポリシー確定と value-level CAS 導入判断

## ユーザーストーリー

保守者として、14 の object write 経路を安全に利用できる `withLock` の競合検知ポリシーを、調査と 5 Whys に基づいて確定したい。同時に走る Service Worker、タブ、dashboard が設定変更を黙って上書きする危険を排除できる基準がほしい。

## ビジネス価値

- denied domains と TrustDb を含む高頻度 object write を、14 の `withLock` 経路で同じ判断基準にする。
- object 競合の見落としによる silent conflict のリスクを、導入可否と適用範囲まで明確にする。
- 後続の `fix` PBI が、根拠と受け入れ基準のある状態で value-level CAS または Contracts 強化を実装できるようにする。

## 優先度

順位: 02 / 30
RICEスコア: 8.4（Reach=14 / Impact=1.5 / Confidence=80% / Effort=2 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: object 競合検知ポリシーの裁定
  Given pre-write 比較は object を skip し、version 不一致だけに依存している
  And post-write verification は deepEqual を使い、canonical stringify 実装が存在する
  When 14 の withLock 経路と withAtomicKeys の契約を確認する
  Then canonical deep-equal による value-level CAS と Contracts 強化のどちらを採用するかを決める
  And 採用理由、拒否理由、残存リスク、後続 fix の範囲を記録する
  And version、ConflictError、backoff、post-write verification、fake timer の既存挙動を維持する

Scenario: value-level CAS を導入する場合の基準
  Given pre-write に canonical deep-equal を導入する方針が採用された
  When object 更新の比較基準と updateFn の契約を決める
  Then storage に置く値の cloneability を確認したうえで、比較前の baseline を clone する
  And in-place updater が比較対象の値を変更しないようにする
  And version を増やさない直接 chrome.storage.local.set に対して、value equality だけで検出できる範囲を明示する
  And ConflictError、backoff、post-write verification、fake timer の挙動を変えない

Scenario: Contracts を強化する場合の基準
  Given pre-write canonical deep-equal を導入しない方針が採用された
  When object write の利用契約と必要な変更を確認する
  Then updateFn の純粋性と冪等性뿐 아니라、in-place mutation を禁止する境界を明記する
  And permissionManager の in-place updater について、変更するか対象外とするかを裁定する
  And version を唯一の durable conflict signal として残し、残存リスクを記録する
```

## 受け入れ基準

- [x] `withOptimisticLock` の 12 経路と `SettingsRepository` からの直接 `tx.withLock` 3 経路の合計 **15 経路**が対象に数列挙されている。
- [x] 5 Whys により、version だけに依存する理由、deep-equal 導入の前提、直接 `chrome.storage.local.set`、immutable 化、canonicalization のコストが判断材料とともに記録されている。
- [x] `canonical deep-equal + value-level CAS` と `Contracts 強化` の採用・不採用が一方に決定され、理由と影響範囲が記録されている。
- [x] value-level CAS を採用する場合、pre-write 比較、clone 済み baseline、immutable updater、cloneability、15 経路への適用方針が後続 `fix` PBI の受け入れ基準になっている。（不採用の裁定。cloneability 確認手順は却下理由として ADR に記録し、昇格条件として再評価時に必須とする方針を後続 PBI に記載した）
- [x] Contracts を強化する場合、in-place updater の禁止境界と `permissionManager` の扱いが後続 `fix` PBI の受け入れ基準になっている。
- [x] version を増やさない直接 `chrome.storage.local.set` を value equality だけで完全に検出できるかに関する結論と限界が明記されている。
- [x] `withAtomicKeys` は別の契約として扱い、本 PBI の対象へ含めるか除外するかが確定している。
- [x] `structuredClone` に依存する canonical deep-equal を採用する場合、storage に置く値の cloneability を確認する手順が明記されている。
- [x] `ConflictError`、backoff、post-write verification、fake timer の挙動を維持する方針が明記されている。
- [x] 本 PBI は `investigate` とし、裁定結果に基づく実装は後続 `fix` PBI に分離されている。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は設計判断を出力するため、プロダクション挙動を変更する E2E テストは追加しない。
- 後続 `fix` PBI では、object write が競合時に `ConflictError` となり、既存の retry と post-write verification を通ることを object-write の統合シナリオで確認する。

### 統合テスト

- `storageTransaction-contract.test.ts` で採用した object 競合検知契約を確認する。
- `storageTransaction-idempotency.test.ts` で、純粋かつ冪等な updateFn の pin テストを維持する。
- `optimisticLockSerialization.test.ts` で、同時 write と version による競合検出を維持する。
- `withAtomicKeys.test.ts` で、別の契約として明示した `withAtomicKeys` の挙動が変わらないことを確認する。
- `savedUrlStore-cas.test.ts` と `trustDb/__tests__/lockContract.test.ts` で、対象 object write 経路の契約を確認する。
- `permissionManager.test.ts` で、in-place updater と clone 済み baseline の関係を裁定どおりの形で確認する。
- value-level CAS を採用する場合は、同じ version 内で値が変わった場合の pre-write 検出と、ConflictError、backoff、post-write verification、fake timer の組み合わせを確認する。
- version を増やさない直接 `chrome.storage.local.set` が存在する場合、value equality だけで識別できる場合とできない場合を区別して確認する。

### 単体テスト

- canonical stringify と `deepEqual` を使う pre-write 比較の同値・不一致判定を確認する。
- cloneability を確認できない値の扱いを、裁定した契約に沿って確認する。
- in-place updater が baseline を変更しないことを裁定どおり確認する。
- object conflict、object 非 conflict、version conflict の判定を確認する。
- `structuredClone` 非対応値の混入が、裁定した契約どおりに扱われることを確認する。

## 実装アプローチ

1. 現行の pre-write object skip、post-write `deepEqual`、canonical stringify、version key、14 の call site を調査対象として整理する。
2. 5 Whys を順に実施し、各問いに調査で得られた根拠と裁定を対応づける。
3. `canonical deep-equal + value-level CAS` と `Contracts 強化` を、競合検出能力、false conflict、性能・canonicalization コスト、変更範囲の観点で比較する。
4. value-level CAS を採用する場合は、比較前の baseline を clone し、in-place updater を排除する設計を後続 `fix` PBI に具体化する。
5. value-level CAS を採用しない場合は、純粋かつ冪等な updateFn と in-place mutation 禁止をより強い契約として後続 `fix` PBI に具体化する。
6. `withAtomicKeys` を対象外とするか、同一の変更対象へ含めるかを明示する。
7. 本 `investigate` PBI では裁定と後続 `fix` PBI までを作成し、実装は後続 `fix` の Outside-In TDD で進める。

## 見積もり

2 SP

## 技術的考慮事項

- version key は `chrome.storage.local` の durable conflict signal として維持する。module state は複数 context を保護できない。
- `ConflictError`、backoff、post-write verification、fake timer の挙動を変更しない。
- canonical deep-equal は `structuredClone` に依存するため、storage に置く値の cloneability を確認する。
- `permissionManager` の in-place mutation は、単純な `deepEqual(currentValue, verifyValue)` で false conflict を生む。
- version を増やさない直接 `chrome.storage.local.set` に対して、value equality の検出保証を過大にしない。
- 高頻度 object write を含め、canonicalization のコストを裁定時に評価する。
- `withAtomicKeys` は `withLock` とは別の契約であり、比較・変更対象を混同しない。
- すべての ESM import は `.js` 拡張子を使い、async/await のみを使用する。
- 本 PBI は `pbi/2026-09-25-18-investigate-settings-key-single-writer.md` の前提となる。
- `pbi/2026-09-25-17-fix-settings-migration-completion-state.md` と `settingsMigration.ts` の CAS 部分を共有する。

## 実装者向け注記

### 現状コードの確認

実測した値（2026-09-26 時点）。 ADR として `dev-docs/ADR/2026-09-26-withlock-object-conflict-policy.md` に記録した。

- `src/utils/storage/storageTransaction.ts:115-131` に、updateFn の純粋性・冪等性と object conflict を version で検出する JSDoc 契約がある。`:125-130` が「根拠なく deep-equal へ切り替えるな」の明記。
- `src/utils/storage/storageTransaction.ts:273-275` の pre-write 比較は object を skip する。`:271` の version check が必須。
- `src/utils/storage/storageTransaction.ts:280-285` の post-write verification は `deepEqual` を使い、常に有効。
- `src/utils/storage/storageTransaction.ts:83-96` に canonical stringify 実装があり、`:84` で `structuredClone` を使う。`deepEqual` は `:98-100`。
- `src/utils/storage/storageTransaction.ts:73-81` が `ConflictError`、`:160-163` が backoff と retry。
- `src/utils/storage/storageTransaction.ts:169-229` の `withAtomic`（関数ラッパ `withAtomicKeys` は `:246-252`）は別の契約である。
- pin テストは `src/utils/storage/__tests__/storageTransaction-idempotency.test.ts:42-84` にある。
- production の `withOptimisticLock` call site は **12 経路**である。
  - `src/background/retryPendingWrites.ts:20`
  - `src/utils/pendingStorage.ts:215,282,308`
  - `src/utils/permissionManager.ts:103`
  - `src/utils/storage/savedUrlRepository.ts:191,340,364`
  - `src/utils/storage/settingsMigration.ts:67,258,297`
  - `src/utils/trustDb/TrustDbKernel.ts:210`
- `SettingsRepository` からの直接 `tx.withLock` は 3 経路であり、合計は **15 経路**である。
  - `src/utils/storage/SettingsRepository.ts:54,86,223`
- 対象 key は 6 個である（`settings` / `savedUrls` / `savedUrlsWithTimestamps` / `pending_pages` / `denied_domains` / `trust_db`）。
- 15 経路のうち in-place に更新するのは 1 経路だけである。`src/utils/permissionManager.ts:103-109` の updater が `current` をそのまま返し、`recordDeniedVisit`（`:167-175`）、`recordDomainDismissal`（`:194`）、`removeDeniedDomain`（`:330`）、`evictOldestEntry`（`:76-78`）が in-place に変更する。残り 14 経路は非突然変異である。
- version を増やさずに object lock key へ直接 `chrome.storage.local.set` する箇所は **2 箇所**である。
  - `src/utils/pendingStorage.ts:167`
  - `src/utils/storage/savedUrlRepository.ts:478`
- `src/utils/permissionManager.ts:92-94` の `saveDeniedDomains` も同じ形の直接 set だが、呼び出し元が存在しない dead code である。
- `src/utils/storage/storagePort.ts:121` は参照を store に保存し、`:77-113` の `get` はその参照を返す。`testDir/vitest.setup.ts:174-194` の `chrome.storage.local` mock も同じで、本番の structured clone をモデル化していない。
- 関連する既存テストは `storageTransaction-contract.test.ts`、`storageTransaction-idempotency.test.ts`、`optimisticLockSerialization.test.ts`、`withAtomicKeys.test.ts`、`savedUrlStore-cas.test.ts`、`permissionManager.test.ts`、`trustDb/__tests__/lockContract.test.ts` である。

### 実装手順

1. 15 経路と `withAtomic` について、現在の object 競合検知方式と必要な契約を一覧化する。
2. version だけに依存する設計理由について、ADR が存在しない事実を起点に 5 Whys を進める。
3. deep-equal 導入前の契約として、in-place updater を禁止するか、baseline を clone して比較するかを裁定する。
4. version を増やさない直接 `chrome.storage.local.set` を含む race で、value equality の検出範囲と version signal の必須性を整理する。
5. false conflict を避ける immutable 化の要否と影響範囲を裁定する。
6. 高頻度 object write で canonicalization コストを許容できるかを裁定する。
7. 採用方針を後続 `fix` PBI の Outside-In 受け入れシナリオと単体・統合テストへ変換する。

### 落とし穴

- `permissionManager.ts:103-109` の in-place updater を使うと、比較対象の値が更新前に変更され、pre-write 値比較を入れた場合 false conflict を生じる。
- 現行の test port は参照を返すため、in-place updater は CAS verify read より前に store 自体を書き換える。本番の `chrome.storage.local` は structured clone を返すため、この store 先行変更は本番では起こらない。**port の同一性が違う状態で CAS を検証している。**
- `structuredClone` 非対応値が storage に混入すると、canonical deep-equal を write path へ入れた場合に write path が例外で壊れる。
- post-write verification に存在する `deepEqual` を、pre-write object conflict の判定に使えると決め打ちすると、version の durable conflict signal という契約を誤る。
- `withAtomicKeys` を `withLock` と同じ契約として扱うと、別契約の変更範囲を混同する。

## 決定事項

5 Whys を使って次の 5 点を裁定する。

1. なぜ object 競合を version だけに委ねているのか。現行コードに ADR がないため、根拠を調査して記録する。
2. deep-equal 導入前に in-place updater を禁止する契約にするのか、baseline を clone して比較するのか。
3. version を増やさない直接 `chrome.storage.local.set` が存在した場合、value equality だけでどこまで検出できるのか。
4. false conflict を避けるため object 更新を immutable 化するのか。
5. object canonicalization のコストが高頻度 write に許容されるか。

この 5 点の裁定をもとに、`canonical deep-equal + value-level CAS` または `Contracts 強化` を採用し、実装する方を後続 `fix` PBI に分離する。

## 裁定結果

2026-09-26 実施。裁定は ADR `dev-docs/ADR/2026-09-26-withlock-object-conflict-policy.md` に記録した。
後続 PBI は `pbi/2026-09-25-31-fix-withlock-object-conflict-policy.md`。

### 5 Whys の連鎖

**Q1. なぜ object 競合を version だけに委ねているのか。**

ADR が存在せず、`:125-130` の JSDoc に「根拠なく deep-equal へ切り替えるな」とあるだけである。
`runSerialized`（`:33-44`）が使う `chains`（`:31`）は **module 状態の Map** で、Service Worker の再起動で消え、
dashboard / options ページという別 context とは共有されない。module state を排他根拠にできない以上、
`chrome.storage.local` に残る `<key>_version` だけが durable な競合可視化手段になる。
`:273-275` の pre-write 値比較は `!==` であり object に対して無意味なので、version に一本化した。

**Q2. deep-equal 導入前に in-place updater を禁止する契約にするのか、baseline を clone して比較するのか。**

**baseline を clone する**。probe で確認したとおり、`updateFn` 実行前に `structuredClone` した
baseline を比較に使えば、in-place updater でも false conflict は起きず、競合による実際の変更は検出できる。
一方「禁止」だけだと、TypeScript の `Record<string, T>` updater に対して型で強制できず、
lint ルールに頼る必要がある。しかも baseline clone だけでは不十分である。probe で
in-place updater が **CAS verify read より前に store 自体を書き換える**ことを確認した。
理由は `InMemoryStoragePort`（`storagePort.ts:121,77-113`）も `testDir/vitest.setup.ts:174-194` の
`chrome.storage.local` mock も参照を返すためである。本番は structured clone を返すので
この store 先行変更は本番では起こらないが、**test が本番と同一性の異なる store を相手に
CAS を検証している**。よって裁定は「baseline clone を土台に、非突然変異 updater と port の
clone 境界を併せて契約する」。

**Q3. version を増やさない直接 `chrome.storage.local.set` があった場合、value equality だけでどこまで検出できるのか。**

**pre-write window 内の direct set なら検出できる。** probe で、外側 read と CAS verify read の間に
version 非 bumping な直接 set を注入し、`ConflictError` なしで競合側の書き込みが黙って消えることを
再現した。value 比較を入れればこの case は検出できる。
**ただし限界が 2 つある。** 1 つは window 外で、CAS write の後・post-write read の前に入った直接 set は
version 方式と同じ結果になる（`deepEqual` は `ConflictError` にして retry するが、version も同様）。
もう 1 つは threat model で、Service Worker と dashboard の cross-context race は
`withLock` を通る全 write が `_version` を進めるため **version で既に担保されている**。
value 比較が小さくする差分は lock 迂回 call だけだが、それは検出ではなく撤去で直せる。

**Q4. false conflict を避けるため object 更新を immutable 化するのか。**

**immutable 化する。** 実測すると、in-place に更新するのは 15 経路のうち **1 経路だけ**
（`permissionManager.ts:103-109`）で、残り 14 経路はすでに新しい配列 / オブジェクトを
組み立てている（`pendingStorage.ts` は `filter` と spread、`savedUrlRepository.ts:340,364` は
`[...entries]`、`settingsMigration.ts` と `SettingsRepository.ts` は `{ ...base, ...patch }`、
`TrustDbKernel.ts:210` は `lockContract.test.ts:111-121` が非突然変異を pin している `mergeTrustDatabase`）。
したがって immutable 化は 15 経路ではなく 1 経路の変更で済み、false conflict だけでなく
Q2 で確認した store 先行変更も同時に消える。

**Q5. object canonicalization のコストが高頻度 write に許容されるか。**

**許容しない。** `canonicalStringify`（`:83-96`）は `structuredClone` + `JSON.stringify` で O(値サイズ)。
post-write verification（`:284`）で**すでに全 write につき 2 回**走っている。
pre-write 値比較を追加すると object write につき 2 回増える。`:271` の version check が先に来るため、
増加分は**競合のない通常経路に恒久的に課される**。`chrome.storage.local.set` の IPC round trip
より小さいが、消除はされない。さらに `structuredClone` 非対応値が storage に混入すれば
write path が例外で壊れるという新しい失敗モードが増える。version 方式にはこの失敗モードがない。

### 採用判定

**`Contracts 強化` を採用する。`canonical deep-equal + value-level CAS` は採用しない。**

**採用理由。** version が見逃す実在の競合は、lock を迂回した 2 箇所
（`pendingStorage.ts:167`、`savedUrlRepository.ts:478`）だけである。value 比較を足すのではなく
その 2 箇所を `withLock` へ移せば、version signal が対象 key で完全になり、原因が消える。
Q3 のとおり cross-context race は version で既に担保されており、Q5 のとおり追加費用は
通常経路に恒久的に課される。加えて、port が参照を返す現状では in-place updater が
CAS より前に store を書き換えるため、value 比較を入れるならまず R3（immutable 化と port の
clone 境界）が必要になる。**依存関係を逆にすると、1 経路の修正 + 2 箇所の撤去で済む問題を、
高頻度 write に恒久費用と新しい失敗モードを背負わせて解決することになる。**

**不採用側の拒否理由。** (1) value 比較は window 内だけで有効で、CAS write 後・post-write read 前の
直接 set は検出しない。(2) threat model である cross-context race は version で既に担保済みで、
受益が小さい。(3) `:271` の version check が先に来るため費用は競合のない通常経路に恒久課される。
(4) `structuredClone` 非対応値で write path が壊れるという新しい失敗モードが増える。
(5) 15 経路と `withAtomic` の整合に費用が 2 倍になる。(6) 現行 port の参照返却により
in-place updater は baseline clone ありでも CAS より前に store を書き換えるため、
R3 を先に成立させないとこの選択肢は成立しない。

**残存リスク。**

- 新しい lock 迂回 call は実行時に検出されない。R2 で消すのは既知の 2 箇所であり、
  将来追加された非 locking writer は lost update を静かに戻す。防止は契約テスト
  （lock key への直接 set を禁じる lint / 契約 test）に依存し、test に載らない形で
  迂回が書き込まれた場合は検出できない。
- `withAtomic` は version のみのまま残る（別契約として対象外）。その key 集合への直接 set は
  同じく検出されない。
- R3 の port fidelity 修正は、参照で成立していた既存 test の前提を変えるため、
  既存テストの修正が必要になる。
- `savedUrlsWithTimestamps` が cleanup 前に大きくなった状態で後から value 比較を昇格する場合、
  全値への無条件 `deepEqual` は課さず、値サイズ上限を設けたうえで clone 済み baseline と
  比較する必要がある。

**`withAtomicKeys` の裁定: 対象外。** `withAtomic`（`:169-229`）は version のみの pre-write check
（`:191`）、独自 key の直列化（`:46-54`）、独自 retry loop（`:214-226`）、独自 post-write
verification（`:203-211`）を持つ別の契約である。`withLock` と同じ契約として扱うと変更範囲を混同する。
`withAtomicKeys.test.ts:64-112` が canonical equality を pin 済みのとおり触らない。

**再評価の条件。** lock 迂回の再発、`withLock` を通せない second writer の増加、
version だけで検出できない cross-context race の再現のいずれかが成立した場合、
clone 済み baseline と値サイズ上限を必須として value-level CAS を別 PBI で再評価する。

## Definition of Done

- [x] 15 の `withLock` 経路と `withAtomicKeys` の対象範囲が調査成果物に整理されている。
- [x] 5 Whys の 5 問すべてに、根拠、裁定、残存リスクが記録されている。
- [x] canonical deep-equal による value-level CAS と Contracts 強化の採否が決定されている。
- [x] 採用判定と依存関係に従い、後続 `fix` PBI（`pbi/2026-09-25-31-fix-withlock-object-conflict-policy.md`）が作成されている。
- [x] 後続 `fix` PBI には、15 経路、cloneability、immutable updater、直接 storage write、version、ConflictError、backoff、post-write verification、fake timer の受け入れ基準が含まれている。
- [x] `withAtomicKeys` の契約境界が明記されている。
- [x] 本 `investigate` PBI ではプロダクションコードを変更していない。
