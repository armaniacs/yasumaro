# PBI: ダッシュボード重複ロジック統合（AI 接続テスト runner・Tranco 同意判定）

種別: refactor
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ5）。同じ「AI 接続テストの実行ループ」と「Tranco 同意の 30 日ルール」が popup 側と dashboard 側にそれぞれ独立実装され、判定と guard が二重化している。

## ユーザーストーリー

dashboard を触る開発者として、接続テストと同意判定の仕様変更を 1 箇所の修正で全体に届けたい、なぜなら片方だけを直すと「一般設定では通るが診断では通らない」「popup は再同意を出すが dashboard は出さない」のような不整合が静かに残るから

## 優先度

- 順位: 8 / 10
- RICE スコア: 2.4（Reach=3 / Impact=1.5 / Confidence=80% / Effort=1.5）
- 根拠: 影響範囲は接続テスト 2 画面と Tranco 判定 2 画面の計 4 ファイルに留まるため Reach=3、不一致は UX 上の不整合にとどまり致命的ではないため Impact=1.5。共通モジュール化の取り下げ方に設計判断が伴うため Confidence=80%。PBI 37 と同点 2.4 だが、本件は二重実装そのものを消すという測定可能なリスク軽減（片方だけの修正による食い違い再発）を持つため、37 が先行し本件が後続する

## 現状と問題（file:line 証拠付き）

### item 1: AI 接続テストの実行ループが 2 実装

- 一般設定側: `src/dashboard/generalSettings/connectionTests.ts:339` に `let aiTestInFlight = false` があり、`:374-385` で `subscribeAiTestProgress` → 200ms `setInterval` → `testAiConnection(runId)` を 5 ステップに分けて進める
- 診断側: `src/dashboard/panels/diagnostic/diagnosticsActions.ts:61` に同名の `let aiTestInFlight = false` があり、`:129-139` に構造的に同一のループがある
- 差分は描画先（`#status` 対 `#diagConnectionResult`）と guard 変数の所在のみ
- 描画は共有 view（`src/dashboard/aiTestProgressView.ts` / `src/dashboard/aiTestResultView.ts`）で共通化されているが、実行を駆動する runner が不足している
- リスク: ステップ定義・進捗間隔・終了判定を片方だけ直すと、2 画面の表示が食い違う

### item 2: Tranco 同意の 30 日ルールが 2 実装

- popup 側: `src/popup/trancoNotification.ts:35-45` が `needsConsent` を `elapsedDays >= 30` で判定し、`:81-85` と `:102-106` で 3 キー delta write を行う
- dashboard 側: `src/dashboard/trancoConsent.ts:59-95` の `getTrancoConsentState` が 5 状態を定義し、`retryDaysRemaining > 0` のとき DENIED を返す。書き込みは `:143-147` と `:169-173` で popup と同一の 3 キー（`TRANCO_CONSENT_GRANTED` / `TRANCO_CONSENT_DENIED_REASON` / `TRANCO_CONSENT_DENIED_TIMESTAMP`）へ同一の delta write を行う
- 判定ロジックだけが微妙に異なる（dashboard は 5 状態、popup は boolean）。30 日ルールという同じ意図が 2 表現で書かれている
- リスク: 境界（29 日 / 30 日 / 31 日）で popup と dashboard の結論が分かれる

### スコープ外（本 PBI では扱わない）

- `initTrancoConsentPanel` が panel lifecycle 外で実行され refresh 経路を持たない問題（`src/dashboard/dashboard.ts:91` × `src/dashboard/panels/staticForm/staticPanels.ts:74-81`）。本 PBI は判定と書き込みの集約のみを対象とし、panel 起動・refresh のwired-ness は別 PBI の責務とする

## 改善方針（方向性）

1. 接続テストの実行を 1 モジュール（runner）に抽出する。責務は `generateAiTestRunId` → `subscribeAiTestProgress` → interval → `testAiConnection` → format 行のループ。描画先と interval 長は注入可能にし、in-flight guard は runner 側の単一 state として持つ
2. Tranco の判定関数（30 日ルール）と 3 キー delta write を `src/utils/trancoConsent.ts` 相当へ集約し、popup / dashboard の双方から import する。状態の粒度差（dashboard の 5 状態）は呼び出し側の写像に残し、ルール自体は SSOT とする

## BDD 受け入れシナリオ

```gherkin
Scenario: 接続テストは単一 guard を共有する
  Given 一般設定画面と診断画面の両方が存在する
  When 一方で AI 接続テストを実行中に、もう一方から実行を要求する
  Then 単一の in-flight guard により二重実行されない
  And 両画面は同じ runner モジュールで判定されている

Scenario: 同意判定は同一ルールを使う
  Given 同意拒否から 20 日が経過している
  When popup と dashboard がそれぞれ同意状態を判定する
  Then 両者は同一の判定（再同意不要、または同一の retry 結果）を返す
```

## 受け入れ基準

- [x] AI 接続テストのループ本体（runId 生成 / progress 購読 / interval / `testAiConnection` 呼び出し / format 行の描画）が 1 モジュールに集約され、`src/dashboard/generalSettings/connectionTests.ts:374-385` と `src/dashboard/panels/diagnostic/diagnosticsActions.ts:129-139` の重複ループが削除されている
- [x] in-flight guard が runner 側の単一 state として管理され、`src/dashboard/generalSettings/connectionTests.ts:339` と `src/dashboard/panels/diagnostic/diagnosticsActions.ts:61` の二重定義が解消されている
- [x] 描画先（`#status` 側 / `#diagConnectionResult` 側）は注入引数として runner から分離され、既存の共有 view（`src/dashboard/aiTestProgressView.ts` / `src/dashboard/aiTestResultView.ts`）の利用は維持されている
- [x] 30 日ルールと 3 キー delta write が共通モジュールに集約され、`src/popup/trancoNotification.ts:35-45`・`:81-85`・`:102-106` と `src/dashboard/trancoConsent.ts:59-95`・`:143-147`・`:169-173` が同じ関数を呼ぶ形になっている
- [x] 状態の粒度差（dashboard の 5 状態、popup の boolean）は呼び出し側の写像として残っており、ルール判定が二重に存在しない
- [ ] `src/dashboard/dashboard.ts:91` × `src/dashboard/panels/staticForm/staticPanels.ts:74-81` の panel lifecycle 問題は本 PBI の変更対象に含まれていない

## テスト戦略

- 単体（接続テスト runner）: タイマーを注入し、interval を手動駆動する。待機は既存 `waitForMock` 規約に従い、実時間待ち（`setTimeout` による固定 sleep）は禁止する
- 単体（Tranco 判定）: 30 日ルールの境界値を 29 日 / 30 日 / 31 日で固定し、popup 表現と dashboard 表現が同じ判定へ写像されることを検証する
- 既存テスト: 描画 view（`aiTestProgressView` / `aiTestResultView`）のテストは据え置き。E2E の変更は不要（画面の見た目は変えない）

## 見積もり

1.5 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29）

### (a) Tranco 同意判定の統合（受け入れ基準 4・5 実装済み）

- 共通モジュール: `src/utils/storage/trancoConsent.ts`（`navTrailConsent.ts` と同じ storage 層の同意モジュールに置く）
  - `evaluateTrancoConsent(snapshot, now)` — 30 日ルール判定の唯一の持ち主。`alreadyGranted` / `hasDenial` / `needsConsent` / `daysUntilRetry` を返す
  - `needsTrancoConsent(snapshot, now)` — popup 用の boolean 表現（判定は `evaluateTrancoConsent` に委譲）
  - `persistTrancoConsentGrant(version)` / `persistTrancoConsentDeny(deniedAt)` — 3 キー delta write。書き込み先は従来どおり `saveSettingsAndRefreshDomainFilterCache`
- 呼び出し側: popup は boolean、dashboard は 5 状態（`ALREADY_GRANTED` / `PENDING` / `DENIED` / `RETRY_NEEDED`）への写像だけを残し、日数演算は両方から消えた
- 境界の定義を 1 つに揃えた: popup の `elapsedDays >= 30`（実ミリ秒比較）を正とし、dashboard の `Math.ceil(elapsedDays)` は採用しない。判定結果が変わるのは 29 日超 30 日未満（例 29.5 日）で、この間だけ dashboard が `RETRY_NEEDED`（再提示）から `DENIED`（残り 1 日）に変わる。30 日ルールは「30 日が満了するまで再提示しない」であり、切り上げは早すぎる再提示になるため
- テスト: 29/30/31 日（および 30 日境界の 1ms 前・ちょうど）を `src/utils/storage/__tests__/trancoConsent.test.ts` に集約。両呼び出し側のテストは自分の写像（PBI テスト戦略どおり境界は 1 箇所だけ）。`trancoConsentRuleOwnership.test.ts` はソース走査で呼び出し側に日数演算・`'deny'` リテラルが戻っていないことを固定
- `domainFilterCacheSaveSeamContract.test.ts` の `ADOPTED_CALL_SITES` は、seam に直接乗る場所が変わったため `src/utils/storage/trancoConsent.ts` に差し替え。dashboard / popup は「直接 `updateDomainFilterCache` を通らない」ガード側に移した

### (b) AI 接続テスト runner の抽出（受け入れ基準 1-3 実装済み）

- 新規モジュール: `src/dashboard/aiTestRunner.ts`（共有 view と同じ `src/dashboard/` 直下に置く）
  - `runAiConnectionTest(options): Promise<AiTestRunOutcome>` — guard → runId 生成 → 進捗購読 → 経過時間 interval → `prepare` → `run(runId)` → 結果描画。戻り値は `'ran' | 'aborted' | 'failed' | 'guarded'`
  - `renderAiTestProviderLines(target, providers)` — `aiTestResultView` の整形結果を DOM 化する共有描画（両面が完全に同一だった部分）
  - in-flight guard はモジュールスコープ 1 個。`finally` で必ず解放する（例外終了時も解放）
  - `intervalMs`（既定 200ms）を引数で注入できる
- 注入引数: `target`（描画先）/ `run`（TEST_AI 送信）/ `draw`（`elapsedMirror`・`onProviderAnnounced`・`onProgressStarted`・`multiProviderSummary`・`singleProviderSummary`・`onResultRendered`・`onError`）/ `prepare` / `onStart` / `onFinish`
- 呼び出し側は「描画先を解決して runner を呼ぶ」だけに縮小し、公開関数の形（`handleTestAi` / `createDiagnosticActions`）は変えていない
  - 一般設定: `#status` と `#statusTop` の解決、`syncStatusToTop`、複数/単一プロバイダのサマリ、設定保存（`prepare` として送信前に実行、save 失敗は `showSaveError` 後に送信しない）、2 ボタンの無効化
  - 診断: `#diagConnectionResult`、診断パネル独自のサマリ行とエラー表示、1 ボタンの無効化
- 減量: `connectionTests.ts` +43/-97、`diagnosticsActions.ts` +24/-86（いずれも AI テスト部分のみ）
- テスト: `src/dashboard/__tests__/aiTestRunner.test.ts`（17 件。guard の抑止と解放、runId の相関、注入 interval での経過時間描画、プロバイダ切替の読み上げ、prepare の中止、例外描画、複数/単一プロバイダの行、clean-up）
  - `src/dashboard/__tests__/aiTestRunnerOwnership.test.ts`（5 件。ソース走査で「ループの各ステップと guard が呼び出し側に了回去ら落ちる」ことを固定。`aiTestProgressClient` の production import が runner 以外から無いことも見る）
- 逸脱:
  1. `testAiConnection` は import せず `run` 引数で注入した。送信関数が `connectionTests.ts` にあり、そのファイルが本 runner を import するため、import するとモジュールが循環する
  2. 共有 view のうち `aiTestProgressView` / `aiTestResultView` / `aiTestProgressClient` は移さずそのまま利用した（受け入れ基準 3 のとおり）。runner はこれらを呼ぶ側
  3. 診断側の到達不能だった `else { connectionResult.textContent = 'Test complete.' }` は削除した（`testAiConnection` は必ずオブジェクトを返す）
  4. 受け入れ基準 6（`dashboard.ts:91` × `staticPanels.ts:74-81` の panel lifecycle）は本 PBI の変更対象外のまま未チェック。別 PBI の責務

### 検証（2026-09-29）

#### (a) Tranco 同意判定（受け入れ基準 4・5）

- `npx vitest run src/utils/storage/__tests__/trancoConsent.test.ts src/utils/storage/__tests__/trancoConsentRuleOwnership.test.ts src/popup/__tests__/trancoNotification.test.ts src/dashboard/__tests__/trancoConsent.test.ts src/utils/storage/__tests__/domainFilterCacheSaveSeamContract.test.ts` — 63 tests passed
- 同 5 ファイルを 20 回連続実行 — 全回 green
- `npx vitest run src/popup/__tests__ src/utils/storage/__tests__`（81 files / 1255 tests）、`npx vitest run src/dashboard/__tests__`（86 files / 1121 tests）— いずれも passed
- `npx tsc --noEmit`、変更ファイルへの `npx eslint` — エラーなし

#### (b) AI 接続テスト runner（受け入れ基準 1-3）

- `npx vitest run src/dashboard/__tests__/aiTestRunner.test.ts src/dashboard/__tests__/aiTestRunnerOwnership.test.ts src/dashboard/generalSettings/__tests__/connectionTests.test.ts src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts` — 4 files / 135 tests passed
- 同 4 ファイルを 10 回連続実行 — 全回 green
- `npx vitest run src/dashboard/__tests__` — 89 files / 1160 tests passed
- `npx vitest run src/dashboard`（配下の `__tests__` を含む全 dashboard テスト）— 199 files / 2927 tests passed
- `npx vitest run src/dashboard/__tests__/dashboard-handlers.test.ts src/dashboard/__tests__/dashboard.test.ts` — 2 files / 56 tests passed（進捗購読と statusTop の経過時間ミラーの既存テストが、runner 経由でも同じ挙動であることを確認）
- `npx tsc --noEmit`、変更 6 ファイルへの `npx eslint` — エラーなし（`connectionTests.test.ts` の `vi.useFakeTimers()` 警告は既存の `handleTestLocalMarkdown` 側のもので本次の触れていない範囲）
- 備考: `npx vitest run <file> --repeats=20` は本リポジトリの `projects` 設定では回数が反映されない（wall clock も変わらない）ため、連続 10 回のプロセス実行で代替した

### 未完了（DoD）

- `npm run validate` 未実行（本次指示でフルスイート・validate は対象外）。DoD のチェックは未チェックのまま
- コードレビュー未実施
