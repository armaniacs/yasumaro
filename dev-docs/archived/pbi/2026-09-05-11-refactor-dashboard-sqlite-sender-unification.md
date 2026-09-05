# PBI 11: Dashboard SQLite sender 統合 — 5 sender・4 retry を DashboardGateway 1 module へ

優先度: Round 5 1 位 / RICE 28.8 = (9 × 2 × 80%) / 0.5w / Strength: Strong
backlog: arch4「見送り」項目の再評価（Round 5 HTML レポート: `$TMPDIR/architecture-review-20260905-091600.html`、grilling 2026-09-05 で設計確定）
依存: なし（Architecture Round 4 完了後の最初の PBI）

## ユーザーストーリー
Dashboard の送信経路を保守する開発者として、DASHBOARD_SQLITE の送信（token gate・timeout・retry）が DashboardGateway 1 module に集約されてほしい。なぜなら現状は service ローカルに同一ロジックの複製があり、**失敗時の意味が正反対**（service は token 無しでも送信、gateway は fail-closed で throw）、diagnostics は seam を迂回して chrome 直接送信し、retry 条件の vocabulary（`retriable`）は seam を横断しているのに実行の owner がどちら側にも存在しないから。

## 現状の sender / retry 地図（2026-09-05 時点）

**本番 sender 4 箇所:**
1. `dashboardSqliteService.ts:86-95` — `sendDashboardMessageRaw`（token 取得用）
2. `dashboardSqliteService.ts:97-116` — `sendDashboardMessage`（query/search/status 用）
3. `dashboardGateway.ts:22-44` — `sendDashboardRaw` / `sendDashboard`（他 ~19 fn 経由）
4. `diagnosticsActions.ts:203-207` — 直接 `chrome.runtime.sendMessage`（status、decode も生 cast）

**retry 4 層:**
- R1: service `withRetry`（:159-195）— query/search 専用・2 attempt・1000ms・条件「送信 throw または response.retriable」・decode 失敗は retry なし
- R2: `dashboard/utils/retry.ts` `retryWithExponentialBackoff` — load flow レベル（historyModel/tagClusterPanel/DiagnosticsCollector）→ **本 PBI では触らない**（異なる altitude の政策）
- R3: `ChromeOffscreenTransport.msgOffscreen` 1-retry — SW↔offscreen hop の implementation 内部 → 触らない
- R4: `PersistentRetryQueue` / `pendingSqliteQueue` — durable retry → 触らない

**重要な前提事実:** service 側 sender ペアの実呼び出しは `query` / `search` / `status` の 3 subtype のみで、**すべて TOKEN_EXEMPT_OPS 所属**（`sqliteOperationSecurity.ts:64-72`）。つまり service の best-effort token と gateway の fail-closed の乖離は今日潜伏しており、fail-closed へ統一しても挙動は不変。

## 5 Whys サマリー（grilling 2026-09-05 で導出）

1. **なぜ sender が 2 重化したか** → PBI-07 の hop 分割が service ローカル sender ペアの削除まで行かなかったから。変換（decode）と送信が同居していたため、変換の要件が送信の複製を連れてきた。
2. **なぜ retry の owner が未決か** → retry が queryLogs/searchLogs 専用ループとして書かれ、通信政策ではなく feature 固有コードとして成長したから。条件のデータ（`retriable`）は seam を横断済みなのに実行が呼び出し側に置かれた。
3. **なぜ getSqliteStatus が直接送信するか** → 「diagnostics UI は失敗時も部分データを欲しい」という要件を SqliteResult vocabulary の外で受け止める変換層が service 内になかったから。
4. **なぜ diagnostics が迂回できたか** → sender の正当な所在が宣言されず、所在を検査するテストも存在しなかったから。
5. **なぜ module が background/ に置かれたか** → 実行文脈（dashboard ページ）を無視した隣接配置。送信政策の本体が dashboard 開発者の視界から外れ、複製を誘発した。
→ 解: 送信政策の owner を seam（gateway）に決め、変換層を service に置き、所在を grep ガードで固定する。

## BDD受け入れシナリオ

```gherkin
Scenario: DASHBOARD_SQLITE の本番 sender は 1 module のみ
  Given 本番コード全体（__tests__ 以外）
  When  `type: 'DASHBOARD_SQLITE'` の送信箇所を検査する
  Then  dashboardGateway.ts の 1 箇所のみヒットする

Scenario: TEST 系の本番 sender は connectionTests の 2 helper のみ
  Given 本番コード全体（__tests__ 以外）
  When  `type: 'TEST_AI'` と `type: 'TEST_OBSIDIAN'` の送信箇所を検査する
  Then  dashboard/generalSettings/connectionTests.ts 内のみヒットする

Scenario: token 要求 op は fail-closed が uniform に効く
  Given query/search/status を含む全 subtype
  When  破壊 op で token が取れない場合をシミュレートする
  Then  全 op が gateway の fail-closed 意味論に従う（exempt op は token を要求しない）

Scenario: queryLogs の retry 意味論は不変
  Given SQLite 初期化タイミングで初回が失敗する環境
  When  queryLogs を実行する
  Then  1 回だけ retry（送信 throw または retriable）し、decode 失敗は retry しない

Scenario: getSqliteStatus は失敗時も status オブジェクトを返す
  Given SW が応答しない / response.error を返す / decode が失敗する 3 状態
  When  getSqliteStatus を実行する
  Then  いずれも initialized:false + initError 付きの status オブジェクトを返す（今日と同一）
```

## 受け入れ基準
- [x] `dashboardSqliteService.ts` から `sendDashboardMessageRaw` / `sendDashboardMessage` / `getConfirmTokenForAction` / `withConfirmToken` / `DASHBOARD_SQLITE_TIMEOUT` が削除される
- [x] `queryLogs` / `searchLogs` / `getSqliteStatus` が `dashboardGateway.callDashboard` 経由になる。service の公開 API（22 fn・ServiceResult / status shape）は無修正
- [x] `DashboardGateway.callDashboard` に opt-in の retry option（第 4 引数 `{ retryAttempts?, retryDelayMs? }`）が追加される。retry 条件（送信 throw または `response.retriable`・decode 失敗は retry 対象外）は module header に契約として文書化。subtype → retry 設定の政策テーブルは作らない（3 つ目の retry op 出現時に再評価）
- [x] service `withRetry`（R1）は削除され、queryLogs/searchLogs は retry option に移行する（R2〜R4 は触らない）
- [x] `getSqliteStatus` は SqliteResult → status shape の変換層を service 内に持ち、transport throw / response.error / decode throw の 3 分岐が今日と同一の initError 意味論を返す
- [x] `diagnosticsActions.ts` の DASHBOARD_SQLITE 直接送信（:203-207）が `getSqliteStatus()` 経由に置換される
- [x] `diagnosticsActions.ts` の TEST_OBSIDIAN / TEST_AI 直接送信（:87, :144）が `connectionTests.ts` の `testObsidianConnection` / `testAiConnection` 経由に置換される（進捗 choreography は触らない — ADR 2026-08-23 の管轄、行数トリガー未発火）
- [x] `dashboardGateway.ts` が `src/background/sqlite/` から `src/messaging/` へ移動する（offscreenGateway は残留）。barrel `src/background/sqliteGateway.ts` からは dashboardGateway の re-export が外れる
- [x] `decodeOpfsSpikeReport`: service の厳密検証版（:313-337）が `sqliteValidators.ts` へ移設され、service はそれを import。validators の緩い cast 版（:115-118、本番消費者ゼロ）は削除
- [x] grep ガードテスト新設: DASHBOARD_SQLITE sender は gateway のみ、TEST 系 sender は connectionTests の 2 helper のみ（`__tests__` を除く本番コード検査）
- [x] 文面・挙動が変更前と同一（リファクタリング）。dashboard 関連の既存テストが送信 mock のまま green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- gateway 契約テスト新設（dashboardGateway.test.ts 追加）: 送信 throw で 1 回 retry / `retriable:true` で 1 回 retry / decode 失敗は retry しない / 最終失敗で classified error — 計 4 ケース程度
- grep ガードテスト（sender 所在の固定）
### 統合テスト
- 既存 `dashboardSqliteService.test.ts`（257 行）と dashboardSqliteMock 系テストは**送信 shape 不変につき無修正で green**（gateway も最終的に同一 shape で `chrome.runtime.sendMessage` を叩くため）
- 既存 `dashboardGateway.test.ts`（426 行・fail-closed BDD）は無修正で green
### 例外ハンドリング
- token 取得失敗時: fail-closed throw が全 token-required op で uniform に効くことを既存 BDD が担保
- status の 3 失敗分岐が今日と同一の initError を返すこと

## 実装アプローチ
- **Outside-In**: diagnosticsActions の迂回解消（呼び出し側）→ service の 3 fn を gateway 経由に付け替え → retry option を gateway に追加し withRetry 削除 → sender ペア削除 → module 移動 → decode 移設 → grep ガード。各ステップで既存テスト green を維持

## 見積もり
0.5w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: gateway 契約は chrome を mock した単体で駆動可能（既存 dashboardGateway.test.ts と同型）。retry 条件のデータ（`retriable`）が見えるのは gateway だけなので、テストもそこに集中する
- 非機能要件: query/search/status の TOKEN_EXEMPT 所属により wire 上の挙動は不変。タイムアウト値（10s）・retry 間隔（1000ms）は不変
- ADR 整合: PBI 2026-09-03-03（confirm-token fail-closed）の意味論を全 sender に拡張するもので、再検討は不要。ADR 2026-08-23（aiTestProgressClient 抽出却下）は choreography に触れないことで遵守。ADR 2026-08-27-limit-policy / 2026-08-29-fetch-redirect-policy には抵触しない

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "sendDashboardMessage|getConfirmTokenForAction|withConfirmToken" src/dashboard/dashboardSqliteService.ts
rg -n "type: 'DASHBOARD_SQLITE'" src --glob '!**/__tests__/**'
rg -n "type: 'TEST_AI'|type: 'TEST_OBSIDIAN'" src --glob '!**/__tests__/**'
sed -n '159,195p' src/dashboard/dashboardSqliteService.ts   # withRetry (R1)
sed -n '380,439p' src/dashboard/dashboardSqliteService.ts   # getSqliteStatus
sed -n '115,118p' src/messaging/sqliteValidators.ts         # 緩い cast 版（消費者ゼロ）
```
2026-09-05 時点: service 564 行 / dashboardGateway 69 行 / diagnosticsActions 374 行。

### 実装手順
1. `DashboardGateway.callDashboard` に retry option を追加（意味論は R1 と完全一致: 2 attempt・1000ms・throw or retriable・decode 失敗は対象外）+ 契約テスト
2. `queryLogs` / `searchLogs` を `callDashboard(..., { retryAttempts: 2, retryDelayMs: 1000 })` に付け替え → service `withRetry` 削除
3. `getSqliteStatus` を callDashboard 経由に書き換え（SqliteResult → status 変換を service に）→ diagnosticsActions の status 直接送信を `getSqliteStatus()` に置換
4. diagnosticsActions の TEST 系 2 箇所を connectionTests helper 経由に置換
5. service の sender ペア 4 関数 + timeout 定数を削除
6. `dashboardGateway.ts` を `src/messaging/` へ移動（`git mv`）、barrel から re-export を外し service の import を直接化
7. 厳密版 `decodeOpfsSpikeReport` を validators に移設（`OpfsSpikeReportView` 型も移動）、緩い cast 版を削除
8. grep ガードテストを新設

### 落とし穴
- 既存テストの `chrome.runtime.sendMessage` mock は送信 shape（`{ type, protocolVersion, payload }`）を検査する。gateway 経由でも shape は不変だが、**呼び出し回数**が変わる箇所（retry で 2 回 sendMessage）に注意 — queryLogs/searchLogs の既存テストはもともと retry を想定しているので無修正で通るはず。通らなければ mock の呼び出し回数 assert を見直す（挙動は変えない）
- `dashboardGateway.ts` 移動時、`SqliteResult` 型の import 元（offscreenGateway.js）に注意。型の再 export 経路を切らないこと（service は `src/background/sqliteGateway.js` から `SqliteResult` を re-export している）
- getSqliteStatus の変換で `decodeStatusExtras` / `requiredBoolean` / `requiredString` / `pickDefined` の decode 系 import は service に残る（変換層の部品）
- TEST 系の置換で diagnosticsActions 側の `runId` 生成と progress 購読はそのまま残す（helper は送信のみ担当。`testAiConnection(runId)` は runId を引数で受ける既有 signature）
- grep ガードは `src/**` の本番コードのみ対象（`__tests__` と `testDir` を除外）。正規表現は複数行送信（diagnosticsActions のような object literal 改行）に対応させること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] dashboard / background / messaging 関連テスト全 green（type-check / lint / build 含む）
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS.md の SQLite 経路セクションに sender 統合を反映。必要なら ARCHITECTURE_MAP.md の該当行も）

## 実装メモ（2026-09-05・branch 0905c・続）
- 完了（impl `f8552fdc` + テスト配置修正 `66776e8e`、SDD サブエージェント実装）。タスクレビュー 1 修正サイクル（retry 契約テストの誤ネスト解消・テストファイルを src/messaging/__tests__/ へ移動・未使用エイリアス削除）を経て Approved。全 suite 11,578 tests green。追加で storage-extra の旧挙動テストを fix 08 の新契約に更新（`782f11d4`・ベースラインで既存の失敗と確認済み）。
