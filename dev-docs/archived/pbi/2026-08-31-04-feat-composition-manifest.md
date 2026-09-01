# PBI: createBackgroundServices の宣言的 CompositionManifest 化と alias 解消

## ユーザーストーリー
開発者として、Service Worker の composition root を宣言的な Manifest で記述したい。なぜなら現在 18 回の `if(!container.has) register(... singleton:true)` と、手動維持の `__BackgroundServicesKeys union` / `_CoreServicesSubsetCheck`、同一インスタンスの alias（`dashboardSqliteClient = sqliteClient`）が boilerplate を生み、新規依存追加が 3 箇所変更を要求し、Leverage が得られないから。

## 優先度
- 順位: 04 / 06
- RICEスコア: **210**（Reach=300 / Impact=1.5 / Confidence=0.7 / Effort=1.5）
  - Reach 300: 新規依存追加時と service-worker 起動時の全開発者。頻度は中だが波及は composition 全体
  - Impact 1.5: 中。alias 削除と union 自動推論で追加コストを 1 行に。既存 bug は少ないため Impact は限定的
  - Confidence 0.7: 工数は読めるが、22 import の層跨ぎ（`setSqliteHealthCheck` / `setPendingWriteQueue`）の分離に不確実性
  - Effort 1.5: 1.5 人週（Manifest 型と builder + alias 削除 + 副作用 onReady 移行）
- 根拠: RICE 4 位。01/02/03 より RICE が低いが、Service Worker の可読性と新規参入者の onboarding に寄与。Worth exploring の筆頭。
- 依存: 01 Settings（`SettingsRepository` の container 登録が Manifest に含まれるため、01 後の方が自然）。独立着手も可。

## 背景 / なぜなぜ分析
- 表層: 新規依存追加で `register` / `resolve` / `union` の 3 箇所を触る
- なぜ1: `ServiceContainer` が string-key の Service Locator で、型安全が手動 union に依存
- なぜ2: `BackgroundServicesComposition` が `dashboardSqliteClient` / `dashboardSqliteHandler` の alias を持ち、Interface が Implementation と同サイズ（shallow）
- なぜ3: `setSqliteHealthCheck(() => sqliteClient.maintain)` と `setPendingWriteQueue` が `createBackgroundServices` 内で副作用として配線され、utils → background の層を跨ぐ
- なぜ4: 22 import が composition root に集中し、どこが何に依存するかが一覧できない
- 解: `{ key, factory, deps, singleton, onReady }` の Manifest 配列 1 つで 18 登録を記述。Container が manifest から解決。alias 削除、型推論で union 自動化、副作用は onReady hook に局所化。

## BDD受け入れシナリオ

Scenario: Manifest 1 要素追加で新規依存が使える
  Given 開発者が `compositionManifest` に `{ key: 'myService', factory: () => new MyService(deps.sqliteClient), deps: ['sqliteClient'] }` を追加する
  When  `createBackgroundServices()` を呼ぶ
  Then  `container.resolve('myService')` で取得でき、service-worker の他箇所は変更不要
  And   TypeScript で `BackgroundServices` の型が manifest から自動推論される

Scenario: alias が存在せず同一取得口が一つ
  Given `createBackgroundServices()` 後の composition
  When  `composition.dashboardSqliteClient` にアクセスしようとする
  Then  コンパイルエラーになる（alias 削除済み）
  And   `getSharedSqliteClient()` または `composition.sqliteClient` が唯一の取得口である

Scenario: 副作用が onReady に局所化される
  Given `pendingWriteQueue` と `sqliteClient` を含む manifest
  When  `createBackgroundServices()` が完了する
  Then  `setPendingWriteQueue` と `setSqliteHealthCheck` が manifest の onReady で 1 回だけ呼ばれる
  And   service-worker.ts は compose 呼び出し以外に副作用を持たない

Scenario: 境界 — テストで override が manifest 差し替えとして機能する
  Given テストが `container.override('sqliteClient', fakeClient)` を呼んだ後に `createBackgroundServices(container)` を呼ぶ
  When  `recordingPipeline` が解決される
  Then  fakeClient を受け取った pipeline が生成される
  And   override されていない他サービスは通常通り生成される

## 受け入れ基準
- [x] `compositionManifest: readonly CompositionEntry[]`（`{ key, factory(container), singleton, onReady?(container) }`）が `compositionManifest.ts` に定義され、19 エントリがここに集約。`createBackgroundServices` は manifest を `register` ループするだけ（`if(!container.has) register()` の羅列を排除）。※ `deps` フィールドは持たず、factory が `container.resolve` で依存を引く形にした（型推論の複雑さを避けるため）
- [x] `BackgroundServicesComposition` から `dashboardSqliteClient` / `dashboardSqliteHandler` が消え、`dashboardSqliteHandler` は container key かつ `MessageRouterDeps` 内部値。呼出側は `messageRouter.getHandler('DASHBOARD_SQLITE')`
- [x] `__BackgroundServicesKeys` 手動 union と `__CoreServicesSubsetCheck` boilerplate が削除される（型安全は `messageRouterDeps: MessageRouterDeps` 明示注釈 + `return {...}` リテラルが `BackgroundServicesComposition` を満たす制約で担保）
- [x] `setPendingWriteQueue` / `setSqliteHealthCheck` の副作用が manifest の `onReady`（`pendingWriteQueue` / `sqliteClient` エントリ）に移設。`createBackgroundServices.ts` の import は 16（全て型 import + `ServiceContainer` / `compositionManifest`）。collaborator の import 36 は本来の所在である `compositionManifest.ts` に集約
- [x] 既存の `createBackgroundServices.__tests__` / `backgroundComposition.test.ts` が override パターンで green
- [x] ADR `2026-08-20-utils-layer-circular-dependency` に追記（循環 2 の回避配線が `onReady` に整理された旨）

## テスト戦略
- E2E: service-worker 起動 → 全 19 message handler が登録され、VALID_VISIT が成功する
- 統合: Manifest からの container 解決、override 差し替え、alias 削除後の `getSharedSqliteClient` 単一性、onReady 副作用の呼出回数
- 単体: Manifest 型推論（型レベルテスト）、deps 解決順序、singleton 保証（2 回 resolve で同一インスタンス）

## 見積もり
3 pt（要チームでの見積もり）— Manifest 型と builder 1pt + alias 削除と呼出元置換 1pt + 副作用移設と import 削減 1pt

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（Manifest 型推論の型レベルテストは見送り — `deps` フィールドを持たない設計にしたため推論の必要がない）
- [x] コードレビュー完了（service-worker / handlers / storage の影響確認 — 2026-09-01）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md §2.2 Service Worker Composition Root を新設。ADR 2026-08-20 に循環 2 の配線整理を追記）
- [x] `npm run validate` が green

## 設計判断メモ
- Manifest に `deps: string[]` フィールドは持たせず、factory に `container` を渡して `resolve` させる形にした。理由: `deps` 宣言と factory 実装の 2 重管理を避け、TS の型推論パズル（factory 戻り値から `BackgroundServices` を導出）を回避するため。`BackgroundServices` interface は手書きの安定契約（11 フィールド）として残す
- `ServiceContainer` は無変更。manifest ループが薄い Adapter

## 実装メモ（任意）
- `ServiceContainer` は維持し、内部で manifest を `register` ループする薄い Adapter にする。container 自体を深くしない
- `MessageRouterDeps` の `recordingPipeline` / `tabCache` の Pick 型は manifest の deps 推論と整合させる
- `dashboardSqliteWiring.ts` の `createDashboardSqliteMessageHandler` は manifest の onReady で生成し、router の deps に注入
