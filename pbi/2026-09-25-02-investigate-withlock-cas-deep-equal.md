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

- [ ] `withOptimisticLock` の 11 経路と `SettingsRepository` からの直接 `tx.withLock` 3 経路の合計 14 経路が対象に数列挙されている。
- [ ] 5 Whys により、version だけに依存する理由、deep-equal 導入の前提、直接 `chrome.storage.local.set`、immutable 化、canonicalization のコストが判断材料とともに記録されている。
- [ ] `canonical deep-equal + value-level CAS` と `Contracts 強化` の採用・不採用が一方に決定され、理由と影響範囲が記録されている。
- [ ] value-level CAS を採用する場合、pre-write 比較、clone 済み baseline、immutable updater、cloneability、14 経路への適用方針が後続 `fix` PBI の受け入れ基準になっている。
- [ ] Contracts を強化する場合、in-place updater の禁止境界と `permissionManager` の扱いが後続 `fix` PBI の受け入れ基準になっている。
- [ ] version を増やさない直接 `chrome.storage.local.set` を value equality だけで完全に検出できるかに関する結論と限界が明記されている。
- [ ] `withAtomicKeys` は別の契約として扱い、本 PBI の対象へ含めるか除外するかが確定している。
- [ ] `structuredClone` に依存する canonical deep-equal を採用する場合、storage に置く値の cloneability を確認する手順が明記されている。
- [ ] `ConflictError`、backoff、post-write verification、fake timer の挙動を維持する方針が明記されている。
- [ ] 本 PBI は `investigate` とし、裁定結果に基づく実装は後続 `fix` PBI に分離されている。

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

- `src/utils/storage/storageTransaction.ts:118-130` に、updateFn の純粋性・冪等性と object conflict を version で検出する JSDoc 契約がある。
- `src/utils/storage/storageTransaction.ts:273-275` の pre-write 比較は object を skip する。
- `src/utils/storage/storageTransaction.ts:279-285` の post-write verification は `deepEqual` を使う。
- `src/utils/storage/storageTransaction.ts:83-100` に canonical stringify 実装がある。
- pin テストは `src/utils/storage/__tests__/storageTransaction-idempotency.test.ts:42-84` にある。
- production の `withOptimisticLock` call site は 11 経路である。
  - `src/background/retryPendingWrites.ts:20`
  - `src/utils/pendingStorage.ts:215,282,308`
  - `src/utils/storage/settingsMigration.ts:55,246`
  - `src/utils/storage/savedUrlRepository.ts:191,340,364`
  - `src/utils/trustDb/TrustDbKernel.ts:210`
  - `src/utils/permissionManager.ts:103`
- `SettingsRepository` からの直接 `tx.withLock` は 3 経路であり、合計は 14 経路である。
  - `src/utils/storage/SettingsRepository.ts:54,86,223`
- `src/utils/permissionManager.ts:103-108` は object を in-place mutate する。
- `src/utils/storage/storageTransaction.ts:169-228` の `withAtomicKeys` は別の契約である。
- 関連する既存テストは `storageTransaction-contract.test.ts`、`storageTransaction-idempotency.test.ts`、`optimisticLockSerialization.test.ts`、`withAtomicKeys.test.ts`、`savedUrlStore-cas.test.ts`、`permissionManager.test.ts`、`trustDb/__tests__/lockContract.test.ts` である。

### 実装手順

1. 14 経路と `withAtomicKeys` について、現在の object 競合検知方式と 필요한契約を一覧化する。
2. version だけに依存する設計理由について、ADR が存在しない事実を起点に 5 Whys を進める。
3. deep-equal 導入前の契約として、in-place updater を禁止するか、baseline を clone して比較するかを裁定する。
4. version を増やさない直接 `chrome.storage.local.set` を含む race で、value equality の検出範囲と version signal の必須性を整理する。
5. false conflict を避ける immutable 化の要否と影響範囲を裁定する。
6. 高頻度 object write で canonicalization コストを許容できるかを裁定する。
7. 採用方針を後続 `fix` PBI の Outside-In 受け入れシナリオと単体・統合テストへ変換する。

### 落とし穴

- `permissionManager.ts:103-108` の in-place updater を使うと、比較対象の値が更新前に変更され、false conflict を生じる。
- `structuredClone` 非対応値が storage に混入すると、canonical deep-equal の前提を満たさない。
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

## Definition of Done

- [ ] 14 の `withLock` 経路と `withAtomicKeys` の対象範囲が調査成果物に整理されている。
- [ ] 5 Whys の 5 問すべてに、根拠、裁定、残存リスクが記録されている。
- [ ] canonical deep-equal による value-level CAS と Contracts 強化の採否が決定されている。
- [ ] 採用判定と依存関係に従い、後続 `fix` PBI が作成されている。
- [ ] 後続 `fix` PBI には、14 経路、cloneability、immutable updater、直接 storage write、version、ConflictError、backoff、post-write verification、fake timer の受け入れ基準が含まれている。
- [ ] `withAtomicKeys` の契約境界が明記されている。
- [ ] 本 `investigate` PBI ではプロダクションコードを変更していない。
