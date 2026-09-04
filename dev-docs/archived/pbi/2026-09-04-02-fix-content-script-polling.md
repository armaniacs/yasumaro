# PBI: content script の周期ポーリングを単発タイマー + scroll 駆動へ置換

## ユーザーストーリー
ブラウジング中のユーザーとして、拡張を入れても閲覧しているページがカクつかないでほしい。なぜなら現状の content script は滞在条件を満たすまで `requestIdleCallback`（フォールバック時は 1 秒間隔 `setTimeout`）で自己再帰的にポーリングし続け、各回で `ScrollMonitor` 更新・`VisitGate` の再生成・`document.documentElement.hasAttribute` 参照・（E2E 時は `JSON.stringify` + `setAttribute`）を全ページで永続的に実行しているから。

## ビジネス価値
- 全ページ・全ユーザーで常時走るループを削減し、メインスレッド占有（Long Tasks / TBT）を下げる
- アイドルコールバックの連鎖をなくし、バッテリー・CPU への常時負荷を軽減する

## 既実装確認（Phase 0）
- `src/content/contentKernel.ts:320-341` `scheduleNextCheck()` が `this.scheduler.schedule(cb)` で自己再帰。`cb` は `updateMaxScroll()`（= `scrollMonitor.updateFromWindow()` + `checkVisitConditions()`）を呼び、条件未達なら再度 `scheduleNextCheck()`
- `checkVisitConditions()`（`contentKernel.ts:270-305`）が毎回 `this.pageState.toVisitState()` / `toVisitGateThresholds()` / `new VisitGate(thresholds, this.clock)` を生成。`this.isE2ETest()` も毎回評価
- `IdleScheduler.schedule`（`contentKernel.ts:35-42`）: `requestIdleCallback(cb, {timeout: 2000})`、非対応環境は `setTimeout(cb, 1000)`
- `init()`（`contentKernel.ts:347-388`）で scroll リスナー（throttle 100ms, `isTrusted` ガード, passive）と `visibilitychange` を既に登録済み。スクロール変化は scroll イベント側でも捕捉できる
- しきい値（`minVisitDuration` / `minScrollDepth`）は `loadSettings()` 後は不変

## BDD受け入れシナリオ

```gherkin
Scenario: 滞在時間しきい値まで待って一度だけ判定する
  Given minVisitDuration が 5 秒、ページ読み込み直後
  When 5 秒が経過するまでスクロールイベントが発生しない
  Then その間 scheduler.schedule は 1 回だけ呼ばれている（5 秒後発火の単発タイマー）
  And 5 秒経過時に visit 条件が 1 回評価される

Scenario: スクロールで条件到達したら即座に判定・報告する
  Given minVisitDuration=5 秒・minScrollDepth=50%、経過 6 秒
  When ユーザーが 60% までスクロールする
  Then scroll ハンドラ内で visit 条件が評価され reportValidVisit が呼ばれる
  And 以降の周期チェックは停止する

Scenario: 条件到達前にタブが非表示になったらタイマーを止める
  Given 単発タイマーが待機中
  When document.hidden が true になる
  Then 待機中のタイマーがキャンセルされる
  And 再表示時、残り時間ぶんの単発タイマーが再セットされる

Scenario: VisitGate としきい値オブジェクトは init 後に再生成されない
  Given ContentKernel が init 済み
  When visit 条件評価が 10 回行われる
  Then VisitGate インスタンスの生成回数は 1 回（コンストラクタ or init 時のみ）
  And toVisitGateThresholds() の呼び出しは 1 回
```

## 受け入れ基準
- [x] `requestIdleCallback` / `setTimeout` による自己再帰ポーリングを廃止。代わりに「`minVisitDuration - 経過時間` 後に発火する単発タイマー 1 本」+「既存 scroll ハンドラでの条件チェック」に統合
- [x] `visibilitychange`: 非表示でタイマーキャンセル、再表示で「残り時間」ぶんの単発タイマー再セット（固定 interval でなく残余計算）
- [x] `VisitGate` としきい値オブジェクト（`toVisitGateThresholds()` の結果）を `init()` 内で 1 回だけ生成し、以降のすべての判定で再利用
- [x] `isE2ETest()` の結果を `init()` 時に boolean へ確定し、`checkVisitConditions` 内で `hasAttribute` を毎回呼ばない
- [x] `startPeriodicCheck` / `stopPeriodicCheck` / `scheduleNextCheck` の公開 API 名は互換維持（内部実装のみ差し替え）、または呼び出し側をすべて更新
- [x] `Scheduler` インターフェース（`schedule` / `cancel`）と `FakeScheduler`（`flush` / `pendingCount`）は維持。単発化してもテスト可能なこと
- [x] 既存の content script 関連テスト（`contentKernel` / `visitGate` / `scrollMonitor` 系）がすべてパス
- [x] E2E `content-script-recording.spec.ts` / `recording-traceId.spec.ts` が回帰しない

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/content/__tests__/contentKernel.polling.test.ts`（新規）:
  - FakeScheduler で「5 秒未達では schedule 1 回のみ」
  - 「scroll で条件到達 → reportValidVisit 呼び出し + タイマー停止」
  - 「visibilitychange hidden → cancel、visible → 残り時間で再 schedule」（clock 注入で残余を検証）
  - 「visit 判定 N 回で VisitGate 生成 1 回」（コンストラクタを spy）
- `visitGate` の判定ロジック自体は既存テストで担保（本 PBI では変更しない）

### 統合テスト
- E2E `@extension`: 実ページで 5 秒待機 → 自動保存トリガー、および 5 秒前スクロール到達 → 即トリガーの両パス

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c5` でベースライン取得（FakeScheduler 仮想時間 30 秒ぶんの schedule 呼び出し回数・コールバック累積時間）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。schedule 呼び出し回数が「条件未達 30 秒」で N 回 → 1 回に減っていること。無関係な指標が +15% 超で悪化していないこと。
- e2e: `npm run bench:e2e` の autosave-latency と Long Tasks 合計を添付

## 見積もり
2 pt（ロジック差し替え。既存 API とテスト構造は維持できるため中規模）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**（c5 ベンチで効果測定）
- `Date.now()` / `clock` 注入は既存の仕組みを踏襲。残り時間計算は `Math.max(0, (minDuration*1000) - (clock() - startTime))`
- scroll ハンドラは既に throttle 100ms + passive。条件チェック追加による過負荷はない（到達したら stop するため）
- 単発タイマー発火時にスクロール深度が未達なら「その後スクロールされる可能性」を scroll ハンドラが拾う。つまり単発タイマーは「時間しきい値の到達」だけを担当し、スクロールしきい値の監視は scroll イベントに一本化する
- `beforeunload` でのタイマークリーンアップ（`contentKernel.ts:361`）は維持

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '26,51p;258,341p' src/content/contentKernel.ts   # Scheduler / checkVisitConditions / scheduleNextCheck
```

### 実装方針
- `checkVisitConditions()` を「しきい値・gate・isE2E を引数 or フィールドから受け取る」形に変え、`init()` で `this.visitGate` / `this.thresholds` / `this.isE2EResolved` をセット
- `scheduleNextCheck()` → `scheduleDeadlineCheck()` にリネーム（内部）。残り時間を計算して 1 回だけ `scheduler.schedule`。発火時に条件評価し、未達なら**再スケジュールしない**（スクロールは scroll ハンドラ任せ）
- scroll ハンドラ（`init` 内 `throttled`）が既に `updateMaxScroll` → `checkVisitConditions` を呼ぶので、ここは変更不要
- `visibilitychange` visible 時: `startPeriodicCheck()` 相当 → `scheduleDeadlineCheck()`（残余で再セット）

### 落とし穴
- `requestIdleCallback` は「アイドル時に実行」なので、廃止すると「重いページで判定が遅延しない」＝むしろ改善。ただし単発 `setTimeout` はスロットリングされたバックグラウンドタブで遅延する → `visibilitychange` で hidden 時に stop しているので問題なし
- しきい値が 0 秒（テスト設定）の場合、残り時間 0 → 即発火。`schedule` が同期実行される FakeScheduler と実 setTimeout(0) の差に注意（既存テストのパターンを踏襲）
- E2E の `__OW_TEST_STATE` / `data-ow-test-state` 更新は条件評価時のみでよい（毎ループ更新をやめても E2E は条件評価タイミングで読めば足りる）— `content-script-recording.spec.ts` の待ち方を確認

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `npm run bench:micro -- --filter c5` の before/after を PR に添付、schedule 回数の削減を確認
- [x] E2E `@extension` の recording 系がパス
- [x] コードレビュー完了
- [x] CHANGELOG.md に記載（パフォーマンス改善・非機能）
