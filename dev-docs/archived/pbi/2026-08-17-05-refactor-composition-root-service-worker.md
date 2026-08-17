# PBI: service-worker.ts の composition root 化を完了する

## ユーザーストーリー
開発者として、`service-worker.ts` に残っている alarm 登録、notification 設定、message routing 初期化、token 管理、migration defer などの責務を composition root または専用ファクトリに移設したい。なぜなら、579行の Service Worker エントリーポイントは初期化、ライフサイクル管理、ユーティリティが混在しており、変更時の影響範囲が大きいから。

## ビジネス価値
- Service Worker を薄い「ワイヤリング層」に近づけ、テスト容易性を向上させる
- 新しい chrome event listener や alarm handler の追加が、composition root で一元管理される
- `service-worker.ts` 内のimport数を削減し、依存関係の把握を容易にする

## BDD受け入れシナリオ

```gherkin
Scenario: Service Worker 起動
  Given 拡張機能が有効化される
  When Service Worker が起動する
  Then `createBackgroundServices` と新しい composition root が協調者を構築する
  And `service-worker.ts` は chrome event listener の登録のみを行う

Scenario: メッセージルーティング
  Given Content Script から有効なメッセージが送信される
  When `chrome.runtime.onMessage` が発火する
  Then composition root が構築した `MessageHandlerRegistry` がディスパッチする
  And ハンドラの依存は composition root から注入されている

Scenario: アラーム発火
  Given 定期アラームが設定されている
  When `chrome.alarms.onAlarm` が発火する
  Then composition root が提供した alarm handler が実行される
  And `service-worker.ts` 内に alarm 固有のロジックが残っていない
```

## 受け入れ基準
- [ ] `service-worker.ts` の行数が 300行以内に削減されている
- [ ] `service-worker.ts` 内で `new` されるビジネスサービスが composition root 以外に存在しない
- [ ] alarm 初期化、notification 設定、message routing、confirm token、migration defer の責務が composition root または専用ファクトリに移動している
- [ ] 既存の Service Worker テストがすべてパスする
- [ ] `init()` のテストが composition root 呼び出しの検証に置き換えられる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能の有効化・無効化・再起動シナリオ
- Dashboard からのメッセージングシナリオ

### 統合テスト
- `createBackgroundServices` + `createMessageRegistryComposition` + 新 composition root の連携
- alarm handler の wiring テスト
- `chrome.runtime.onMessage` のルーティング契約

### 単体テスト
- 各 extracted モジュール（alarm initializer、notification setup、token manager、deferred migration runner）
- Service Worker ファイルの import 数と行数メトリクス

## 実装アプローチ
- **Outside-In**: `service-worker.ts` の責務を列挙し、それぞれを composition root またはファクトリに移動
- **Red-Green-Refactor**: 抽出ごとに `service-worker.ts` 内の行数と import 数を減らす

## 見積もり
5ポイント

## 技術的考慮事項
- 依存関係: `src/background/createBackgroundServices.ts`、`src/background/createMessageRegistryComposition.ts`、`src/background/handlers/*.ts`、`src/background/notificationHelper.ts`、`src/background/sessionAlarmsManager.ts`、`src/background/dailyPurgeHandler.ts`、`src/background/swStatePersistence.ts`
- テスタビリティ: composition root は chrome API への副作用を持たず、オブジェクトグラフを組み立てるだけにする
- 副作用: Service Worker は拡張機能のエントリーポイントなので、モジュールロード時の副作用を維持しつつ、ロジックを移動する

## 実装者向け注記

### 現状コードの確認
```bash
wc -l src/background/service-worker.ts
grep -E "^import " src/background/service-worker.ts | wc -l
grep -n "chrome\.alarms\|chrome\.notifications\|chrome\.runtime\.onMessage\|chrome\.contextMenus\|chrome\.action" src/background/service-worker.ts
```

### 推奨構成
```
src/background/
  service-worker.ts                    # エントリポイント：listener 登録のみ
  createBackgroundServices.ts          # 既存：長寿命協調者
  createMessageRegistryComposition.ts  # 既存：メッセージハンドラ registry
  createServiceWorkerComposition.ts    # 新規：alarm / notification / token / migration defer wiring
  alarmInitializer.ts                  # 新規：alarm 作成と onAlarm listener
  confirmTokenManager.ts               # 新規：dashboardSqliteConfirmToken の管理
  deferredMigrationRunner.ts           # 新規：runMigration の遅延実行
```

### 実装手順
1. `service-worker.ts` の責務を分類する（alarm、notification、token、migration、message routing）
2. 新規 `createServiceWorkerComposition` を作成し、各責務をそこに移動
3. `createMessageRegistryComposition` は既存のため、必要に応じて拡張
4. `service-worker.ts` は `createBackgroundServices()` と `createServiceWorkerComposition()` を呼び出し、戻り値で chrome event listener を登録するだけにする
5. 既存テストを更新：composition root の呼び出しを検証

### 落とし穴
- `CONFIRM_TOKEN` はモジュールスコープ変数。Service Worker 再起動をまたいで `chrome.storage.session` に永続化するため、`confirmTokenManager` でも同様の戦略を維持する
- `autoSavedBadgeTabs`、`isCacheInitialized` は `swStatePersistence.ts` 由来。composition root で生成して listener に渡す
- `chrome.runtime.onMessage.addListener` は複数回登録されると複数回発火する。composition root で一度だけ登録する
- `initializeSessionAlarms()` は `init()` 内で呼ばれている。composition root に移す際、テスト時の呼び出し回数に注意する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テストがすべてパスする
- [ ] `service-worker.ts` の行数と import 数が削減されている
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（必要に応じて）
