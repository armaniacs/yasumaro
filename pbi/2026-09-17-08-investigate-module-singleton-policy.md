# PBI: module 級 singleton と composition root 併存方針の裁定

優先度: 順位 8 / 10（RICE: 2.4 = Reach 6 / Impact 0.5 / Confidence 0.8 / Effort 1 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし

## ユーザーストーリー
拡張機能を保守する開発者として、module 級 singleton と DI composition root のどちらに新しい依存を寄せるべきか一枚の方針（ADR）で判断できるようにしてほしい、なぜなら現状は依存を構築する経路が2つ並存し、実装者がどちらを選ぶべきか判断できず、初期化順序という暗黙の時間結合を生むから。

## 背景（現状と課題）
Service Worker の依存は composition root（`src/background/createBackgroundServices.ts` の `createBackgroundServices` + `src/background/compositionManifest.ts` の `compositionManifest`、`ServiceContainer` による singleton 管理）に統一されている。一方で、以下の module 級 singleton が並存する（いずれも該当ファイルを読んで現状確認済み）：

1. `src/background/obsidianClient.ts` — module スコープの `globalWriteMutex`（`ObsidianClient` のコンストラクタ引数 `options.mutex` が未指定時の既定値、テスト用アクセサ `_globalWriteMutex` あり）
2. `src/background/pendingChromeStorageQueue.ts` — module スコープの `activeQueue` + `setPendingWriteQueue()` による注入点（`getActiveQueue` が未設定時は `ChromeStorageAdapter` で遅延構築、テストでは InMemory 系 adapter に差し替え）。なお `compositionManifest` には `pendingWriteQueue` の登録（`createPendingWriteQueue(new ChromeStorageAdapter())` を factory とする entry）も存在する
3. `src/background/offlineNetworkQueue.ts` — ファイル末尾で構築される `sharedOfflineNetworkQueue`（`compositionManifest` の `recordingPipeline` entry と `alarmRegistry` entry の `getOfflineNetworkQueue` が import して使う）
4. `src/utils/storage/SettingsRepository.ts` — ファイル末尾の `settingsRepository` シングルトン（`new SettingsRepository()` 既定構築）。`compositionManifest` には別途 `settingsRepository` entry（`new SettingsRepository(new SettingsChromeStorageAdapter())`）もあるが、`manualRecordDeps` / `saveRecordDeps` / `messageRouter` の各 entry 内では直接 `settingsRepository.getAll()` / `clearCache()` を参照している箇所がある
5. `src/messaging/messageTransport.ts` — ファイル末尾の `messageTransport`（`new MessageTransport()` 既定構築）
6. `src/background/sqlite/offscreenGateway.ts` — ファイル末尾の `getSharedSqliteClient()`（module 内 `sharedInstance` の lazy 初期化）。`compositionManifest` の `sqliteClient` entry の factory はこれを呼ぶ

これらは MV3 Service Worker の再起動モデル（module state は SW 終了で消え、復帰時に再構築される。lazy singleton は SW 生存期間のキャッシュとして機能）と整合しており、動的な実害はない。ただし「依存を構築する経路が2つある」状態は、新規機能の実装者がどちらに寄せるべきかを判断できず、`onReady` での初期化順序という暗黙の時間結合を生む。

参考になる統制の良い先例として、`src/background/persistentRetryQueue.ts` の promise-chain ロック（VULN-056 対策：`enqueue` / `flush` / `flushBatch` / `mutate` が `queueLock` 経由で直列化され、load-then-save の競合を防ぐ）は module singleton に依存せず adapter 注入で解決している。

## BDD受け入れシナリオ（investigate 型: 裁定が記録されることを Then にする）
```gherkin
Scenario: singleton の例外リストと推奨パターンが ADR に記録される
  Given 調査が完了している
  When  ADR を書く
  Then  container 移行対象外として残す singleton の例外リストと、新規 SW 依存の推奨パターンが記録されている

Scenario: MV3 SW 再起動時の挙動が ADR に明記される（境界）
  Given MV3 Service Worker の再起動が発生する
  When  各 singleton を評価する
  Then  再起動時の再構築挙動（SW 終了で module state は消え、復帰時に再構築される）が ADR に明記されている
```

## 受け入れ基準
- [ ] 上記6件の singleton それぞれについて「container 経由に寄せるべきか、現状維持で正当か」の裁定が記録されている（テストで InMemory 差し替えが必要な `pendingChromeStorageQueue` 型は seam として意味がある旨を含む）
- [ ] 新規 SW 依存の推奨パターン（例：新規は manifest 登録を原則とする）が ADR に明記されている
- [ ] `setPendingWriteQueue` 型の「`onReady` で注入する module 状態」を認める条件が ADR に明記されている
- [ ] 全面移行はしない方針の場合、その理由と、残す例外の一覧・理由が ADR に列挙されている
- [ ] コード変更は doc comment レベルに留まっている（挙動変更なし）
- [ ] `npm run type-check` / `npm test` が green のままである

## 調査手順（investigate 型なのでテスト戦略の代わりにこのセクション）
1. 事実確認の起点を読む：`createBackgroundServices`（`createBackgroundServices.ts` の composition 構築関数）、`compositionManifest`（`compositionManifest.ts` の登録リスト、`onReady` の有無と内容）、`ServiceContainer`（`serviceContainer.ts` の register/resolve/override）、`service-worker.ts`（起動時の `createBackgroundServices()` 呼び出し）
2. 上記6ファイルの該当箇所を読む：`obsidianClient.ts` の `globalWriteMutex` 定義とコンストラクタ既定値、`pendingChromeStorageQueue.ts` の `activeQueue` / `getActiveQueue` / `setPendingWriteQueue`、`offlineNetworkQueue.ts` の `sharedOfflineNetworkQueue` 定義、`SettingsRepository.ts` 末尾の `settingsRepository` 定義、`messageTransport.ts` 末尾の `messageTransport` 定義、`offscreenGateway.ts` 末尾の `getSharedSqliteClient`
3. 問い (a) に答える：各 singleton は container 経由に寄せるべきか、現状維持で正当か。`pendingChromeStorageQueue` 型の seam（テストでの InMemory 差し替え）の必要性を評価する
4. 問い (b) に答える：新規 SW 依存の推奨パターンを定める（例：新規は manifest 登録を原則、lazy singleton は例外として列挙＋理由を明記）
5. 問い (c) に答える：`setPendingWriteQueue` 型の「`onReady` で注入する module 状態」を認める条件を定める
6. 統制の良い先例として `persistentRetryQueue.ts` の promise-chain ロック（VULN-056 対策、adapter 注入で解決）を参照し、推奨パターンの裏付けにする
7. 裁定を ADR 1枚に記録し、必要箇所に doc comment を追記する。全面移行はしない

## 見積もり
0.5 日（1 pt）。コード変更は doc comment レベルに留めるため、工数の大半は6件の読み取りと ADR 執筆。

## 実装ガイド
- 対応方針：ADR 1枚に方針を記録（例：新規は manifest 登録を原則、lazy singleton は例外として列挙＋理由を明記、全面移行はしない）。コード変更は doc comment レベルに留める
- `compositionManifest.ts` 内で module singleton を直接 import している箇所（`sharedOfflineNetworkQueue`、`getSharedSqliteClient`、`settingsRepository` の参照）と、container 経由で解決している箇所（`c.resolve` 呼び出し）を見比べて、2経路の対応関係を整理してから裁定すること
- `createBackgroundServices.ts` の `onReady` 実行ループは現状の登録内容と合わせて確認し、「`onReady` で注入する module 状態」の実態（何が・いつ注入されるか）を事実ベースで ADR に書くこと

## Definition of Done
- [ ] 調査結果が ADR として記録される
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
