# PBI: リスナとエントリポイントの未処理リジェクションが規則なく散在

## ユーザーストーリー

SW の保守担当者として、fire-and-forget の非同期リスナとエントリポイントに未処理リジェクションの規則を設けたい。MV3 では未処理リジェクションはログに落ちるだけで当該イベントの処理が無言で失われ、同一ファイル内で catch の有無が混在しているから。

## 優先度

- 順位: 5/32
- RICE: 8.0（R8 / I2 / C1.0 / E2）
- 根拠: SW リスナ全般に関わる。入口の dynamic import 失敗はログすら残らない検出不能性がある
- 依存: なし

## 背景（file:line 現状）

- `entrypoints/background/index.ts:14-16`: `void import('../../src/background/service-worker.js').then(({ init }) => { init(); });` に `.catch` なし。読み込み失敗は「全リスナ未登録の無反復・ログなし」になる（最重要）
- `src/background/headerDetector.ts` の `(async () => {...})()` IIFE が 7 箇所（:68, :80, :84, :87, :102, :121, :127）すべて未捕捉。`:116` のみ `.catch(() => {})`、`:146` の `evictOldestEntry()` が未 await（内部で await あり）、`:202` 空 catch
- `src/background/service-worker.ts` の登録時 handler が catch なし: `:228` handleTabRemoved / `:229` handleTabActivated / `:230-232` handleTabUpdated（矢印が return）/ `:265` handleInstalled / `:266` handleStartup / `:275` context click / `:278` notification onClicked。`:115` の `rateLimiter.initialize();` は浮いた promise（void も無い）
- `src/background/handlers/notificationHandlers.ts:129`: `chrome.notifications.clear()` の promise 未捕捉
- `src/background/handlers/lifecycleHandlers.ts:92,94`: `restore()` / `updateConsentBadge()` が try の外。`:64-66, :83` も同種
- `src/background/messageHandler.ts:31`: `Promise.all([restore, restore])` が try 外（reject すると `sendResponse` も呼ばれず送信側の port が閉じる）。`:98` の `process();` に `.catch` なし
- 対照（既に守っている例）: `src/background/service-worker.ts:247-252` と `:256-261` の navTrail は `.catch` + logError

## BDD受け入れシナリオ

```gherkin
Scenario: エントリポイントの読み込み失敗が可視化される
  Given service-worker.js の dynamic import が reject する
  When background が起動する
  Then console.error（または log）に失敗が記録される

Scenario: リスナの非同期失敗が握りつぶされない
  Given タブ除去ハンドラ等の非同期リスナが reject する
  When イベントが発火する
  Then guard 経由で logError に記録され、他リスナの動作に影響しない

Scenario: restore 失敗時も応答が返る
  Given messageHandler の restore が reject する
  When メッセージを受信する
  Then エラー応答が sendResponse で返り、送信側の port が閉じたままにならない
```

## 受け入れ基準

- [x] リスナ登録が guard ヘルパ（`guard(fn, tag)` が `void Promise.resolve(fn(...)).catch(log)` を返す形式）に集約され、service-worker.ts の登録箇所が一括置換されている
- [x] `entrypoints/background/index.ts` に `.catch` が追加されている
- [x] `messageHandler.ts:31` の restore が try 内へ移り、reject 時にも `sendResponse` でエラー応答が返る。`:98` の `process()` に `.catch` が付く
- [x] headerDetector の 7 連 IIFE が helper に畳まれ、空 catch（:202）が意図の分かる形になる
- [x] `rateLimiter.initialize()` の浮いた promise が `void` + catch または await のいずれかで処理される
- [x] 既存の try/catch は同じ箇所に残り、挙動不変
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: guard ヘルパのテスト（reject 時に logError が呼ばれ、例外が外に漏れない）
- 単体: messageHandler の restore 失敗時にエラー応答が返るテスト
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `entrypoints/background/index.ts`（.catch 追加）、`src/background/service-worker.ts`（guard ヘルパ export + 登録箇所の一括置換。素の `Promise.resolve(fn(...))` では同期 throw を捕捉できないため `.then` 経由）、`src/background/headerDetector.ts`（7 連 IIFE を `fireAndForget` に畳み込み。`evictOldestEntry()` は同期開始を保つため直接形）、`src/background/handlers/notificationHandlers.ts`、`src/background/handlers/lifecycleHandlers.ts`、`src/background/messageHandler.ts`、`src/background/__tests__/service-worker.test.ts`（guard の void 化に伴う contextMenu 系 5 テストの条件待ち化）
- 注意: `service-worker.test.ts` の `handleStartup` ケースが `--repeats` 2 周目以降に失敗する既存の状態リーク（モジュールレベルの `isCacheInitialized` フラグ）を確認。本変更とは無関係、単発実行では 164/164 PASS
- ゲート: 対象 214/214 + headerDetector repeats 21/21 green / type-check PASS / lint 0 errors
