# PBI-03: SqliteClient 4 helper重複解消 + storageMaintenance singleton迂回除去

優先度: 3位 / RICE 17.1 (Reach 8 × Impact 2 × Conf 75% / Effort 0.7w) — #5(RICE12.0)と#7(RICE32.0)をマージし再計算
種別: refactor
依存: なし（#5と#7は同一ファイル集合でマージ、他PBIとdisjoint）
ファイル触接: `src/background/sqliteClient.ts:65-165`, `src/utils/storage/storageMaintenance.ts:16-17`, `src/background/createBackgroundServices.ts:114`
Effort: 0.7w (Medium)

## 背景

2つの摩擦が同一ファイル集合に同居しているため1 PBIに統合する。

**摩擦A: 4 helper重複** — PBI-11で20 shimは削除され`call`は4 domain helper（callQuery/callMutate/callMaintain/callStatus）に分割済みだが、4 helperはtry/catch + recordSqliteFailure + logError + categorizeErrorがverbatim重複。変更時に4箇所同期が必要でshallow module化。sqliteMessageHandlersのMap registryはexhaustivenessが実行時forwardWarnのみで静的保証なし。

**摩擦B: singleton迂回** — `SqliteHealthCheck`型はLayer 0（types.ts:12）に抽出済みだが、`storageMaintenance.getDefaultSqliteHealthCheck()`は`await import('../../background/sqliteClient.js')`の動的import + `new SqliteClient()`でsingletonを迂回する。LAYERS.mdのLayer 1-循環例外として記録されているが実質的に逆方向依存（utils→background）を温存し、offscreen二重生成raceとaliveチェック分散を招く。注入経路はcreateBackgroundServicesから可能だが未配線。

## 目的

4 helperを`callInternal` genericに集約し、storageMaintenanceのデフォルトnewを削除してcreateBackgroundServicesから`getSharedSqliteClient`で注入する。utils→backgroundの逆依存を解消し、Layer違反の例外条項を縮小する。

## なぜなぜ分析

### 摩擦A

1. なぜ4 helperが重複か → PBI-11で20 shim削除時に4 domainに分割したがDRY化はスコープ外だったため
2. なぜスコープ外だったか → テスト13ファイルの移行を優先しhelper内部の共通化を先送りしたため
3. なぜ先送りしたか → 4 helperが同一try/catchでもdomainTagでerror taxonomyが分かれるため単純な共通化に見えなかったため

→ 解: `callInternal<T>(op, domainTag)`の単一genericに集約しdomainTagでerror taxonomyを分岐。

### 摩擦B

1. なぜutils→background逆依存か → SqliteHealthCheck型はLayer 0に抽出済みだが注入配線が未実施だったため
2. なぜ未実施だったか → 0824aで型抽出のみでcreateBackgroundServicesへの注入を先送りしたため
3. なぜ先送りしたか → 動的import + newでも動作し、テストでmockしやすいため緊急性が低く見えたため
4. なぜ緊急性が低く見えたか → singleton迂回による二重生成raceは稀なケースで未顕在化だったため

→ 解: storageMaintenanceはhealthCheckを引数注入のみにし、デフォルトの動的import + newを削除。createBackgroundServicesで`() => getSharedSqliteClient().getStatus()`を注入。

## 受け入れ基準 (BDD)

### Scenario 1: 4 helper集約（ハッピーパス）

- **Given** `sqliteClient.ts`に4つのdomain helper（callQuery/callMutate/callMaintain/callStatus）が存在する
- **When** リファクタ後に`query`/`mutate`/`maintain`/`getStatus`を呼び出す
- **Then** 全呼び出しが`callInternal`経由で同一try/catch + error taxonomy分岐を通る
- **And** 既存テスト（sqliteClient関連）が全PASSする

### Scenario 2: 注入によるLayer逆転解消

- **Given** `storageMaintenance.ts`が`healthCheck: SqliteHealthCheck`を引数で受け取る
- **When** `createBackgroundServices`が`getSharedSqliteClient().getStatus`を注入して`ensureStorageQuota`を呼ぶ
- **Then** `storageMaintenance.ts`内に`await import('../../background/sqliteClient.js')`が存在しない
- **And** `new SqliteClient()`の直接生成が存在しない

### Scenario 3: Map registryの静的exhaustiveness

- **Given** `sqliteMessageHandlers`のMapが`SqliteMessageType`全要素を網羅していない
- **When** `tsc --noEmit`を実行する
- **Then** 型エラーで検出される（`satisfies Record<SqliteMessageType, Handler>`）

### Scenario 4: エラー時の挙動維持

- **Given** offscreenが`{success: false, error}`を返す
- **When** `callInternal`がエラーを受ける
- **Then** `recordSqliteFailure` + `logError` + `categorizeError`が従来通り実行される
- **And** 呼び出し元に適切な`SqliteError`が伝播する

## DoD

- [ ] 4 helperが`callInternal` genericに集約され重複が解消されている
- [ ] `storageMaintenance.ts`から`await import('../../background/sqliteClient.js')`と`new SqliteClient()`が削除されている
- [ ] `createBackgroundServices.ts`でhealthCheckが`getSharedSqliteClient`経由で注入されている
- [ ] `sqliteMessageHandlers` Mapに`satisfies Record<SqliteMessageType, Handler>`で静的保証が付与されている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（sqliteClient 13ファイル + storageMaintenance）
- [ ] `grep -rn "await import.*sqliteClient" src/utils/` が0件

## 技術メモ

- `src/background/sqliteClient.ts:65-165`の4 helperを精査し、共通部分（try/catch, recordSqliteFailure, logError, categorizeError）と差分（domainTag, return type）を分離する。
- `src/utils/storage/storageMaintenance.ts:16-17`の`getDefaultSqliteHealthCheck`を削除し、引数必須化。呼び出し元`ensureStorageQuota`のシグネチャ変更に注意。
- `src/background/createBackgroundServices.ts:114`で`getSharedSqliteClient`をimportし、healthCheck factoryを生成して渡す。既存の`storageMaintenance`呼び出し箇所を洗い出す。
- 参考: `dev-docs/LAYERS.md:70`の例外条項を更新し、storageMaintenanceの例外を削除する。
