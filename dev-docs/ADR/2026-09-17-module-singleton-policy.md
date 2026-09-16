# ADR: module 級 singleton と composition root の併存方針

## ステータス
採用

## 日付
2026-09-17

## コンテキスト
Service Worker の依存は composition root（`src/background/createBackgroundServices.ts` の
`createBackgroundServices` ＋ `src/background/compositionManifest.ts` の `compositionManifest`、
`ServiceContainer` による singleton 管理）に統一されている。一方で以下の module 級
singleton が並存する（いずれも実コードで現状確認済み）。

1. `src/background/obsidianClient.ts` — module スコープの `globalWriteMutex`
   （`ObsidianClient` のコンストラクタ引数 `options.mutex` が未指定時の既定値、
   テスト用アクセサ `_globalWriteMutex` あり）。container の `obsidian` entry は
   `new ObsidianClient()` であり、この mutex を内包する。単一実体。
2. `src/background/pendingChromeStorageQueue.ts` — module スコープの `activeQueue` ＋
   `setPendingWriteQueue()` による注入点（`getActiveQueue` が未設定時は
   `ChromeStorageAdapter` で遅延構築、テストでは InMemory 系 adapter に差し替え）。
   `compositionManifest` には `pendingWriteQueue` entry
   （`createPendingWriteQueue(new ChromeStorageAdapter())` を factory とする）も存在するが、
   `resolve('pendingWriteQueue')` の消費箇所はなく、alarm 経路は module facade の
   `flushPendingWrites`（`alarmRegistry.ts:81`）を使う。すなわち生産コードでは
   container 実体は構築されるだけ（`createBackgroundServices` の resolve ループ）で消費されず、
   `setPendingWriteQueue` の生産コードからの呼び出しもない（呼び出しはテストのみ）。
   なお manifest の `onReady` 配線は PBI 2026-09-03-05 で撤去され、現 manifest に
   `onReady` 付き entry は0件である（`CompositionEntry` 型の `onReady?` フィールドは残る）。
3. `src/background/offlineNetworkQueue.ts` — ファイル末尾で構築される
   `sharedOfflineNetworkQueue`。`compositionManifest` の `recordingPipeline` entry と
   `alarmRegistry` entry の `getOfflineNetworkQueue` が import して使う。
   `offlineNetworkQueue` の manifest 登録自体は存在しない。一方コンストラクタは
   `QueuePort` を受け（既定値は module 内 `queue`）、`NoOpQueuePort` による差し替え seam を備える。
4. `src/utils/storage/SettingsRepository.ts` — ファイル末尾の `settingsRepository`
   シングルトン（`new SettingsRepository()` 既定構築）。`compositionManifest` には別途
   `settingsRepository` entry（`new SettingsRepository(new SettingsChromeStorageAdapter())`）が
   あるが、`manualRecordDeps` / `saveRecordDeps` / `messageRouter` の各 entry 内では直接
   `settingsRepository.getAll()` / `clearCache()` を参照している。よって SW 内に
   SettingsRepository 実体が2つある（いずれも 1s TTL の in-memory cache。重複の実害なし）。
   なお module singleton は popup / dashboard / content / utils といった container の
   届かない層からも広く消費されている（`obsidianConfigBuilder`、`storage.ts` など）。
5. `src/messaging/messageTransport.ts` — ファイル末尾の `messageTransport`
   （`new MessageTransport()` 既定構築）。stateless（`TransportPort`＋clock は
   コンストラクタ注入、`ImmediateTransport` でテスト差し替え）。manifest 登録なし。
6. `src/background/sqlite/offscreenGateway.ts` — ファイル末尾の `getSharedSqliteClient()`
   （module 内 `sharedInstance` の lazy 初期化）。`compositionManifest` の `sqliteClient`
   entry の factory はこれを呼ぶ。委譲により両経路で単一実体。

これらは MV3 Service Worker の再起動モデルと整合しており、動的な実害はない。SW 終了で
module state も container 実体も共に消え、復帰時に `service-worker.ts` の
`createBackgroundServices()` が両方を再構築する。durable な状態（queue 内容・settings）は
`chrome.storage.local` にあり、lazy singleton は SW 生存期間のキャッシュとして機能する。
ただし「依存を構築する経路が2つある」状態は、新規機能の実装者がどちらに寄せるべきかを
判断できず、`onReady` での初期化順序という暗黙の時間結合を生む。

統制の良い先例として、`src/background/persistentRetryQueue.ts` の promise-chain ロック
（VULN-056 対策：`enqueue` / `flush` / `flushBatch` / `mutate` が `queueLock` 経由で直列化され、
load-then-save の競合を防ぐ）は module singleton に依存せず adapter 注入
（`QueueStorageAdapter`：`ChromeStorageAdapter` / `InMemoryAdapter`）で解決している。
すなわち「共有可変状態の統制は singleton ではなく注入＋ロックで実現する」が実証済みである。

## 決定
全面移行はしない。新規 SW 依存は manifest 登録を原則とし、既存 6件は以下の一覧の理由で
例外として維持する。

| # | singleton | 裁定 | 理由 |
|---|-----------|------|------|
| 1 | `globalWriteMutex` | 現状維持 | in-memory mutex は durable 状態を持たず、SW 生存期間の共有で十分。container の `obsidian` entry が唯一の生産 consumer であり二重実体なし。 |
| 2 | `activeQueue`＋`setPendingWriteQueue` | 現状維持（seam として正当） | utils 層からの呼び出しが DI なしで届く facade であり、テストの InMemory 差し替え seam として意味がある。遅延既定値により単独利用も壊れない。container の `pendingWriteQueue` entry は現状未消費（将来の整理は後続 PBI の判断とする）。 |
| 3 | `sharedOfflineNetworkQueue` | 現状維持 | manifest 化以前からの共有実体。コンストラクタの `QueuePort` 注入が DI seam として機能している（`NoOpQueuePort`）。新規の module singleton 追加はしない。 |
| 4 | `settingsRepository` | 現状維持 | UI 層（popup / dashboard / content）・utils 層が container の届かない範囲で module singleton を広く消費しており、SW 側だけ寄せても2経路は消えない。SW 専用の新規依存は container の `settingsRepository` entry を resolve すること。 |
| 5 | `messageTransport` | 現状維持 | stateless（transport＋clock は注入可能）であり container 管理の嬉しさがない。SW 再起動時の再構築も不要。 |
| 6 | `getSharedSqliteClient` | 現状維持（推奨パターン） | container entry が module singleton に委譲する形で単一実体を保証している。module singleton が composition 以前から必要な場合の推奨形。 |

新規 SW 依存の推奨パターン：`compositionManifest` に entry を追加し、依存は factory 内で
`c.resolve` し、可変の協調状態はコンストラクタ注入＋ロック（`persistentRetryQueue` 型）で
実現する。新規の module 級 lazy singleton は作らない。

`setPendingWriteQueue` 型の「`onReady` で注入する module 状態」を認める条件（3つ全てを満たすこと）：
1. facade の consumer が層を跨ぎ DI を受けられない（utils 層・alarm コールバック等）。
2. 注入は composition root から起動時に1回だけ行い、初回使用より前に完了する。
3. 未注入時の遅延既定値が生産動作として正しく、テストが差し替え可能である。

全面移行をしない理由：(a) 動的実害がゼロ（再起動モデルと整合）に対する変更リスクが見合わない、
(b) UI 層の module singleton 消費は container（SW 専用）では消せない、
(c) テスト seam（`setPendingWriteQueue`、port 注入）を壊す恐れがある。

## 結果
- 6件の singleton それぞれについて container 寄せ／現状維持の裁定を上表に記録した。
- 新規 SW 依存は manifest 登録を原則とし、lazy singleton は例外として本 ADR の一覧＋理由を参照する。
- `setPendingWriteQueue` 型の注入は上記3条件を満たす場合にのみ認める。現 manifest に
  `onReady` 付き entry は0件であり、新たな `onReady` 追加は本条件への適合をレビューで確認する。
- 再検討のトリガー：(1) container 未消費の `pendingWriteQueue` entry の死活を整理する PBI が
  起票されたとき（`onReady` で container 実体を `setPendingWriteQueue` に流すか、entry を削除するか）。
  (2) `settingsRepository` の SW 内二重実体（module singleton vs container entry）が実害
  （cache 不整合等）を起こしたとき。(3) 新規の module singleton 追加の提案が出たとき。
  いずれかが満たされたら本 ADR を置換する ADR を起票する。
- 本 PBI のコード変更は doc comment レベルに留まり、挙動変更はない。

## Implements
- `src/background/obsidianClient.ts` — `globalWriteMutex` 宣言箇所の ADR 参照 doc comment
- `src/background/pendingChromeStorageQueue.ts` — `activeQueue` 宣言箇所の ADR 参照 doc comment
- `src/background/offlineNetworkQueue.ts` — `sharedOfflineNetworkQueue` 宣言箇所の ADR 参照 doc comment
- `src/messaging/messageTransport.ts` — `messageTransport` 宣言箇所の ADR 参照 doc comment
- `src/background/sqlite/offscreenGateway.ts` — `getSharedSqliteClient` 宣言箇所の ADR 参照 doc comment

## 参照
- `src/background/compositionManifest.ts` — 登録リスト（現状 `onReady` 付き entry なし）
- `src/background/createBackgroundServices.ts` — register／resolve／`onReady` 実行ループ
- `src/background/serviceContainer.ts` — register/resolve/override
- `src/background/service-worker.ts` — 起動時の `createBackgroundServices()` 呼び出し
- `src/background/persistentRetryQueue.ts` — adapter 注入＋promise-chain ロックの先例（VULN-056）
- `src/utils/storage/SettingsRepository.ts` — `settingsRepository` singleton（調査のみ、本 PBI では編集しない）
- `src/background/retryPendingWrites.ts` — module facade 経由のリトライ実体
- `src/background/alarmRegistry.ts` — `flushPendingWrites` の alarm 経路消費
- `dev-docs/ADR/2026-08-20-utils-layer-circular-dependency.md` — `onReady` 配線の沿革
- PBI: `pbi/2026-09-17-08-investigate-module-singleton-policy.md`
- 5 Whys: `/tmp/whywhy/pbi08-module-singleton-policy.md`
