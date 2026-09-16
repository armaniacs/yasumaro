# PBI: バックオフ計算と HTTP ステータス→ユーザー文言の SSOT 化（refactor）

優先度: 順位 9 / 10（RICE: 1.6 = Reach 4 / Impact 1 / Confidence 0.8 / Effort 2 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、リトライ遅延の計算式と HTTP ステータスからユーザー向け文言への対応表を一箇所に集約してほしい、なぜなら同じ知識（指数バックオフの式、401/403/404/429 ごとの文言）が複数ファイルに分散して書かれており、値を変えたいときに場所ごとの揺れを見落とす危険があるから。

## 背景（現状と課題）

バックオフ遅延の計算が3系統で別々に書かれている（いずれも実在を確認済み）：

1. `src/utils/fetch.ts` の `fetchWithRetry()`（ファイル後半のリトライ付きフェッチ関数） — `initialDelayMs * backoffMultiplier^attempt` を `maxDelayMs` で cap する指数バックオフ。デフォルトは 1000ms 起点・倍率 2。
2. `src/messaging/messageTransport.ts` の `MessageTransport.send()`（ファイル後半の送信メソッド） — `100 * 2^attempt` を 1000ms で cap する指数バックオフを inline 実装。`RETRYABLE_ERROR_PATTERNS` による再試行可否の判定付き。
3. `src/messaging/dashboardGateway.ts` の `DashboardGateway.callDashboard()`（ファイル後半のゲートウェイクラス） — `attempts` / `delayMs`（デフォルト 1000ms 固定）の独自リトリーループ。指数計算はしない。

このほか `src/dashboard/utils/retry.ts` の `retryWithExponentialBackoff()` という汎用ヘルパーも存在するが、こちらは jitter 付きで待機の責務まで持つ別物である。fetch（HTTP トランスポート）・message passing・dashboard RPC という意味的に異なるドメインの再試行方針そのものを統合する必要はないが、遅延計算式だけは同一の知識であり、値と文言が場所ごとに揺れていることが課題である。

HTTP ステータスからユーザー向け文言への対応表も3箇所に分散している（いずれも実在を確認済み）：

1. `src/background/ai/providers/ProviderStrategy.ts` の `mapConnectionError()` / `parseAndMapFetchError()`（ファイル中盤の protected メソッド群） — 401/403・404・429・5xx 系を個別に文言化。最も粒度が細かい。
2. `src/background/obsidianClient.ts` の `testConnection()`（ファイル末尾の接続テストメソッド） — 401/403 と 404 を個別判定し、それ以外は汎用文言に落とす。429 の個別判定はない。
3. `src/background/syncTargets/gistSyncTarget.ts` の `testConnection()`（ファイル前半の接続テストメソッド） — 401 のみ個別判定し、それ以外は汎用文言に落とす。

対応方針は次の2点である：

- (1) `src/utils/backoff.ts` に `backoffDelayMs(attempt, opts)` を新設する（`baseMs` / `multiplier` / `maxMs` をオプション化）。`messageTransport` と `dashboardGateway`（固定遅延は multiplier 1 で表現）および `fetchWithRetry` の遅延計算をここへ委譲する。
- (2) `describeHttpFailure(status, domainLabel)` の1テーブルを新設し、上記 status→文言の分散箇所を委譲する。

制約として、遅延値と文言は現行と完全一致（byte-identical）とする。変える場合は parity テストで pin してから意図的に変えるが、本 PBI では変えない。`RETRYABLE_ERROR_PATTERNS` のような domain-specific な再試行可否の判定は各ドメインに残してよい。

対象外: PersistentRetryQueue（永続リトライキュー）と pipeline の StepExecutor が持つ ErrorStrategy はドメイン固有の挙動であり、本 PBI の対象外とする。

## BDD受け入れシナリオ

```gherkin
Scenario: 3系統のリトライ遅延が委譲後も現行値と同一（parity）
  Given fetchWithRetry・MessageTransport.send・DashboardGateway.callDashboard の3系統のリトライ実装
  When 遅延計算を backoffDelayMs に委譲する
  Then 各 attempt の遅延値が委譲前と同一である
    # 例: messageTransport 系は baseMs 100・multiplier 2・maxMs 1000、
    # fetchWithRetry 系は baseMs 1000・multiplier 2、dashboardGateway 系は multiplier 1（固定 1000ms）で再現する

Scenario: 境界 — 各 testConnection が返す代表ステータスの文言が委譲後も現行と同一
  Given ProviderStrategy 系・obsidianClient.testConnection・gistSyncTarget.testConnection が
    | 各自が現行で区別しているステータス（ProviderStrategy は 401/403/404/429、
    | obsidianClient は 401/403/404、gistSyncTarget は 401）を返す状態
  When status→文言の解決を describeHttpFailure に委譲する
  Then 表示文言が委譲前と同一である
```

## 受け入れ基準

- [x] `src/utils/backoff.ts` に `backoffDelayMs(attempt, opts)` が新設され、`baseMs` / `multiplier` / `maxMs` をオプションで指定できる
- [x] `fetchWithRetry`・`MessageTransport.send`・`DashboardGateway.callDashboard` の遅延計算が `backoffDelayMs` への委譲に置き換わっている
- [x] `describeHttpFailure(status, domainLabel)` の1テーブルが新設され、上記3箇所の status→文言解決が委譲に置き換わっている
- [x] 遅延値と表示文言が現行と完全一致（byte-identical）であり、parity テストで pin されている
- [x] `RETRYABLE_ERROR_PATTERNS` 等の domain-specific な再試行判定は各ドメインに残っている
- [x] PersistentRetryQueue と pipeline StepExecutor の ErrorStrategy に手を入れていない
- [x] `npm run type-check` / `npm test` が green

## テスト戦略

- parity テスト（新規）: 委譲前の遅延値・文言を期待値として固定する。backoff 側は各系統の代表的な attempt 列（例: 0〜4）の遅延値を、文言側は各 testConnection が現行で区別しているステータスごとの表示文言を pin する。以降の意図的な値変更はこのテストを更新することで検出可能にする。
- 既存テストの維持: `src/utils/__tests__/` の fetch 系テスト（`fetch.test.ts` 等）と `src/messaging/__tests__/` の `messageTransport` 系・`dashboardGateway` 系テストが green のままであることを確認する。既存の ProviderStrategy 系・obsidianClient 系・gistSyncTarget 系の接続テスト（401/404/429 系の文言アサーション）も壊さない。
- `dashboard/utils/retry.ts` の jitter 付きヘルパーは本 PBI の委譲対象外のため、その既存の振る舞いテストがあれば維持のみとする。

## 見積もり

2 pt（小規模リファクタ。5ファイルの委譲＋新規2関数の parity テスト。文言・遅延値の変更は含まない）。

## 実装ガイド

- 着手時点での確認ポイント: 上記5ファイルの該当関数、`dashboard/utils/retry.ts`、`src/utils/__tests__/` と `src/messaging/__tests__/` の既存テスト。
- `dashboardGateway` の固定遅延は `backoffDelayMs` に multiplier 1 で表現する（式は共通化し、値は現行の 1000ms 固定を再現する）。
- 文言テーブル側の注意: 3箇所で区別するステータスの集合が異なる（ProviderStrategy が最も細かく、gistSyncTarget は 401 のみ）。`describeHttpFailure` は全ステータスの対応を持ち、呼び出し側は現行どおり各自の分岐結果と一致する呼び出し方にすること。文言の揃え直し（例: gist 側に 404 判定を足す等）は本 PBI では行わない。
- 遅延値・文言のどちらかを将来変えたい場合は、先に parity テストで現行値を pin した上で、別変更として意図的に変えること。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
