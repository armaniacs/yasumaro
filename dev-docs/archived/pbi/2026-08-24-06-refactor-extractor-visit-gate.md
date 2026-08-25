# PBI-06: Extractor VisitGate純粋化 — 576行のGating分離

優先度: 2位 / RICE 16.8 (Reach 8 × Impact 3 × Conf 70% / Effort 0.90w)
種別: refactor
依存: THRESHOLD_RULES(6.7.76) — PBI-01の1ループ化完了後はVisitGate抽出が可能。ServiceContainerはcontent isolated worldで恩恵なし
ファイル触接: `src/content/extractor.ts:203-263,323-339` (gating), `src/content/visitGate.ts` (新設), `src/content/pageState.ts` (注入)
Effort: 0.90w (M)

## 背景

PBI-01でthreshold 7連打は`THRESHOLD_RULES`ループに集約したが、extractorは依然576行に7責務を同居。`pageState`はmodule-level singletonで44箇所の`pageState.`アクセスが残留。`shouldRecordVisit(duration,scroll,minDuration?,minScroll?)`はpure化されたが`checkVisitConditions`は依然`pageState.startTime`/`maxScrollPercentage`/`isValidVisitReported`と`Date.now`と`logDebug`に依存し、テストは`extractor.test.ts:685-697`のthrottle timingにfragile。deletion testでVisitGate削除で250行が再出現するshallow module状態。

## 目的

`VisitGate {shouldRecord(duration,scroll):boolean; isReportable(state):boolean}`を`src/content/visitGate.ts`に純粋抽出し、`extractor.ts`の`checkVisitConditions`の4フィールド依存を解消する。`pageState`は`init()`で生成し`VisitGate(thresholds, clock)`に注入、`throttle`と`requestIdleCallback`分岐は`ScrollTracker`に分離の前段としてVisitGateを先行する。

## なぜなぜ分析

1. なぜ576行が7責務同居か → PBI-01でthresholdのみテーブル化したがVisitGateの純粋化はスコープ外で`pageState` globalへの44アクセスが残留したため
2. なぜスコープ外だったか → 7 thresholdsのテーブル化が先に必要で、VisitGate抽出はそのテーブル完了後に設計すべきだったため
3. なぜテーブル完了後でないと抽出できなかったか → `checkVisitConditions`が`pageState.minVisitDuration`/`minScrollDepth`と`Date.now`と`isValidVisitReported`の4フィールドに依存し、純粋化にはthreshold注入とclock注入の2 seamが必要だったため
4. なぜ2 seamが必要だったか → `shouldRecordVisit`は`minDuration/minScroll`引数で既にpure化されていたが、`checkVisitConditions`は依然`pageState.startTime`の経過時間計算と`isValidVisitReported`の冪等ガードを同一関数内に持っていたため
5. なぜ同一関数内に持っていたか → `visit duration gating`と`idempotency gate`と`scroll update`が密結合し、単一の`checkVisitConditions`で3責務を一括判定していたため

→ 解: `VisitGate`を`thresholds:{minDuration,minScroll}`と`clock:()=>number`注入の純粋value objectとして抽出し、`shouldRecord`は`duration/scroll`のみで判定、`isReportable`は`{startTime,maxScroll,isReported}`のvalueで判定。`pageState`は`init()`で生成し`VisitGate`にthreadする。

## 受け入れ基準 (BDD)

### Scenario 1: 純粋判定（ハッピーパス）

- **Given** `VisitGate`が`{minDuration:30, minScroll:50}`と`clock:()=>1000`で生成されている
- **When** `gate.shouldRecord(30, 50)`を呼ぶ
- **Then** `true`を返す（閾値ちょうどで通過）
- **And** `gate.shouldRecord(29, 50)`は`false`を返す（duration不足）

### Scenario 2: clock注入による決定性

- **Given** `clock`が`1000→2000`と進む
- **When** `startTime=1000`で`gate.isReportable({startTime, maxScroll:60, isReported:false})`を`clock=2000`で呼ぶ
- **Then** 経過時間10秒超過で`isReportable`は`duration`不足を検出し`false`を返す

### Scenario 3: 冪等ガード

- **Given** `isReported:true`のstate
- **When** `gate.isReportable(state)`を呼ぶ
- **Then** `false`を返す（既報告は再報告しない）

### Scenario 4: 既存テストの維持

- **Given** 既存の`extractor.test.ts`と`visit-conditions.test.ts`が存在する
- **When** リファクタ後のコードでテストを実行する
- **Then** 全テストがPASSし、`extractor.ts`の`checkVisitConditions`は`VisitGate`経由で同等の判定をする

## DoD

- [ ] `src/content/visitGate.ts`が存在し`VisitGate`クラス（`shouldRecord`/`isReportable`）が純粋実装されている
- [ ] `src/content/extractor.ts`の`shouldRecordVisit`/`checkVisitConditions`/`updateMaxScroll`が`VisitGate`経由に置換され、`pageState.`アクセスが44→8箇所程度に削減されている
- [ ] `npm run type-check` PASS
- [ ] 既存テスト全PASS（8394件）
- [ ] 新規テストで`VisitGate`の純粋判定（境界値・clock注入・冪等ガード）が検証されている

## 技術メモ

- `src/content/extractor.ts:203-212`の`shouldRecordVisit`は既に`minDuration/minScroll`引数でpure。`VisitGate`はこれをラップし`thresholds`をコンストラクタで保持する。
- `src/content/pageState.ts:51-78`の`THRESHOLD_CONFIG_DEFAULTS`は`VisitGate`の`thresholds`源泉。`pageState.thresholds`を`VisitGate`に渡す形でDI。
- 背景の`ServiceContainer`はcontent isolated worldで再利用不可のため、`VisitGate`はローカルfactoryで配線する（`chrome.runtime.sendMessage`経由の注入はアンチパターン）。
- 参考: `/tmp/architecture-review-20260824220957.html` #1、探索レポートの`throttle` timing fragileに注意（`extractor.test.ts:685-697`）。
