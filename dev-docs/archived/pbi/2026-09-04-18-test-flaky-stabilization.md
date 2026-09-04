# PBI 18: 負荷依存フレーキーテストの安定化 — clock 注入・遅延注入・不変式アサーション化

優先度: RICE 16 ≈ (5 × 2 × 80%) / 0.5w / 種別: test
背景: 2026-09-04 のフル suite 実行で 4 ファイルが断続的に失敗（負荷下のみ。単独実行は全 green）。アーキテクチャ診断ラウンド（arch-delivery-loop）の Phase 3 でも 2 回観測され、`make clean test` の信頼性を損なっている。

## ユーザーストーリー
CI とローカルでフル suite を実行する開発者として、テストの合否がマシン負荷に依存しない状態がほしい。なぜなら「再実行したら通った」で回帰を見逃すリスクがあり、フレーキーはゲートの信頼を最も損なうから。

## ビジネス価値
- `make clean test` の exit 0 が再現的に信頼できるようになり、回帰ゲートとしての意味が復元される
- 「フレーキーだから再実行」という運用が消え、失敗 = 本物のバグというシグナルに戻る
- 測定方法: **同一ツリーで `npm test` を 3 連続実行して 0 失敗**（並列負荷のまま）。加えて各安定化テストが決定的であることを単体レベルで検証

## 診断サマリー（2026-09-04 調査、file:line 証拠つき）

| # | ファイル | 機構 | 安定化の方向 |
|---|---|---|---|
| 1 | bodyProtection.test.ts | **固有のフレーキー機構なし**（SUT は同期純関数）。負荷下の worker 資源枯渇（jsdom 起動コスト × forks 無制限）が疑われ、失敗メッセージが未捕捉 | テスト修正禁止。vitest 設定で `poolOptions.forks.maxForks` を cap（4-8）し、次回失敗時にエラー本文を記録 |
| 2 | aiUsageTracker.test.ts | (a) `Date.now()` の 60s ウィンドウ判定 — 期限切れテストは境界マージン 1 秒（SUT :54,:66、テスト :292 で `Date.now() - 61000` をシード）(b) module-level `counterLock` がテスト間で未リセット（SUT :18-26）(c) VULN-010 テストの `delay(5)` 実タイマーが負荷で伸張 | clock 注入（`now: () => number` オプション）+ `resetCounterLockForTesting()` export + `vi.useFakeTimers` へ置換 |
| 3 | RecordingPipeline.test.ts | リトライ 3 回の指数バックオフが**実タイマーで ~11 秒 sleep**（`stepExecutor.ts:34,40` `delay()`、テスト :652-669 が `mockRejectedValue` + 実タイマー）vs `testTimeout: 15000`。ヘッドルーム 4 秒が負荷で消える。同ファイルの `指数バックオフ` ブロック（:466-472）は既に `vi.useFakeTimers` + `runAllTimersAsync` で解決済み — 同手法が未適用なだけ | `StepExecutor` に `delay: (ms) => Promise` を注入可能にするか、:652-669 と :521-589 のテストにも scoped fake timers を適用（~11 秒 → 数 ms、suite 全体も高速化） |
| 4 | tagCooccurrenceCap.test.ts | sub-ms ワークロードの `performance.now()` 比率アサーション（:48-60 `t4 < t1*8`、:96-111 `t4 < t1*12`）。コメント自身が「shared CI hardware picks up scheduling noise」と自認 | wall-clock 比率を**cap 不変式の操作数アサーション**に置換（`edges.length <= C(50,2)` は :19 で既存）。timing signal は非ゲートのベンチ（`bench/`）に移管 |
| 5 | idb-migration.test.ts | (a) モジュール singleton `engine` の `resetForTesting()` が `#mutex` をリセットしない（sqliteEngineHost.ts:364-378 vs :94）(b) `vi.clearAllMocks()` が実装を温存し mock 実装がファイル順で漏洩（:122,184,224,230,253）(c) 実 `runMigrations` + 実 Mutex（30s timeout）+ 動的 import チェーンが負荷で 15s に接近し、init 失敗が `usingFallbackStorage → false` に silently 転化 | `resetForTesting()` に mutex リセット追加（または singleton でなくインスタンス生成）、`vi.resetAllMocks()` + beforeEach 再宣言、`runMigrations` 境界のモック（1 件は統合のまま残す） |

共通設定: `testDir/vitest.config.ts:63-64` は `testTimeout: 15000` + `pool: 'forks'`（maxForks 未設定 → ~20 コアで無制限並列）。

## BDD受け入れシナリオ

```gherkin
Scenario: 負荷下の 3 連続フル suite で失敗ゼロ
  Given 安定化後のコードで vitest.config の forks が cap されている
  When  npm test を 3 回連続実行する
  Then  3 回とも 0 failed で完了する
  And   失敗があった場合はその失敗自体を新たな未完了として分析する

Scenario: レート制限のウィンドウ境界が決定的に検証される
  Given aiUsageTracker に注入可能な clock がある
  When  window_start を clock - 61000ms にシードして checkRateLimit を呼ぶ
  Then  期限切れが実時間に依存せず決定的に検出される
  And   テスト終了時に counterLock がリセットされている

Scenario: リトライバックオフのテストが実タイマーなしで完了する
  Given StepExecutor に即時 delay が注入されている（または scoped fake timers）
  When  privacyPipeline が 3 回失敗する記録を実行する
  Then  テストは 15 秒以内（実質 1 秒未満）で完了する
  And   result.success === false のアサーションは維持される

Scenario: tag 共起の cap 不変式が実時間でなく操作数で検証される
  Given narrowEntriesToTopTags に cap 不変式（ユニーク tag 上限・edge 上限）がある
  When  4 倍のユニーク tag で pre-narrowing を実行する
  Then  出力のユニーク tag 数と edge 数が cap 以下であることを操作数で検証する
  And   wall-clock 比率の pass/fail アサーションはユニットテストから削除される
```

## 受け入れ基準
- [x] vitest.config.ts に `poolOptions.forks.maxForks`（4-8）が設定され、根拠コメント付き
- [x] aiUsageTracker: clock 注入 + `resetCounterLockForTesting()` + VULN-010 の実タイマー排除
- [x] StepExecutor: `delay` 注入パラメータ（本番既定は実 setTimeout）+ RecordingPipeline の NoOp/error-result テストが 1 秒未満で完了
- [x] tagCooccurrenceCap.test.ts: wall-clock 比率アサーション削除、cap 不変式の操作数アサーションに置換
- [x] idb-migration: `resetForTesting()` が `#mutex` をリセット、`vi.resetAllMocks()` + beforeEach 再宣言、runMigrations 境界のモック（1 件統合テストは無モックのまま）
- [x] **`npm test` 3 連続実行で 0 failed**
- [x] `test.skip` / カバレッジ緩和で逃げない（traceId e2e の既存 skip（6.7.98）は別件として範囲外）
- [x] 全 unit / integration テスト green + type-check / lint / build クリーン

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし（本 PBI は unit/integration 安定化が対象。traceId e2e は範囲外）
### 統合テスト
- RecordingPipeline NoOp/error-result テストを注入後の高速経路で green
- idb-migration の hermetic 化された 4 テスト + 無モック統合 1 テスト
### 単体テスト
- aiUsageTracker: clock 注入によるウィンドウ境界（期限切れ/残秒/同時突破）の決定的検証
- QueryCache 非依存の PersistScheduler・tag cap 不変式の操作数アサーション

## 実装アプローチ
- **Outside-In**: 「3 連続 0 失敗」の受け入れ基準を軸に、まず vitest config cap（全体的な contention 低減）→ ファイルごとに機構修正（依存なしで並行実施可）
- **Red-Green-Refactor**: 各安定化は「失敗を再現できる場合のみ TDD」。再現不能（#1）は設定対応 + エラー記録ゲート

## 見積もり
0.5w（診断込み。ファイルごと: #2 0.1w / #3 0.1w / #4 0.1w / #5 0.15w / config+検証 0.05w）

## 技術的考慮事項
- 依存関係: なし（5 ファイル + vitest.config は互いに非重複で並行実装可）
- テスタビリティ: clock/delay 注入は本番既定（Date.now/setTimeout）を壊さない optional パラメータ
- 非機能要件: リート制限・バックオフの**セマンティクス検証を弱めない**こと（VULN-010 の直列化保証、バックオフ上限は別テストで既に担保）。wall-clock probe の移管先は `bench/`（非ゲート）
- 関連: `src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts:99-102` の 15s OPFS timeout が `testTimeout: 15000` と一致 — 偶発一致だが本 PBI では触らない（記録のみ）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "Date.now|performance.now" src/utils/aiUsageTracker.ts src/dashboard/__tests__/tagCooccurrenceCap.test.ts
rg -n "delay\(" src/background/pipeline/stepExecutor.ts src/background/pipeline/__tests__/RecordingPipeline.test.ts
rg -n "resetForTesting|#mutex|clearAllMocks" src/offscreen/sqliteEngineHost.ts src/offscreen/__tests__/idb-migration.test.ts
cat testDir/vitest.config.ts
```

### 実装手順
1. `testDir/vitest.config.ts`: `poolOptions: { forks: { maxForks: 8 } }` を追加（根拠コメント: 660 ファイルの無制限 fork が timing 系テストの contention を生む。8 で ~1.5 倍の実行時間に対して flake 消滅を優先。効果を 3 連続実行で確認し、必要なら調整）
2. aiUsageTracker: `checkRateLimitUnlocked` / `getRateLimitMessage` に `now = Date.now` を注入 → テストで固定 clock。`resetCounterLockForTesting()` を export → beforeEach で呼ぶ。`delay(5)` を `vi.useFakeTimers` + `advanceTimersByTimeAsync(5)` に置換
3. stepExecutor: constructor（または run 呼び出しオプション）に `delay` を追加（既定 `ms => new Promise(r => setTimeout(r, ms))`）→ RecordingPipeline の NoOp/error-result テストで no-op delay 注入（または :466-472 と同じ scoped fake timers）。既存 fake-timer backoff テスト（:466-505）との干渉に注意（スコープはそのまま）
4. tagCooccurrenceCap: 比率アサーション 2 箇所を cap 不変式アサーションに置換（例: pre-narrow 後のユニーク tag 数 ≤ `MAX_TAG_CLUSTER_TAGS`、record あたり edges ≤ C(MAX_TAGS_PER_RECORD, 2)）。timing probe は削除（必要なら bench/ に移管）
5. idb-migration: `sqliteEngineHost.ts` の `resetForTesting()` に `#mutex` リセットを追加（`#mutex` を optional 引数で差し替え可能にする等、本番挙動不変）+ `vi.clearAllMocks()` → `vi.resetAllMocks()` と beforeEach での既定 mock 再宣言 + 4 テストは `runMigrations` モック、1 テストは無モック統合として分離
6. 検証: `npm test` × 3 連続 0 failed → `make clean test` EXIT=0

### 落とし穴
- **fake timers のスコープ**: RecordingPipeline には既存の fake-timer ブロック（:466-505）がある。ファイル単位で useFakeTimers にすると別テストの Promise 解決が止まる — 必ず test 単位で scoped にし、afterEach で useRealTimers
- **mutex リセットは本番挙動を変えない**: `resetForTesting` はテストからしか呼ばれない。本番コードに `if (process.env.VITEST)` 分岐を入れない（resetForTesting のみで完結）
- **bodyProtection は触らない**: 診断で固有機構なし。maxForks cap で解消する可能性が高く、次回失敗時にエラー本文を記録してから判断
- **操作数アサーションへの置換は弱化ではない**: cap 不変式（ユニーク tag 上限・edge 上限）は「貪欲すぎる縮小」を検出できる。失うのは「caps 内での偶発的な速度低下」のみ — それは bench の管轄
- **maxForks cap で suite 時間が伸びる**: 660 ファイル / 8 forks ≒ 実測 ~100 秒前後（現状 ~100 秒と大差ない場合が多い）。3 連続実行で効果を確認してから確定

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（3 連続 0 失敗を含む）
- [x] テストカバレッジが基準を満たす（安定化でテスト数が減っていないこと）
- [x] コードレビュー完了
- [x] リファクタリング完了（injectable clock/delay/scheduler のグリーン後整理）
- [x] ドキュメント更新済み（vitest.config の根拠コメント + `dev-docs/TESTING_GUIDE.md` のフレーキー対応方針があれば同期）
