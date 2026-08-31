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
- [ ] `compositionManifest: Array<{key, factory, deps, singleton, onReady?}>` が単一ファイルに定義され、18 登録がここに集約される
- [ ] `BackgroundServicesComposition` の alias フィールド（`dashboardSqliteClient` / `dashboardSqliteHandler`）が削除され、呼び出し元が `sqliteClient` / `messageRouter.getHandler('DASHBOARD_SQLITE')` に置換される
- [ ] `__BackgroundServicesKeys` 手動 union と `__CoreServicesSubsetCheck` boilerplate が削除され、型が manifest から自動推論される
- [ ] `setPendingWriteQueue` / `setSqliteHealthCheck` の副作用が manifest の onReady または専用 wiring module に移設され、`createBackgroundServices.ts` の import が 22 から 10 以下に削減される
- [ ] 既存の `createBackgroundServices.__tests__` が override パターンで green、service-worker の起動が e2e で green
- [ ] ADR `2026-07-27-ai-client-service-unification` と `2026-08-20-utils-layer-circular-dependency` に追記

## テスト戦略
- E2E: service-worker 起動 → 全 19 message handler が登録され、VALID_VISIT が成功する
- 統合: Manifest からの container 解決、override 差し替え、alias 削除後の `getSharedSqliteClient` 単一性、onReady 副作用の呼出回数
- 単体: Manifest 型推論（型レベルテスト）、deps 解決順序、singleton 保証（2 回 resolve で同一インスタンス）

## 見積もり
3 pt（要チームでの見積もり）— Manifest 型と builder 1pt + alias 削除と呼出元置換 1pt + 副作用移設と import 削減 1pt

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了（service-worker / handlers / storage の影響確認）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の Communication Architecture 章、ADR 追記）
- [ ] `npm run validate` が green

## 実装メモ（任意）
- `ServiceContainer` は維持し、内部で manifest を `register` ループする薄い Adapter にする。container 自体を深くしない
- `MessageRouterDeps` の `recordingPipeline` / `tabCache` の Pick 型は manifest の deps 推論と整合させる
- `dashboardSqliteWiring.ts` の `createDashboardSqliteMessageHandler` は manifest の onReady で生成し、router の deps に注入
