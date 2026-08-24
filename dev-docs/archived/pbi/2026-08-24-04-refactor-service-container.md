# PBI-04: createBackgroundServices 216行の手動配線をServiceContainerに

優先度: 1位 / RICE 15.0 (Reach 8 × Impact 2 × Conf 75% / Effort 0.8w → #7解消で0.6wに低減、RICE 20.0相当)
種別: refactor
依存: #7 storageMaintenance Layer逆転解消（完了済み 6.7.76）
ファイル触接: `src/background/createBackgroundServices.ts` (216行), `src/background/service-worker.ts`, `src/utils/storage/storageMaintenance.ts`
Effort: 0.6w (Medium)

## 背景

`createBackgroundServices`は11個の`new`/factoryと`BackgroundServices` 11フィールド + `Composition` 6フィールド計17メンバを手で配線。依存追加時に3箇所（Services型 / Composition型 / messageRouterDeps Pick）を同期する必要がある。`ServiceContainer`は設計のみで実装なし（grep 0件）。`getSharedSqliteClient`の二重生成は`storageMaintenance`側で解消済みだが、composition root自体は依然手動で、テストは`getSharedSqliteClient`をmockするため全グラフ再構築が必要。deletion testでcontainerを消すと各`new`が`service-worker.ts`とテストに再分散する。

## 目的

`ServiceContainer`に`register<T>(token, factory, {singleton})` + typed tokenを導入し、`createBackgroundServices`を`container.resolve`の宣言的配線に置換する。依存追加が1登録で完結し、singleton責務がcontainerに集中する。

## なぜなぜ分析

1. なぜ17メンバを手で配線するのか → 各singletonが異なる初期化要件を持つため直接`new`してきたため
2. なぜ直接`new`するのか → DIコンテナが存在せず、composition rootが唯一の配線場所だったため
3. なぜDIコンテナが存在しないのか → 前回スプリントで設計のみで実装が見送られたため（Effort 0.8w、依存#7が未解消でLayer逆転が残りcontainer導入時に逆依存が残る懸念があったため）
4. なぜ見送られたか → #7の`storageMaintenance`が`utils→background`逆依存を温存しており、container導入時に`SqliteHealthCheck`注入が一貫しないリスクがあったため
5. なぜ一貫しないリスクがあったか → `createBackgroundServices`から`setSqliteHealthCheck`で注入する経路が未実装で、containerが`new SqliteClient()`を直接生成する恐れがあったため

→ 解: #7解消で`setSqliteHealthCheck`注入が実装済みのため、今スプリントで`ServiceContainer`（register/resolve/singleton）を最小実装し、`createBackgroundServices`の手動`new`をcontainer宣言に置換する。`getSharedSqliteClient`は`singleton:true`のfactoryとして登録する。

## 受け入れ基準 (BDD)

### Scenario 1: 宣言的登録（ハッピーパス）

- **Given** `ServiceContainer`が`register(token, factory, {singleton})`を持つ
- **When** `createBackgroundServices`が`container.register('sqliteClient', () => getSharedSqliteClient(), {singleton:true})`で登録し`container.resolve`で取得する
- **Then** 2回目の`resolve('sqliteClient')`は同一インスタンスを返す
- **And** `BackgroundServices`の17メンバ追加は`register`1行で完結する

### Scenario 2: テスト時の差し替え

- **Given** テストが`container.register('sqliteClient', () => mockClient, {singleton:true})`で差し替える
- **When** `createBackgroundServices(containerWithMock)`を呼ぶ
- **Then** `recordingPipeline`や`storageMaintenance`はmock経由の`sqliteClient`を参照する

### Scenario 3: 既存テストの維持

- **Given** 既存の`createBackgroundServices`テストが存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSし、`service-worker.ts`の起動が成功する

## DoD

- [ ] `ServiceContainer`クラス（50行程度）が`src/background/serviceContainer.ts`に存在する
- [ ] `createBackgroundServices`が`ServiceContainer`経由の宣言的配線に置換されている（手動`new` 11箇所が`register`に）
- [ ] `getSharedSqliteClient`が`singleton:true`のfactoryとして登録されている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（8394件）
- [ ] `grep -rn "new SqliteClient" src/background/` が0件（singleton迂回なし）

## 技術メモ

- 最小実装で良い: `Map<token, {factory, singleton, instance}>` + `register` + `resolve` + `has` + `override` for tests。`createBackgroundServices`は内部で`new ServiceContainer()`しつつ、テスト用に`container`引数を受け取ると差し替え可能にする。
- 参考: `dev-docs/archived/pbi/2026-08-24-00-backlog-0824c.md`のdeferred記載、Phase 0 HTMLレポート #4。
