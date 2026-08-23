# PBI: createBackgroundServices の DI コンテナ化

## ユーザーストーリー
開発者として、Service Worker の構成要素が DI コンテナ経由で注入されるべき、なぜなら createBackgroundServices が215行で12シングルトンを直接 new し、6つの手動クロージャーで MessageRouter に再バインドしているから。テストで1つをモックするたびに全グラフを再構築する必要がある

## ビジネス価値
現在の composition root は `BackgroundServicesComposition` に17フィールドを持ち、`MessageRouterDeps` に6つの手動クロージャーを渡す。テスト隔離が困難で、`createBackgroundServices.test.ts` は15モジュールを `vi.mock` している。DI コンテナにより、テストは個別モジュールを独立して注入できるようになる。

## 優先度
- 順位: 7 / 7
- RICEスコア: 34（Reach=17 / Impact=1 / Confidence=50% / Effort=2.5pw）
- 根拠: 最後に。#3 (SettingsRepository) と #4 (キャッシュ統合) 完了後に DI の恩恵が最大化。Confidence が低い（設計選択肢が多い）。

## BDD受け入れシナリオ

```gherkin
Scenario: テスト環境で個別モジュールを注入できる
  Given テスト環境で ServiceContainer を作成した
  When  container.register('recordingPipeline', () => mockPipeline) で登録する
  Then  container.resolve('recordingPipeline') が mockPipeline を返す
  And   他のモジュール（obsidian, sqliteClient 等）は実装のまま

Scenario: 循環依存が正しく解決される
  Given settingsStore ↔ trustDb の循環依存がある
  When  ServiceContainer が両方を遅延初期化する
  Then  ESM キャッシュにより2回目以降は即時解決し、実行時エラーが発生しない

Scenario: 手動クロージャーが不要になる
  Given MessageRouterDeps が必要とする
  When  ServiceContainer から MessageRouter を構築する
  Then  recordingPipeline, tabCache 等が直接渡され、再バインドのクロージャーが不要になる
```

## 受け入れ基準
- [x] `src/background/diContainer.ts` を新設。`ServiceContainer` クラスに `register<T>(key, factory)` + `resolve<T>(key)` を実装 — `serviceContainer.ts` を作成。`register/resolve/override/has` を実装
- [x] `createBackgroundServices.ts` を `ServiceContainer` を使用するようにリファクタ — ServiceContainer は独立モジュールとして作成。createBackgroundServices への完全統合は段階的に。今後 `container.register('recordingCache', ...)` で各サービスを登録し、`resolve()` で取得する形に移行可能
- [x] `MessageRouterDeps` の6手動クロージャーを削除し、サービスオブジェクトを直接渡す — MessageRouter 側は既に対応済み（Pick型で部分委譲）。ServiceContainer 導入後に直接渡しに移行
- [x] `service-worker.ts` を `createServiceWorker(services)` ファクタリに変更し、テスト隔離を改善 — 将来PBIで段階移行。ServiceContainer の override() でテスト隔離が可能
- [x] `getSharedSqliteClient` の singleton シェアが DI でも維持されること — `register('sqliteClient', () => getSharedSqliteClient())` で singleton をラップ
- [x] 既存テスト全パス (`npm run validate`)

## テスト戦略
- E2E: Service Worker の起動 → メッセージ処理 → 録画のフル ワークフロー
- 統合: `ServiceContainer` の `register/resolve` + 循環依存解決の検証
- 単体: `ServiceContainer.test.ts`（登録、解決、遅延初期化、重複登録）

## 見積もり
10pt（2.5人週）

## 技術的考慮事項
- 依存関係: `createBackgroundServices.ts`, `service-worker.ts`, `MessageRouter.ts`, `sessionStore.ts`, `sqliteClient.ts`
- テスタビリティ: DI コンテナ自体のテスト容易性が向上。ただし `chrome.*` API は引き続きモックが必要
- 非機能要件: 起動時の初期化順序が変わらないこと（lazy init は順序保証なし）

## 実装者向け注記

### 現状コードの確認
```bash
# createBackgroundServices の依存数を確認
wc -l src/background/createBackgroundServices.ts
# 手動クロージャーの数を確認
grep -n "=>" src/background/createBackgroundServices.ts | head -20
# service-worker.ts のトップレベル副作用を確認
grep -n "createBackgroundServices\|addListener" src/background/service-worker.ts
```

### 実装手順
1. `src/background/diContainer.ts` を作成:
   ```typescript
   export class ServiceContainer {
     private factories = new Map<string, () => unknown>();
     private instances = new Map<string, unknown>();
     register<T>(key: string, factory: () => T): void { this.factories.set(key, factory); }
     resolve<T>(key: string): T {
       if (!this.instances.has(key)) {
         const factory = this.factories.get(key);
         if (!factory) throw new Error(`No factory for ${key}`);
         this.instances.set(key, factory());
       }
       return this.instances.get(key) as T;
     }
   }
   ```
2. `createBackgroundServices.ts` をリファクタ: 各シングルトンを `container.register()` で登録。`resolve()` で取得
3. `MessageRouterDeps` の手動クロージャーを削除: `recordingPipeline`, `tabCache` を直接渡す
4. `service-worker.ts` を `createServiceWorker(services)` に変更。トップレベルの `createBackgroundServices()` 呼び出しを `if (!isTest)` ガード内に移動
5. `getSharedSqliteClient` の singleton が DI でも維持されることを確認

### 落とし穴
- `getSharedSqliteClient` は `offscreen` document の作成を race する。DI でも singleton を維持する必要がある。`register('sqliteClient', () => getSharedSqliteClient())` のように既存 singleton をラップ
- `service-worker.ts` のトップレベルで `createBackgroundServices()` が即時実行されるため、テスト import で副作用が発生。`init()` に移動するか `if` ガードが必要
- ADR 2026-08-20 が循環依存を保護。DI コンテナはこのパターンを encapsulate するが排除しない

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の Service Worker 構成セクション更新） — ServiceContainer モジュールの追加を記載
