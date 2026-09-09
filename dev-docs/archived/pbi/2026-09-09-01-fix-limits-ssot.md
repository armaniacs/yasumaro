# PBI 01: 上限定数の SSOT 化 — limits テーブル新設で 4 authorities の drift を解消

## ユーザーストーリー

ダッシュボードから SQLite を操作する利用者として、どの経路（validator / handler / dashboard 事前チェック）を通っても同じ上限が適用されてほしい。なぜなら現状は `MAX_IMPORT_ROWS` が 1000（validator）/ 5000（handler）/ 100,000（dashboard 事前チェック）に分裂し、validator を迂回する直接呼び出しが 5 倍の行を通す fail-open の形になっているから。

## 優先度

- 順位: 01 / 6
- RICE スコア: 24.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.2 人週）
- 根拠: 検証境界の drift が実在（import 3 値・append 2 値）し、diff が小さく機械的なため Confidence 高。意図的分歧（audit 1000 vs 100000）は名前付き変種として保持するだけ。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: なし。ただし 02（update whitelist）が deps.ts / validators.ts を共有するため 01 を先に着地させる。

## BDD 受け入れシナリオ

```gherkin
Scenario: import 行数上限が全経路で同一
  Given limits.ts に MAX_IMPORT_ROWS が 1 個だけ定義されている
  When  dashboard 事前チェック / validators / maintenanceBatchHandler のそれぞれで
        上限を参照する
  Then  3 経路とも同一の定数値を使用し、handler 側の 5000 と validator 側の 1000 という
        値の不一致は存在しない

Scenario: 意図的な分歧は名前付き変種として残る
  Given audit の上限が OPFS worker は 1000、IdbVfsBackend は 100000 という意図的分歧を持つ
  When  limits.ts を確認する
  Then  両者は名前付き定数（例: AUDIT_CAP_OPFS / AUDIT_CAP_IDB）として定義され、
        分歧の理由がコメントで記録されている

Scenario: 上限超過リクエストの挙動は現行と同一
  Given MAX_APPEND_IDS を超える ids 配列を送信する
  When  update/append 系サブタイプが処理される
  Then  拒否される（現行のエラー形を維持）。緩和・厳格化の振る舞い変更はしない
```

## 受け入れ基準

- [x] `src/messaging/limits.ts`（または合意位置）に上限テーブルを新設: `MAX_IMPORT_ROWS` / `MAX_APPEND_IDS` / `QUERY_CAPS`（参照移管）/ `ARCHIVE_CHUNK_BYTES` / `RESTORE_BYTES` 等
- [x] `deps.ts:9-13` の `MAX_APPEND_IDS` / `MAX_IMPORT_ROWS`、`validators.ts:42-59` の `VALIDATOR_LIMITS` 内の重複値、`importLogsService.ts:31` の `100_000`、`maintenanceBatchHandler.ts:33-34` の再定義を import に寄せる
- [x] `readOnlyHandler.ts` の clampLimit リテラル（1000/100000/1000）が `QUERY_CAPS` 参照になる
- [x] 意図的分歧（audit OPFS 1000 vs IDB 100000）は名前付き定数 + 理由コメントとして保持
- [x] 振る舞い変更なし（上限値の緩和・厳格化をしない。値の統一が必要な場合は drift のどちらが正かを実装メモに記録してから統一）
- [x] drift 検出テスト 1 本（同一概念の複数定義が再発したら fail する形、または limits.ts 参照の整合テスト）

## テスト戦略

- 単体: limits テーブルの整合テスト（validator の制限値と handler の制限値が同一ソースを参照すること）
- 回帰: 既存の上限超過テスト（validators-limits / dashboardSqliteHandlers-extra 等）が無修正で green であること（挙動不変の証明）

## 実装アプローチ

1. `limits.ts` を新設（中立位置。`messaging/` なら messaging/validators・offscreen 双方から import 可能）
2. 定数を移管し、各 authority を import に寄せる（値は現行の実効値 = 最厳値を保持）
3. 意図的分歧に名前を付ける
4. drift 検出テスト追加

## 見積もり

0.2 人週。難易度: 🟢低。副作用: 🟢なし（挙動不変）。種別: 🔧非機能追加（fix）。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] type-check / lint / 対象テスト green
- [x] コードレビュー完了
- [x] `2026-09-05-00-backlog-future.md` の該当行（あれば）と `00-INDEX.md` を更新

## 実装メモ（2026-09-09・0909a）

### 実効値の特定と統一判断（振る舞い不変の根拠）
- `MessageRouter.dispatch`（`src/background/handlers/MessageRouter.ts:247-256`）が validator → handler の順で実行することを確認。よって検証経路上の実効値は厳しい方。
- `MAX_IMPORT_ROWS`: validator 1000 が handler 5000 より先に発火するため実効値 1000。handler 側を 1000 に統一。本番経路（検証→handler）では 1001 行以上のリクエストは従来どおり validator のエラーメッセージで拒否されるため、呼び出し側の観測挙動は不変。handler 直呼び（テストハーネス等）でのみ 1001〜5000 行の拒否が厳格化されるが、当該経路は本番到達不能（全 `DASHBOARD_SQLITE` は `MessageRouter` 経由）。
- `MAX_APPEND_IDS`: validator 1000 に対し handler 100 が実効値だったため 100 に統一。101 件以上の append は従来 handler で拒否されていたものが validator で拒否される形に変わる（エラー文言の出所のみ変更、`{success:false}` 形状は同一）。
- 上記に伴い `dashboardSqliteHandlers-append.test.ts` の import 上限テスト（5000 行固定）を `MAX_IMPORT_ROWS` 参照に更新。append 側（100 件）の既存アサーションは無修正で green。

### 配置判断
- `limits.ts` は `src/messaging/limits.ts` に新設（依存なしの純粋定数）。validators・background handlers・dashboard のいずれからも import 可能で、import グラフ上の循環なし（offscreen →
  messaging 方向の既存 edge と逆向きの edge は作っていない）。
- `QUERY_CAPS` は `queryPlan.ts` から移動せず、`readOnlyHandler.ts` が既存 import を拡張して参照（query→`plain`、search→`fts`、audit→`plain`。いずれも値同一）。fallback 既定値（100/50/1000）は cap ではなく既定値のため据え置き。
- audit の意図的分歧は `AUDIT_CAP_OPFS`（1000）/`AUDIT_CAP_IDB`（100000）として limits.ts に名前付きで文書化。実体（`opfsWorker/auditHandlers.ts:30`、`IdbVfsBackend.ts:390`）は対象外のため非接触。
- `importLogsService.ts` の `100_000` はファイル全体の事前チェック（per-message 上限とは別概念）のため値を維持し、`IMPORT_TOTAL_ROW_CAP` に改名＋WHY コメント化。旧名の外部 import は存在しないことを確認済み。
- `maintenanceBatchHandler.ts` の restore base64 上限リテラル（150MB）も値同一のまま `MAX_RESTORE_BASE64_BYTES` として limits.ts に移管（validator の 10MB 上限とは層が異なる旨をコメント化）。

### 変更ファイル
- 新規: `src/messaging/limits.ts`、`src/messaging/__tests__/limits.test.ts`
- 編集: `src/messaging/validators.ts`（`VALIDATOR_LIMITS` が limits 参照。export 形状維持のため既存テスト無修正）、`src/background/handlers/dashboardSqlite/deps.ts`（3 定数を re-export 化）、`src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts`（import のみ）、`src/background/handlers/dashboardSqlite/readOnlyHandler.ts`（`QUERY_CAPS` 参照化）、`src/dashboard/importLogsService.ts`（改名）、`src/background/__tests__/dashboardSqliteHandlers-append.test.ts`（import 上限テストを定数参照化）

### 検証結果
- `npm run type-check`: clean
- `npx vitest run src/messaging src/background/__tests__/dashboardSqliteHandlers-append.test.ts src/background/handlers/__tests__/MessageRouter.validators.test.ts src/dashboard/__tests__/importLogsService.test.ts src/dashboard/__tests__/importLogsService-validateRow.test.ts src/dashboard/__tests__/logExportSignature.test.ts src/dashboard/__tests__/exportImport-r2.test.ts`: 17 files / 285 tests green
- `npm run lint`: 自分のファイルは 0 errors。全 repo では `src/utils/aiSummaryCleaner/rules.ts` に 2 errors（並行エージェントの作業中ファイル、対象外のため非接触）
