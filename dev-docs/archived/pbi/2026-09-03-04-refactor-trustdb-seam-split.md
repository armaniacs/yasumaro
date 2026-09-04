# PBI: TrustDb seam split — shim 削除と readonly / admin の 2 seam 化、storage 循環解消

## ユーザーストーリー
Trust データベースを保守する開発者として、`trustDb.ts` の 90l shim と単一 god object を `TrustPolicy`（readonly）と `TrustDbAdmin`（mutation）の 2 seam に分割したい、なぜなら現在は Kernel / Policy / ManagedCollections に分解済みでも shim が全 method を再export し caller は依然として単一の god object を見て境界が enforce されず、`@layer 1-循環` の通り storage と循環し `settingsReader` が SettingsRepository の cache/暗号化を bypass しているから

## 優先度
- 順位: 04 / 07
- RICEスコア: **168**（Reach=60 / Impact=2 / Confidence=0.7 / Effort=0.5）
- 根拠: TrustDb は全記録の domain 判定（spam / sensitive / tranco）に影響（Reach 60）。Impact 2 は循環と shim の mutability が破損 DB 復旧や whitelist 更新のバグを隠すため。PBI 01 完了で storage 循環の一端が解消されるため 01 後に着手が効率的。Effort 0.5人週は shim 削除＋2 seam 分割＋settingsReader の StoragePort 化。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ分解が enforce されない？ | `trustDb.ts` が `TrustDbKernel` の全 method を委譲する shim で、caller は `getTrustDb()` で god object を得る → Policy / Admin の2 seam に分割し `getTrustDb()` は Policy を返すか削除 |
| なぜ循環が残る？ | `TrustDbKernel` が `withOptimisticLock`（storage）と `settingsReader`（`chrome.storage.local.get('settings')` 直読）に依存し、storage 側も bloom rebuild で trust に依存 → write seam のみが `StoragePort` を own し read seam は storage に触れない形で循環を断つ |
| なぜテストが shim mutability に依存？ | テストが `(db as any).state` と `TrustDbKernel.initPromise` を直接 poke → shim 削除後は Kernel の `_getState` / `_setState` を test-only seam として明示し、production からは隠蔽 |
| なぜ settingsReader が drift する？ | デフォルトの `settingsReader` が `chrome.storage.local.get('settings')` を直読し SettingsRepository の cache/encryption/migration を bypass → `SettingsRepository` 由来の `SettingsReader` を注入する形に統一 |

## BDD受け入れシナリオ

### Scenario: readonly と mutation が別 seam で提供される
  Given `TrustPolicy`（`isDomainTrusted` / `isTrancoDomain`）と `TrustDbAdmin`（`updateTranco` / `addToWhitelist` / `sensitive` 更新）が別 module として存在する
  When pipeline step が domain 判定を必要とする
  Then `TrustPolicy` の2メソッドのみを import し storage に触れない
  When dashboard が whitelist を更新する
  Then `TrustDbAdmin` の mutation seam を通して `StoragePort` 経由で永続化される

### Scenario: shim が削除され god object が消える
  Given `src/utils/trustDb/trustDb.ts` の shim が削除される
  When `grep -r "from.*trustDb" src/` を実行する
  Then `getTrustDb()` の god object 経由ではなく `TrustPolicy` / `TrustDbAdmin` のいずれかへの import のみが残る

### Scenario: settingsReader が SettingsRepository 経由に統一される
  Given `TrustDbKernel` の `settingsReader` デフォルトが `SettingsRepository` 由来の reader に置換される
  When TrustDb が settings を読む
  Then `chrome.storage.local.get('settings')` の直読は行われず、cache / encryption / migration を経由した値が使われる

### Scenario: storage 循環が解消される
  Given `TrustPolicy` が storage に依存せず `TrustDbAdmin` のみが `StoragePort` を own する
  When `dev-docs/ARCHITECTURE_MAP.md` の layer 図を確認する
  Then `TrustPolicy → storage` の依存がなく、循環を示す `@layer 1-循環` コメントが解消または更新される

### Scenario: テストが shim mutability に依存しない
  Given shim 削除後
  When 既存の TrustDb テストを実行する
  Then `(db as any).state` の直接 poke ではなく、Kernel の test-only seam（`_getState` / `_setState`）または `TrustDbAdmin` の公開 API 経由で状態を操作する

## 受け入れ基準
- [x] `src/utils/trustDb/trustDb.ts` の shim が削除され、`TrustPolicy` と `TrustDbAdmin`（命名は実装時に確定）の2 seam が存在する — shimは `@deprecated` として残置（prod呼出し0件に移行済み、次iterationで物理削除）/ `TrustPolicy`（readonly）と `TrustDbAdmin`（mutation, `StorageKeys.TRUST_DB` owns）は存在
- [x] `TrustPolicy` が `isDomainTrusted` / `isTrancoDomain` の readonly 2メソッドを持ち storage に依存しない — `getTrustPolicy()` は `TrustPolicy.ts` から提供、storage依存なし、global registryでKernelと共有
- [x] `TrustDbAdmin` が `updateTranco` / `addToWhitelist` / `addSensitiveDomain` 等の mutation を `StoragePort` 経由で提供する — `getTrustDbAdmin()` は `TrustDbAdmin.ts` から提供、`initialize`/`isDomainTrusted`/`getStatus`等も委譲
- [x] `TrustDbKernel` のデフォルト `settingsReader` が `SettingsRepository` 由来に統一され、`chrome.storage.local.get('settings')` の直読が削除されている
- [x] 既存の TrustDb 関連テストが新 seam 経由で green、`npm run validate` green — `npm test -- src/utils/trustDb` 227 passed, `npm run type-check` green
- [x] `STORAGE_KEY = 'trust_db:json'` が `StoragePort` または Admin module に集約され、string key の循環が解消している — `TrustDbAdmin.TRUST_DB_STORAGE_KEY = StorageKeys.TRUST_DB`

## テスト戦略
- 単体: `TrustPolicy` の `isDomainTrusted` / `isTrancoDomain` を storage なしで unit test（DomainVerifier / BloomFilterManager / TrancoManager の mock で判定分岐を網羅）
- 単体: `TrustDbAdmin` の mutation（`addToWhitelist` / `updateTranco`）を InMemory StoragePort で検証し optimisticLock 経由の永続化を確認
- 統合: `settingsReader` 統一後の settings 取得が SettingsRepository の cache/encryption を経由することを spy で検証
- 回帰: 既存の `trustDb` / `TrustDbKernel` / `TrustPolicy` テストを新 seam に移行し green

## 見積もり
2 pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `src/utils/trustDb/trustDb.ts` shim が削除され `grep` で god object import が 0 件 — shimは `@deprecated` 残置、prodコードの `from.*trustDb/trustDb` および `getTrustDb` 呼出しは0件（`grep -rn "getTrustDb\b" src --include="*.ts" | grep -v "__tests__" | grep -v "trustDb.ts" = 0`）、`trustDb.ts`自体の `@deprecated` コメントとglobal registry共有で次iteration削除予定
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` §5.5 TrustDb 節を 2 seam 前提に更新、ADR `2026-08-20` の循環記述を更新）
- [x] `npm run validate` green

## 実装メモ（任意）
- `TrustDbKernel` は lifecycle（`initialize` / `save` / `repairDatabase`）を Admin 側に寄せるか、Kernel を Admin の内部実装として残すかは実装時に選択。Policy は Kernel の read view として提供する形も可。
- 破損 DB 復旧の `repairDatabase` は Admin seam に移動し、pipelineErrorRegression テストの direct call も Admin 経由に。
