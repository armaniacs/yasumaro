# PBI-03: createBackgroundServices DI漏れ解消 — 後半7件をcontainer登録

優先度: 3位 / RICE 22.5 (Reach 7 × Impact 1.5 × Conf 75% / Effort 0.35w)
種別: refactor
依存: —
ファイル触接: `src/background/createBackgroundServices.ts:144-218`, `src/background/serviceContainer.ts`
Effort: 0.35w (M)

## 背景

6.7.77で`ServiceContainer`に前半10件（sessionStore/recordingCache/.../aiService）が`register(singleton)`されたが、後半7件（reviewSummaryGenerator/recordingPipeline/manualRecordDeps/saveRecordDeps/dashboardSqliteHandler/autoSavedBadgeTabs/messageRouter）はlocal varで直生成のまま。依存追加時に`BackgroundServices`/`BackgroundServicesComposition`/`MessageRouterDeps`の3型を同時更新する必要がある。`_CoreServicesSubsetCheck`は4フィールドのみでカバー不足。

## 目的

後半7件を`container.register`に移し`BackgroundServices`型を`ServiceContainer`から導出、3重型更新を不要化する。

## なぜなぜ分析

1. なぜ後半7件がmanual newか → 前半10件はregister済みだがpipeline/generator/routerは直生成のままだったため
2. なぜ直生成のままか → `reviewSummaryGenerator`は`createReviewSummaryGenerator({aiService,sqliteClient})`の2依存、`recordingPipeline`は`buildRecordingPipelineDeps`で6依存を束ねる複雑さがあり、register化の設計が後回しになったため
3. なぜ後回しになったか → `messageRouter`は`MessageRouterDeps` 17フィールドを手書きclosureで生成し、container化にはdepsの分解が必要でEffort 0.35wと見積もられたため
4. なぜ分解が必要か → `messageRouterDeps`の`getPrivacyCache`/`updateActivity`等が`recordingCache`/`sessionAlarmsManager`のclosureで、containerの`resolve`で一括取得する形にしないと差替不能なため

→ 解: 後半7件を`container.register`に移し`BackgroundServices`型を`ReturnType`で自動導出。

## 受け入れ基準 (BDD)

### Scenario 1: container経由のpipeline生成（ハッピーパス）

- **Given** `container`に`aiService`/`sqliteClient`等が登録されている
- **When** `container.register('recordingPipeline', () => createRecordingPipeline(buildRecordingPipelineDeps({..., obsidian: container.resolve('obsidian')})))`で登録し`resolve('recordingPipeline')`を呼ぶ
- **Then** 同一インスタンスが返り、`manualRecordDeps`は`recordingPipeline`から派生するfactoryで生成される

### Scenario 2: テストでの差し替え

- **Given** テストが`container.override('sqliteClient', fake)`で差し替える
- **When** `createBackgroundServices(container)`を呼ぶ
- **Then** `recordingPipeline`や`dashboardSqliteHandler`はfake経由の`sqliteClient`を参照する

### Scenario 3: 既存テストの維持

- **Given** 既存の`backgroundComposition.test.ts`が存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSする

## DoD

- [ ] `createBackgroundServices.ts`の後半7件が`container.register`に移行されている
- [ ] `BackgroundServices`型が`ServiceContainer`から自動導出または`_CoreServicesSubsetCheck`が全フィールドをカバーしている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（8394件）

## 技術メモ

- `container.register('reviewSummaryGenerator', () => createReviewSummaryGenerator({aiService: container.resolve('aiService'), sqliteClient: container.resolve('sqliteClient')}), {singleton:true})`等の形で登録。
- `manualRecordDeps`/`saveRecordDeps`は`recordingPipeline`から派生するfactoryとしてcontainer内で生成。
