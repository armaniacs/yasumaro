# PBI: SQLite Domain Repository への集約 — 20の薄い proxy を domain interface に崩壊

## ユーザーストーリー
開発者として、`src/dashboard/dashboardSqliteService.ts`（598行）の20の関数（`queryLogs`, `searchLogs`, `toggleStar`, `deleteLog`, `getLogCount` 等）が全て `build payload → sendDashboardMessage → decode → ServiceResult` の同一パターンを繰り返している状態を解消したい。なぜなら、新しいSQLite操作を追加するたびに15〜30行のボイラープレートを書き、validator とテストを20回分用意する必要があり、transport 固有の関心事（`tokenExempt`, `DASHBOARD_SQLITE_TIMEOUT`, `categorizeError`, `query`/`search` のリトライ）が各関数に散らばるからだ。

## 優先度
- 順位: 03 / 5
- RICEスコア: (Reach=6 × Impact=2 × Confidence=0.8) / Effort=2 = 4.8
- 根拠: Reach 6（dashboard 利用者 + 履歴表示・タグ編集・クレンジング統計の全パス。chrome.storage 派と異なり全ユーザーではないが、履歴機能を使う中核ユーザーが影響）。Impact 2（新しいクエリ追加のコストが 1/10 になり、token/timeout の不具合が1箇所に集約される。データ消失リスクは低いが開発者生産性に大きく寄与）。Confidence 80%（前波で `callDashboard<TReq,TRes>()` が導入され generic path の有効性が実証済み。transport seam は `OffscreenTransport` として既に実在し、2つの adapter（ChromeOffscreen prod + InMemory test）が存在するため seam は hypothetical でない）。Effort 2人日（20 wrapper の domain メソッド化 + validator の内部化 + テスト移行）。01/02と並列着手可能。

## ビジネス価値
- 開発速度: 新しいSQLite操作の追加が `BrowsingLogRepository.addMethod()` の1メソッド追加で完結する（従来は payload 型 + validator + wrapper + テストの4ファイル編集）。
- 品質: `tokenExempt` / timeout / `categorizeError` の分類が1経路に集約され、dashboard と Service Worker 間でエラーメッセージの不整合がなくなる（PBI-05で分類は統一済みだが、呼び出し経路は依然20本）。
- 測定方法: 新しいダミー操作（例: `getTagCounts`）を追加する所要行数が 30行 → 5行に削減されることを計測。既存20操作の全 E2E テストがパスし続ける。

## BDD受け入れシナリオ

```gherkin
Scenario: domain メソッドが単一 seam で完結する
  Given dashboard が履歴クエリを要求する
  When BrowsingLogRepository.query({ domain: "example.com", limit: 20 }) が呼び出される
  Then 内部で confirmToken 付与・timeout・error分類が1経路で処理され、ServiceResult<{ rows, total }> が返却される
  And 呼び出し元は DashboardSqliteRequest / DashboardSqliteResponse の protocol 詳細を知る必要がない

Scenario: token不要な読み取りが正しく動作する
  Given tokenExempt に含まれる操作（query, search, get_count 等）が要求される
  When repository の該当メソッドが呼び出される
  Then confirmToken なしで送信され、レスポンスが正しくデコードされる

Scenario: リトライが必要な操作が正しく動作する
  Given queryLogs / searchLogs が SQLite 初期化タイミングで失敗する
  When repository.query() が呼び出される
  Then 内部で1回だけリトライ（1秒待機）し、2回目で成功すれば結果を返す。2回とも失敗すれば error を返す
  And 他の操作（toggleStar, deleteLog 等）はリトライしない（単一試行）

Scenario: デコードエラーがユーザーに伝達される
  Given レスポンスのフィールドが予想と異なる（例: rows が配列でない）
  When repository のメソッドが呼び出される
  Then { error: "..." } 形式でデコード失敗のメッセージが返され、例外は throw されない

Scenario: テストで InMemory adapter が使える
  Given テスト環境で InMemoryLogStore が注入された BrowsingLogRepository がある
  When repository.query() が呼び出される
  Then offscreen document や chrome.runtime.sendMessage を介さず、InMemory データから結果が返る
```

## 受け入れ基準
- [ ] `BrowsingLogRepository` クラス（または `src/dashboard/BrowsingLogRepository.ts`）が作成される。公開 interface は domain メソッドのみ: `query()`, `search()`, `getCount()`, `toggleStar()`, `deleteLog()`, `updateTags()` 等（現行20関数のうち domain 操作として意味のある6〜8メソッドに集約。残りは削除または内部 helper 化）。
- [ ] `callDashboard<TReq,TRes>()` が `BrowsingLogRepository` 内部の private メソッドになる。外部から直接 import されることがなくなる。
- [ ] `queryLogs` / `searchLogs` のリトライロジック（1秒待機して1回リトライ）が repository 内部にカプセル化される。他の操作はリトライしないことがテストで保証される。
- [ ] `tokenExempt` / `CURRENT_PROTOCOL_VERSION` / `DASHBOARD_SQLITE_TIMEOUT` / `categorizeError` の参照が repository 内部に集約される。呼び出し元がこれらを知る必要がなくなる。
- [ ] `src/messaging/sqliteValidators.ts` の validator（`requiredRows`, `isBrowsingLogEntry` 等）が repository 内部の decode 専用 helper になる。外部から個別に import されることがなくなる（必要なものは `src/messaging/sqliteValidators.ts` に残しつつ、repository が内部で使う）。
- [ ] 既存の20関数の呼び出し元（`src/dashboard/history*`, `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`, `src/dashboard/tagsPanel.ts` 等）が `BrowsingLogRepository` の domain メソッドに移行する。
- [ ] `ServiceResult<T>` 型と `isServiceError()` helper は維持する（既存呼び出し元の `error` ハンドリングを壊さない）。
- [ ] `OffscreenTransport` seam は維持する。`ChromeOffscreenTransport`（prod）と `InMemoryLogStore`（test）の2つの adapter が seam を正当化する（one adapter = hypothetical, two = real）。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- dashboard UI から一連の操作（query → toggleStar → delete → export）が `BrowsingLogRepository` 経由で正常に動作することを検証（既存の `dashboardSqliteService` E2E を流用）。

### 統合テスト
- `BrowsingLogRepository` × `ChromeOffscreenTransport`（fake `chrome.runtime.sendMessage`）で、token 付与・timeout・error分類が正しく行われることを検証。
- `BrowsingLogRepository` × `InMemoryLogStore` で、offscreen なしで全 domain 操作が動作することを検証。

### 単体テスト
- repository の各 domain メソッドの decode ロジック（正常系 + フィールド欠損 + 型不一致）を検証。`callDashboard` の timeout / `categorizeError` 分類は統合テストでカバー。

## 実装アプローチ
- **Outside-In**: まず `BrowsingLogRepository` の E2E テスト（全20操作の happy path）を RED にし、既存の `dashboardSqliteService` 実装を内部に移動して GREEN にする。
- **Red-Green-Refactor**: domain メソッドを1つずつ移行（query → search → toggleStar → delete → getCount の順）し、都度 GREEN を確認。移行済みの旧関数は re-export shim として残し、最後に削除。
- **リファクタリング**: GREEN になるたびに `sendDashboardMessage` の重複を除去し、`tokenExempt` の判定を1箇所に集約。

## 見積もり
2人日

## 技術的考慮事項
- 依存関係: `chrome.runtime.sendMessage`（ports & adapters — `OffscreenTransport` が既存の seam）。`chrome.storage.session`（confirmToken キャッシュ）。いずれも repository 内部で抽象化。
- テスタビリティ: `OffscreenTransport` interface は既に存在し、`InMemory` adapter でテスト可能。新たな seam は不要 — 既存の seam を deepening の対象とする。
- 非機能要件: `DASHBOARD_SQLITE_TIMEOUT = 10000` は変更しない。`query` / `search` の1回リトライ（1秒待機）も維持。
- ADR整合性: `ADR 2026-06-17 OPFS+FTS5 coexistence` と `ADR 2026-07-07 sqlite chrome.storage dual-write` に準拠。repository は dual-write の有無を呼び出し元から隠蔽するが、dual-write 自体は維持する（再議論しない）。
- 前波との関係: PBI 02（前波の dashboard-sqlite-proxy-collapse）で `callDashboard` が導入されたが、20の薄い wrapper は残存している。本PBIはその残余を解消する。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "callDashboard\|sendDashboardMessage\|dashboardSqliteService" src/dashboard/ --include="*.ts" | head -30
grep -rn "tokenExempt\|CURRENT_PROTOCOL_VERSION" src/ --include="*.ts" | head -20
grep -rn "OffscreenTransport\|ChromeOffscreenTransport" src/ --include="*.ts" | head -20
ls -1 src/background/handlers/dashboardSqlite/
```
- 既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。`callDashboard` は 2026-08-20 に導入済みだが、20の wrapper は未集約。

### 実装手順
1. `src/dashboard/BrowsingLogRepository.ts` を新規作成。`BrowsingLogRepository` クラスを定義し、内部に `callDashboard` と `sendDashboardMessage` を private メソッドとして移動。
2. 既存の20関数を domain メソッドに集約: `queryLogs` → `query()`, `searchLogs` → `search()`, `toggleStar` → `toggleStar()`, `deleteLog` → `delete()`, `getLogCount` → `getCount()` 等。重複する `getAll` / `getByDomain` は `query()` のオプションに統合。
3. `query` / `search` のリトライロジックを `query()` / `search()` 内部にカプセル化。他のメソッドは単一試行であることをテストで保証。
4. 呼び出し元（`sqliteHistoryPanel.ts`, `tagsPanel.ts`, `historyPendingPanel.ts` 等）を `BrowsingLogRepository` に移行。
5. `src/dashboard/dashboardSqliteService.ts` を `BrowsingLogRepository` への re-export shim に縮小し、最終的に削除。または `dashboardSqliteService.ts` 自体を `BrowsingLogRepository` にリネーム。
6. `ServiceResult<T>` と `isServiceError()` は `BrowsingLogRepository.ts` から再 export し、既存呼び出し元の import パスを維持（互換性）。

### 落とし穴
- `queryLogs` と `searchLogs` のリトライは `sendDashboardMessage` の transport エラーのみをリトライし、`response.success === false`（SQL エラー）はリトライしない。集約時にこの区別を失わないこと。
- `getConfirmToken()` は `chrome.storage.session` にキャッシュしつつ、失敗時は `confirm_token` subtype で再取得する — この2段階フォールバックを `BrowsingLogRepository` 内部に正しく移動すること。
- `dashboardSqliteService.ts` は `src/dashboard/__tests__/dashboardSqliteService.test.ts` で直接テストされている。移行時はテストも `BrowsingLogRepository.test.ts` に移行し、旧テストは削除すること（replace, don't layer）。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（query/search リトライ + tokenExempt + decode エラー + InMemory adapter）
- [ ] テストカバレッジが基準を満たす（既存20操作のカバレッジが維持される）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（20 wrapper の domain メソッド化、呼び出し元の移行、旧 shim の削除）
- [ ] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` の dashboard SQLite セクションを更新）
