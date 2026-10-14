# PBI: 堅牢性二層の解消（空catch可視化・ロック寄せ・ログ統一・有界化）

## ユーザーストーリー
拡張機能の保守担当者として、失敗の握り潰し・素のget→set・UI層のconsole直書き・無界キューをなくしてほしい、なぜなら「黙って消える失敗」と「たまに消える更新」が再発し続ける構造だから

## 優先度
- 順位: 01 / 5
- RICEスコア: 10.0（Reach=5 / Impact=2 / Confidence=1.0 / Effort=1.0）
- 根拠: 同点のNN02（10.0）とはリスク軽減効果でタイブレーク。データ消失の可視化が契約drift防止より先行。依存なし。

## 背景（holistic-code-review テーマ4）
backgroundでは `addLog＋ErrorCode＋errorMessage`、重要キーは `withOptimisticLock`、キューは `maxSize＋TTL` が徹底される一方、隣層では同型処理が素のまま残る。いずれも単発ではなく定型句の反復であり、テーマ化の条件を満たす。

## BDD受け入れシナリオ
Scenario: 空catchが可視化される
  Given 空のcatch／`.catch(()=>{})` が残るモジュールがある
  When 該当箇所で例外が発生する
  Then `addLog(LogType.WARN, ...)` に1行が記録され、ユーザ通知の振る舞いは変わらない

Scenario: read-modify-writeがCASになる
  Given `aiUsageTracker` のwindow集計など素のget→setがある
  When 並行に更新が走る
  Then `withOptimisticLock` 経由で更新され、lost updateが起きない

Scenario: UI層のエラーが集約ログに届く
  Given dashboard／popupで `console.error` 直書きがある
  When 該当箇所で失敗する
  Then `logWarn／logError` seam経由で記録され、サニタイザを素通りしない

Scenario: キューとリスナーが有界になる
  Given `opfsWorker` のrequestQueueや `confirmToken` mapがある
  When 長時間の障害や連打が起きる
  Then 上限・TTL・pruneで肥大せず、パネル破棄時にタイマー／購読が解除される

## 受け入れ基準
- [x] 下記の空catch反復に `addLog`／`logWarn`／`logDebug` 可視化が入る（通知振る舞い不変）: `PrivacyCache.ts:110`＋同86（WARN）、`headerDetector.ts:133`（logDebug、ファイル定型に合わせ開発時可視）、`recordSession.ts:323`（WARN）、`manualContentFetcher.ts:159`（WARN）、`migrationBackup.ts:210,257,263`＋同204（WARN）、`sessionStore.ts:383-385`（WARN）。意図的沈黙は残すと判断: `previewPresenter.ts:228`（supersede競合の説明コメントあり）、`obsidianConfigValidator.ts:223`（timeout raceの説明あり）、`deviceUtils.ts:28`（unknown代替が記録）、`offscreenLogger.ts:36`（console代替が可視化）
- [x] ロック二層は実測で精査し、変更不要と判断（WHY記録）: `aiUsageTracker` はVULN-010 promise-chain mutex（`:18-31`）でSW内read-modify-writeを直列化済み。`domainFilterCache` は権威設定からのblind上書き（単一writer）、`reviewSummaryGenerator:317` はrepo seam済み、`SessionAlarmService:44-55` はlast-write-winsが正しい意味＋失敗時logWarn済み。`withOptimisticLock` への寄せは見返りなしの書き換えになるため行わない
- [x] `trancoConsent.ts` の3箇所 `console.error`、`trancoNotification.ts` はエラー系consoleなし（info／warnのみ、対象外）、6分析パネル＋`NavigationRegistry`（3箇所）＋`DashboardBootstrapper`＋`sqliteHistoryQuery`＋`sqliteHistoryModel`（2箇所）のエラー系 `console` が logger seamに寄る（ユーザー通知は不変）
- [x] `opfsWorker.ts:394-396` のrequestQueueに `MAX_QUEUED_REQUESTS = 200` 上限＋shed時合成エラー応答（呼び出し側pending解決）＋worker-log可視化。`opfsPending` 側は15s timeout掃除（`opfsWorkerProxy.ts`）＋dispose時clear（`sqliteEngineHost.ts:473`）ありと実測確認し、追加変更なし。`confirmTokenManager.ts:99-108` に `MAX_CONFIRM_TOKENS = 100`＋最古evict（テスト `confirmTokenMaxCap.test.ts` 3件でpin）
- [x] `flushScheduler.ts:16-36` がインスタンス単位で冪等化。`revisitInsightsPanel` のdestroy時にcopyタイマー解放、`sqliteHistoryModel.onNavigateOut` でsort persistをflush（破棄でなく保存）、`sqliteHistoryPanel` は既存destroyでカバー済みと確認。`trustPanel` はpopup寿命に縛られるため変更なし（WHY記録）
- [x] `confirmTokenManager.ts:150-170` のconsume時save失敗は残存window（再起動＋60s内replay）を許容リスクとしてコメント記録。fail-closed（正規アクション否認）は副作用が大きいため採用せず、TTLがwindowを縛る＋失敗は可視化済み

## 対象外（別途判断）
- KEK base64のsession／local残存（`hmacKeyStore.ts:228-230,193-205`）の脅威モデル判断と鍵設計変更は本PBIに含めない。台帳にフォローアップとして残す。

## テスト戦略
- E2E: 記録失敗時に通知が出てログにWARNが残ること
- 統合: `withOptimisticLock` への寄せ前後で並行更新テストが緑
- 単体: 空catch各箇所の発火テスト、`flushScheduler` 二重登録防止テスト、パネルdestroyテスト、`confirmToken` pruneテスト

## 見積もり
1.0（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（台帳の要確認3件の決着を記録）
