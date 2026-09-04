# PBI: Cleanup — orphan exports / dead mocks / optimisticLock shim importers の一括除去

## ユーザーストーリー
開発者（dev/CI）として、orphan exports / dead test mocks / `@deprecated` shim への残存 import を一括で除去したい、なぜなら次 iteration で shim（`optimisticLock.ts` / `sqliteClient.ts` / `trustDb.ts` 等）を物理削除した際にビルドが壊れ、dead mock は削除済み module を参照してテストの意図が空振りし、orphan export は API サーフェスを肥大化させて drift を隠すから

## 種別
- chore / cleanup（非機能・クリーンアップ）— 単一機能ではなく、branch review `0902a` で検出された WARNING/dead-code 3 カテゴリ（A: orphan exports / B: dead test mocks / C: shim importers）の束ね

## 優先度
- 順位: 05 / 07（Architecture Deepening 0903 の番外 cleanup）
- RICEスコア: **0.9**（Reach=1 / Impact=1 / Confidence=0.9 / Effort=1）
- RICE 内訳:
  - Reach: 1（dev/CI のみ。ユーザー影響なし — 次の shim 物理削除が着地するまでは prod 挙動に影響しない）
  - Impact: 1（中 — drift リスク / mock 空振りによるバグ見逃し / shim 削除時のビルド破壊）
  - Confidence: 0.9（grep で全箇所を特定済み、移行先 `StorageTransaction` は PBI 01 で deep 化済み）
  - Effort: 1 人週（orphan 削除 + mock 削除 + 6〜7 ファイルの import 移行 + shim 物理削除 + validate green）
  - 根拠: 短期的ユーザー価値はゼロだが、放置すると次の iteration（shim 物理削除）で確実に `ERR_MODULE_NOT_FOUND` / type-check 失敗が発生し、dead mock は 2 スイート分のテストが実体を検証していない状態を隠す。Effort は機械的な置換中心で 1 人週に収まる。

## ビジネス価値
- 直接のユーザー価値なし。dev/CI の健全性（type-check / lint / test / build の green 維持）と、次 iteration での shim 物理削除を安全に実行できる状態の確保。
- 測定方法: `npm run validate`（type-check + lint + tests + build）が本 PBI 前後で green を維持し、`grep` による orphan/mocks/shim 残存が 0 件になること。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ orphan export が残った？ | `0902a` で deepening（StorageTransaction / ProviderCatalog / ContextBuilder / TrustDbAdmin）が完了した際、旧 export を `@deprecated` shim 経由で温存しつつ新 seam を追加したが、旧 export の削除を次 iteration に先送りした → 本 PBI で未参照 export を物理削除し API サーフェスを最小化 |
| なぜ dead mock が残った？ | `sqliteClient.ts`（commit 8f1d956d, PBI 07b）と `trustDb.ts`（commit 64609768, PBI 04b）が物理削除されたが、2 つのテストの `vi.mock` が削除済みパスを指したまま残存 → mock を削除し、必要なら新 gateway / 新 seam への差し替えに置換 |
| なぜ shim importers が残った？ | `optimisticLock.ts` を `storage/storageTransaction.ts` への re-export shim に deep 化（PBI 01）したが、6〜7 箇所の prod importer を新パスへ移行せず shim 経由のままにした → 本 PBI で全 prod importers を `storageTransaction` に移行してから shim を物理削除 |
| なぜ束ねるのか？ | 3 カテゴリとも「次 iteration の物理削除を block する drift」であり、単独では RICE が小さく優先度付けが困難だが、束ねると 1 人週で CI の block を一括解消できる → 1 つの cleanup PBI に集約し、各 acceptance を離散化して部分着地を許容 |

### 対象一覧（branch review `0902a` WARNING より）

#### A. Orphan exports（prod caller 0 件）
| # | ファイル | 行 | export | 状態 |
|---|----------|----|--------|------|
| A1 | `src/utils/storage/storageTransaction.ts` | 235-244 | `withLockViaPort` / `withAtomicViaPort` | prod caller なし（shim 経由の再export のみ） |
| A2 | `src/background/ai/providerCatalog.ts` | 188, 248 | `PROVIDER_REGISTRY` / `ProviderCatalogEntryAlias` / `createStrategy` | `PROVIDER_REGISTRY` は旧 Registry alias、`ProviderCatalogEntryAlias` は `ProviderCatalogEntry = ProviderRegistryEntry` の alias、`createStrategy` は旧 factory alias — いずれも新 seam（`ProviderCatalog`）に吸収済み |
| A3 | `src/utils/trustDb/TrustDbAdmin.ts` | ~143 | convenience `isDomainTrusted` 関数 | `getTrustDbAdmin().isDomainTrusted` に集約済み、単独関数は orphan |
| A4 | `src/background/pipeline/contextBuilder.ts` | ~184 | `createInitialContext` / `assertStage` | `contextBuilder.test.ts` のみで使用、prod caller なし |

#### B. Dead test mocks（物理削除済み shim を指す）
| # | ファイル | 行 | 内容 | 削除元 |
|---|----------|----|------|--------|
| B1 | `src/dashboard/__tests__/gistSettings.test.ts` | 46 | `vi.mock('../../background/sqliteClient.js', …)` | `sqliteClient.ts` は 8f1d956d で物理削除済み |
| B2 | `src/background/handlers/__tests__/confirmTokenConstantTime.test.ts` | 56 | `vi.mock('../../sqliteClient.js', () => ({}))` | 同上 |

#### C. `optimisticLock.ts` shim — 残存 prod importers
| # | ファイル | 行 | 現状 import |
|---|----------|----|-------------|
| C1 | `src/utils/markdown/MarkdownBufferManager.ts` | 2 | `from '../optimisticLock.js'` |
| C2 | `src/utils/migration/retryPendingWrites.ts` | 7 | `from '../optimisticLock.js'` |
| C3 | `src/utils/storage/pendingStorage.ts` | 5 | `from '../optimisticLock.js'` |
| C4 | `src/utils/savedUrlRepository.ts` | 16 | `from './optimisticLock.js'` または `from '../utils/optimisticLock.js'` |
| C5 | `src/utils/storage/settingsMigration.ts` | 10 | `from '../optimisticLock.js'` |
| C6 | `src/utils/permissionManager.ts` | 10 | `from './optimisticLock.js'` または `from '../utils/optimisticLock.js'` |
| C7 | `src/utils/trustDb/TrustDbKernel.ts` | 11 | `from '../optimisticLock.js'` — prod か test-only かを本 PBI 着手時に確認し、prod なら移行対象に含める |

- 移行先: `src/utils/storage/storageTransaction.js`（`StorageTransaction` / `withLock` / `withAtomic` / `withOptimisticLock` / `withAtomicKeys` のいずれか適切なもの。命名は `storageTransaction.ts` の公開 API に合わせる）
- ゴール: 上記 6（または C7 含め 7）箇所を全て `storageTransaction` に移行した後に `src/utils/optimisticLock.ts` を物理削除

## BDD受け入れシナリオ

### Scenario A1: `withLockViaPort` / `withAtomicViaPort` exports no longer exist
```gherkin
Scenario: A1 withLockViaPort / withAtomicViaPort が削除される
  Given src/utils/storage/storageTransaction.ts の 235-244 行に withLockViaPort / withAtomicViaPort が export されている
  When grep -rn "withLockViaPort\|withAtomicViaPort" src/ --include="*.ts" を実行する
  Then src/utils/storage/storageTransaction.ts からの export が存在せず、grep 結果が 0 件である
  And npm run type-check が green である
```

### Scenario A2: `PROVIDER_REGISTRY` / `ProviderCatalogEntryAlias` / `createStrategy` exports no longer exist
```gherkin
Scenario: A2 PROVIDER_REGISTRY / ProviderCatalogEntryAlias / createStrategy が削除または @deprecated 化される
  Given src/background/ai/providerCatalog.ts の 188, 248 行に PROVIDER_REGISTRY / ProviderCatalogEntryAlias / createStrategy が export されている
  When grep -rn "PROVIDER_REGISTRY\|ProviderCatalogEntryAlias\|createStrategy" src/ --include="*.ts" を実行する
  Then いずれかの状態を満たす:
    | 状態 | 条件 |
    |------|------|
    | 削除 | 3 export とも存在せず grep が 0 件 |
    | 非推奨温存 | export に @deprecated と removal date（例: @deprecated since 2026-09-03, remove in 2026-10-01）が付与され、prod caller が 0 件であることが grep で確認できる |
  And npm run type-check が green である
```

### Scenario A3: convenience `isDomainTrusted` removed
```gherkin
Scenario: A3 convenience isDomainTrusted が削除され getTrustDbAdmin().isDomainTrusted が唯一の entry point である
  Given src/utils/trustDb/TrustDbAdmin.ts の ~143 行に convenience isDomainTrusted 関数が export されている
  When grep -rn "export.*isDomainTrusted" src/utils/trustDb/ --include="*.ts" を実行する
  Then convenience 関数の export が存在せず、唯一の entry point が getTrustDbAdmin().isDomainTrusted であることが docs または code コメントで明示されている
  And grep -rn "isDomainTrusted" src/ --include="*.ts" | grep -v "getTrustDbAdmin\|TrustPolicy\|TrustDbAdmin" が prod コードで 0 件（直接 import の convenience 呼び出しが残っていない）
```

### Scenario A4: `createInitialContext` / `assertStage` removed or moved to `__tests__/`
```gherkin
Scenario: A4 createInitialContext / assertStage が削除または __tests__/ に移動される
  Given src/background/pipeline/contextBuilder.ts の ~184 行に createInitialContext / assertStage が export され、prod caller が contextBuilder.test.ts のみである
  When grep -rn "createInitialContext\|assertStage" src/ --include="*.ts" を実行する
  Then いずれかの状態を満たす:
    | 状態 | 条件 |
    |------|------|
    | 削除 | prod コード（__tests__ 除く）での grep が 0 件 |
    | テスト専用化 | src/background/pipeline/__tests__/ 配下または contextBuilder.test.ts 内に移動し、src/background/pipeline/contextBuilder.ts からの export が存在しない |
  And npm run type-check が green である
```

### Scenario B1: `vi.mock('../../background/sqliteClient.js', …)` is removed
```gherkin
Scenario: B1 gistSettings.test.ts の dead mock が削除される
  Given src/dashboard/__tests__/gistSettings.test.ts の 46 行に vi.mock('../../background/sqliteClient.js', …) が存在し、参照先は commit 8f1d956d で物理削除済みである
  When grep -rn "sqliteClient" src/dashboard/__tests__/gistSettings.test.ts を実行する
  Then vi.mock('../../background/sqliteClient.js', …) の行が存在しない
  And 必要に応じて mock が新 gateway（offscreenGateway / dashboardGateway）への適切な mock に置換されているか、不要なら削除されている
  And npm test -- src/dashboard/__tests__/gistSettings.test.ts が green である
```

### Scenario B2: `vi.mock('../../sqliteClient.js', () => ({}))` is removed
```gherkin
Scenario: B2 confirmTokenConstantTime.test.ts の dead mock が削除される
  Given src/background/handlers/__tests__/confirmTokenConstantTime.test.ts の 56 行に vi.mock('../../sqliteClient.js', () => ({})) が存在し、参照先は commit 8f1d956d で物理削除済みである
  When grep -rn "sqliteClient" src/background/handlers/__tests__/confirmTokenConstantTime.test.ts を実行する
  Then vi.mock('../../sqliteClient.js', () => ({})) の行が存在しない
  And npm test -- src/background/handlers/__tests__/confirmTokenConstantTime.test.ts が green である
```

### Scenario C1: All 6 (or 7) prod importers of `optimisticLock` now import from `storageTransaction`
```gherkin
Scenario: C1 全 6（または 7）prod importers が storageTransaction に移行される
  Given src/utils/optimisticLock.ts が @deprecated shim として存在し、6 箇所の prod ファイルが from '../optimisticLock.js' を import している
  When 以下全ファイルで grep -n "from.*optimisticLock" src/ --include="*.ts" を実行する
    | file |
    | src/utils/markdown/MarkdownBufferManager.ts |
    | src/utils/migration/retryPendingWrites.ts |
    | src/utils/storage/pendingStorage.ts |
    | src/utils/savedUrlRepository.ts |
    | src/utils/storage/settingsMigration.ts |
    | src/utils/permissionManager.ts |
    | src/utils/trustDb/TrustDbKernel.ts（prod なら含む） |
  Then 各ファイルで from '../optimisticLock.js'（または同等の optimisticLock パス）が 0 件である
  And 各ファイルで from './storage/storageTransaction.js' または from '../storage/storageTransaction.js'（相対パスはファイル位置に応じる）への import が存在し、StorageTransaction / withLock / withAtomic / withOptimisticLock / withAtomicKeys のいずれかを import している
  And npm run type-check が green である
```

### Scenario C2: `src/utils/optimisticLock.ts` is physically deleted; type-check / lint / test remain green
```gherkin
Scenario: C2 optimisticLock shim が物理削除され validate が green である
  Given Scenario C1 が完了し、src/utils/optimisticLock.ts への prod import が 0 件である
  When rm src/utils/optimisticLock.ts で shim を物理削除し、以下を実行する
    | command |
    | npm run type-check |
    | npm run lint |
    | npm test |
    | npm run build |
  Then src/utils/optimisticLock.ts が存在せず、grep -rn "from.*optimisticLock" src/ --include="*.ts" が 0 件である
  And type-check / lint / test / build が全て green である
```

## 受け入れ基準
- [ ] A1: `grep -rn "withLockViaPort\|withAtomicViaPort" src/ --include="*.ts"` が 0 件、`src/utils/storage/storageTransaction.ts` から該当 export が削除されている
- [ ] A2: `PROVIDER_REGISTRY` / `ProviderCatalogEntryAlias` / `createStrategy` が削除されている、または `@deprecated` + removal date 付きで明示的に温存され prod caller が 0 件であることが `grep` で確認できる
- [ ] A3: `src/utils/trustDb/TrustDbAdmin.ts` の convenience `isDomainTrusted` 関数が削除され、`getTrustDbAdmin().isDomainTrusted` が唯一の entry point として docs/code コメントで明示されている
- [ ] A4: `createInitialContext` / `assertStage` が `src/background/pipeline/contextBuilder.ts` から削除されている、または `__tests__/` 配下に移動し prod export が存在しない
- [ ] B1: `src/dashboard/__tests__/gistSettings.test.ts:46` の `vi.mock('../../background/sqliteClient.js', …)` が削除（または新 gateway mock に置換）され、該当テストが green
- [ ] B2: `src/background/handlers/__tests__/confirmTokenConstantTime.test.ts:56` の `vi.mock('../../sqliteClient.js', () => ({}))` が削除され、該当テストが green
- [ ] C1: 6 箇所（`MarkdownBufferManager.ts:2` / `retryPendingWrites.ts:7` / `pendingStorage.ts:5` / `savedUrlRepository.ts:16` / `settingsMigration.ts:10` / `permissionManager.ts:10`）の `optimisticLock` import が `storageTransaction` に移行済み。`TrustDbKernel.ts:11` が prod なら同様に移行済み、test-only なら移行不要であることが PR 説明で確認できる
- [ ] C2: `src/utils/optimisticLock.ts` が物理削除され、`grep -rn "from.*optimisticLock" src/ --include="*.ts"` が 0 件、`npm run type-check` / `npm run lint` / `npm test` / `npm run build` が green

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし（本 PBI は dev/CI のみ、ユーザー可視の挙動変更なし）

### 統合テスト
- `npm run validate`（type-check + lint + tests）が green であることを CI で確認 — 本 PBI の最終ゲート
- `npm run build` が green であることを確認（shim 削除後の module resolution 破壊を検出）

### 単体テスト
- A1-A4: 各 orphan export 削除後に `grep` で 0 件であることを assert する conformance テスト（既存の `providerCatalog.test.ts` の half-wired 検出と同様のパターン）を任意で追加
- B1-B2: 該当 2 テストファイルが `vi.mock` 削除後も green であることを確認（mock 空振りの hidden bug がないか、テストの assertion が実体を叩いているかを目視レビュー）
- C1-C2: 移行後の各 importer が `StorageTransaction` / `withLock` / `withAtomic` 経由で正しく動作することを既存テストで回帰確認（`MarkdownBufferManager` / `pendingStorage` / `savedUrlRepository` / `permissionManager` / `TrustDbKernel` の既存スイートが green）

## 実装アプローチ
- **Outside-In**: なし（E2E 変更なし）。`grep` による conformance → 単体テスト green → `npm run validate` green の順で outside-in に近い検証を行う
- **Red-Green-Refactor**: 各カテゴリ（A/B/C）を独立した commit に分割し、各 commit で `grep` による Red（残存確認）→ 削除/移行 → Green（0 件 + validate green）を確認してから次カテゴリへ
- **リファクタリング**: shim 削除は C1（import 移行）が全て green になってから最後に実行。順序違反で `ERR_MODULE_NOT_FOUND` を出さないこと

## 見積もり
1 pt（要チームでの見積もり — RICE Effort=1 人週に対応）

## 技術的考慮事項
- 依存関係: PBI 01（StorageTransaction deep 化）完了済みが前提。PBI 04b（trustDb.ts 物理削除 64609768）と PBI 07b（sqliteClient.ts 物理削除 8f1d956d）完了済みが前提
- テスタビリティ: `grep -rn` による conformance が主。`withLockViaPort` 等は prod caller 0 件を事前に `grep -rn "withLockViaPort" src/ --include="*.ts" | grep -v "__tests__" | grep -v ".test.ts"` で再確認すること
- 非機能要件: ビルド破壊の防止（`optimisticLock.ts` 物理削除は import 移行完了が前提）、dead mock の隠蔽バグの洗い出し（mock 削除後にテストが fail するなら、従来 mock が実体を隠していたバグの可能性 — 要調査）
- 順序: A（orphan 削除）と B（dead mock 削除）は独立して並行可。C1（import 移行）→ C2（shim 物理削除）は直列必須。A/B と C は並行可だが、C2 は全 C1 完了が前提

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行すること）
```bash
# A1
grep -rn "withLockViaPort\|withAtomicViaPort" src/ --include="*.ts"
# expect: src/utils/optimisticLock.ts:12-13 と src/utils/storage/storageTransaction.ts:235-244 のみ

# A2
grep -rn "PROVIDER_REGISTRY\|ProviderCatalogEntryAlias\|createStrategy" src/background/ai/ --include="*.ts"
# expect: src/background/ai/providerCatalog.ts:188,248 のみ（prod caller 0 件を grep -rn "PROVIDER_REGISTRY" src/ --include="*.ts" | grep -v "providerCatalog.ts" で確認）

# A3
grep -rn "isDomainTrusted" src/utils/trustDb/ --include="*.ts"
# expect: TrustDbAdmin.ts:~143 の convenience 関数 + TrustPolicy.ts / TrustDbKernel.ts の method

# A4
grep -rn "createInitialContext\|assertStage" src/ --include="*.ts"
# expect: src/background/pipeline/contextBuilder.ts:~184 の定義 + src/background/pipeline/contextBuilder.test.ts のみ

# B1/B2
grep -rn "sqliteClient" src/ --include="*.ts"
# expect: B1/B2 の vi.mock 2 件のみが残存（prod import は 0 件のはず — PBI 07b で移行済み）

# C — shim importers
grep -rn "from.*optimisticLock" src/ --include="*.ts"
# expect: 6 (+ TrustDbKernel.ts) 件の prod importers + src/utils/optimisticLock.ts 自体
cat src/utils/optimisticLock.ts
# expect: re-export shim（storageTransaction への委譲 + enablePostWriteVerification no-op）
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。

### 実装手順
1. **A. Orphan exports 削除**
   1. `src/utils/storage/storageTransaction.ts:235-244` から `withLockViaPort` / `withAtomicViaPort` の export を削除（shim の re-export も同時に削除されるため、shim 側の該当行も整理）
   2. `src/background/ai/providerCatalog.ts:188,248` の `PROVIDER_REGISTRY` / `ProviderCatalogEntryAlias` / `createStrategy` を削除、または `@deprecated` + removal date を付与して温存（削除が安全なら削除を優先、他ブランチでの参照リスクがある場合は `@deprecated` 温存を選択し PR 説明に明記）
   3. `src/utils/trustDb/TrustDbAdmin.ts:~143` の convenience `isDomainTrusted` を削除し、`getTrustDbAdmin().isDomainTrusted` を唯一の entry point として JSDoc または `dev-docs/DESIGN_SPECIFICATIONS.md` §5.5 に明記
   4. `src/background/pipeline/contextBuilder.ts:~184` の `createInitialContext` / `assertStage` を削除、または `src/background/pipeline/__tests__/testHelpers.ts` 等に移動し test-only 化
   5. 各削除後に `grep -rn "<export>" src/ --include="*.ts"` が 0 件（または test-only のみ）であることを確認し `npm run type-check` green を確認
2. **B. Dead test mocks 削除**
   1. `src/dashboard/__tests__/gistSettings.test.ts:46` の `vi.mock('../../background/sqliteClient.js', …)` を削除。必要なら `offscreenGateway` / `dashboardGateway` への mock に置換、不要なら単に削除
   2. `src/background/handlers/__tests__/confirmTokenConstantTime.test.ts:56` の `vi.mock('../../sqliteClient.js', () => ({}))` を削除
   3. 各削除後に `npm test -- <該当ファイル>` が green であることを確認。fail する場合は mock が実体を隠していたバグの可能性 — 要調査の上で適切な mock に置換
3. **C. optimisticLock shim importers 移行 → shim 物理削除**
   1. 6 箇所の prod importers を `src/utils/storage/storageTransaction.js` に移行:
      - `src/utils/markdown/MarkdownBufferManager.ts:2`
      - `src/utils/migration/retryPendingWrites.ts:7`
      - `src/utils/storage/pendingStorage.ts:5`
      - `src/utils/savedUrlRepository.ts:16`
      - `src/utils/storage/settingsMigration.ts:10`
      - `src/utils/permissionManager.ts:10`
      - `src/utils/trustDb/TrustDbKernel.ts:11` — 着手時に `grep -n "optimisticLock" src/utils/trustDb/TrustDbKernel.ts` で prod import か test-only かを確認。prod なら同様に移行、test-only なら対象外として PR 説明に記載
   2. 各ファイルで `import { withOptimisticLock, withAtomicKeys } from '../optimisticLock.js'` → `import { withOptimisticLock, withAtomicKeys } from './storage/storageTransaction.js'`（または `StorageTransaction.withLock` / `withAtomic` に置換 — `storageTransaction.ts` の公開 API に合わせる。`withOptimisticLock` は `withLock` の alias として提供されているため、いずれも可だが `withLock` / `withAtomic` への統一を推奨）
   3. 全移行後に `grep -rn "from.*optimisticLock" src/ --include="*.ts"` が 0 件であることを確認し `npm run type-check` green を確認
   4. `rm src/utils/optimisticLock.ts` で shim を物理削除
   5. `npm run validate`（type-check + lint + tests）と `npm run build` が green であることを確認

### 落とし穴
- **C の順序違反**: `optimisticLock.ts` を C1 移行前に物理削除すると `ERR_MODULE_NOT_FOUND` で type-check / build が即 fail する。必ず C1 green 後に C2 を実行すること
- **A2 の @deprecated 温存判断**: 他ブランチや外部参照で `PROVIDER_REGISTRY` を使っている可能性。削除前に `grep -rn "PROVIDER_REGISTRY" . --include="*.ts" --include="*.md"` で repo 全体を検索し、0 件なら削除、参照が残る場合は `@deprecated` 温存 + removal date 明記で段階削除すること
- **B の mock 空振り**: dead mock は現在 `vi.mock` が存在しない module を指しているため、vitest が warning または no-op になっている可能性。mock 削除後にテストが fail する場合、そのテストは従来 mock によって実体のバグを隠していた — 要調査
- **相対パス**: `storageTransaction` への移行時、各ファイルからの相対パスが異なる（`../storage/storageTransaction.js` vs `./storage/storageTransaction.js` vs `../utils/storage/storageTransaction.js`）。`npm run type-check` で即検出できるが、PR では各 import の相対パスを要確認
- **TrustDbKernel.ts:11 の prod/test 判定**: このファイルが prod で `optimisticLock` を使っているか、test-only（`__tests__` からの import 経由）のみかを `grep -rn "from.*TrustDbKernel" src/ --include="*.ts" | grep -v "__tests__"` と `grep -n "optimisticLock" src/utils/trustDb/TrustDbKernel.ts` で確認してから C1 に含めるか判断すること

## Definition of Done
- [ ] 全BDDシナリオ（A1-A4 / B1-B2 / C1-C2 の 8 シナリオ）が `grep` または自動テストで検証されパスする
- [ ] `grep -rn "withLockViaPort\|withAtomicViaPort" src/` / `grep -rn "from.*optimisticLock" src/` / `grep -rn "sqliteClient" src/dashboard/__tests__/gistSettings.test.ts src/background/handlers/__tests__/confirmTokenConstantTime.test.ts` が全て 0 件（または A2 の @deprecated 温存を除き 0 件）
- [ ] `src/utils/optimisticLock.ts` が物理削除されている（C2）
- [ ] `npm run type-check` / `npm run lint` / `npm test` / `npm run build` が green
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（必要に応じて `dev-docs/DESIGN_SPECIFICATIONS.md` の該当節を更新 — 特に TrustDb の entry point 明記）
- [ ] `pbi/00-INDEX.md` の進行中一覧から本 PBI を削除し、アーカイブ履歴に 1 行追記（運用ルールに準拠）

## 実装メモ（任意）
- 本 PBI は `0902a` branch review の WARNING/dead-code 指摘を束ねた cleanup。RICE は aggregate で 0.9（dev/CI のみ）と低いが、次の shim 物理削除 iteration を block する drift を一括解消するため、Architecture Deepening 0903 の 7 PBI とは独立して並行着手可能。
- 各 acceptance は離散化されているため、部分着地（例: A/B のみ先行、C は次 PR）も許容する。ただし C1→C2 は同一 PR 内で完結させること（C1 のみで shim を残すと drift が残る）。
- `TrustDbKernel.ts:11` が test-only だった場合、C1 の対象は 6 件で完結する。PR 説明に「TrustDbKernel は test-only のため移行不要」と明記すること。
