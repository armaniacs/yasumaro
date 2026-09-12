# PBI 2026-09-12-17 — planAuditLog（audit paging 政策の planner 集約・silent-hang 実バグ解消）

- **種別**: 🔧非機能追加（fix + refactor・実バグ 2 件解消を伴う）
- **優先度**: 1 位 / RICE **21.3**（R10 × I2 × C80% / E0.75人日）
- **出典**: round 11 診断 候補 17・サブエージェント探索 + 直接検証

## 背景（なぜ）

audit 読み取りの paging 政策が 4 ファイルに散在し offset 政策がどこにも無い:

- `handleAuditLogQuery`（sqliteMessageHandlers.ts:87-96）に try/catch が無く、`Number(payload.offset)` が NaN を `LIMIT ? OFFSET ?` に束ねて throw が抜け **sendResponse が呼ばれずハング**（タイムアウト待ち・直接検証済み）
- cap が 3 層で分岐: dashboard 事前 clamp 10000（readOnlyHandler.ts:109）→ IDB 100000（QUERY_CAPS.fts）vs worker 1000 ハードコード（auditHandlers.ts:30・limits.ts の AUDIT_CAP_* は INTENTIONAL 文書化のみで未配線）
- Export Logs が {limit:100000} を要求しても OPFS は 1000 に切り詰め、`total` は全件のまま → TSV エクスポートが成功表示のまま**部分的なログを配布**

## スコープ

- `queryPlanner` に `planAuditLog(payload, backend)` seam 新設（clampLimit + clampOffset + cap 選択）
- 両 backend（IDB / worker）は clamp済み {limit, offset} を受領するだけに縮約
- `AUDIT_CAP_OPFS` / `AUDIT_CAP_IDB` を実配線（未使用なら削除）
- malformed payload（NaN / 負 offset）でも応答が返る handler テスト + parametric paging テスト

## 受け入れ基準（BDD）

### シナリオ 1: garbage offset でも応答が返る（ハッピーパス）
```gherkin
Given offset が "abc"（NaN になる文字列）
When SQLITE_AUDIT_LOG_QUERY を送る
then clampOffset で 0 に正規化され、正常応答が返る（ハングしない）
```

### シナリオ 2: cap が backend に関係なく 1 箇所で決まる（境界）
```gherkin
Given planAuditLog に巨大 limit と backend を渡す
Then backend ごとの cap が 1 箇所のテーブルで決まり、limit/offset が clamp される
```

## DoD

- [x] planAuditLog 新設・backend 縮約・AUDIT_CAP 配線
- [x] handler no-throw テスト + parametric paging テスト新設
- [x] offscreen audit 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟡軽微（OPFS の audit 取得件数が 1000 → テーブル定義値に変わる = 部分配布の解消）

## 実装メモ（2026-09-12）

- **主張の訂正（直接検証）**: 「NaN bind で sendResponse されず silent-hang」は誤り — offscreen dispatch の外側 try/catch（offscreen.ts:113-117）と worker 顶层 try/catch が catch し `success:false` を返す。実害は (a) garbage offset が「Unknown error」応答になる UX 劣化（offset 政策不在）、(b) cap 3 値分岐による TSV 部分配布（Export Logs が {limit:100000} でも OPFS 1000 / dashboard 事前 clamp 10000 で切り詰められ total は全件のまま成功表示）
- `planAuditLog(options, cap)` を queryPlanner に新設（clampLimit + clampOffset）。`IdbVfsBackend.queryAuditLog` は AUDIT_CAP_IDB、worker `handleAuditLogQuery` は AUDIT_CAP_OPFS を planAuditLog 経由で使用（未使用定数だった AUDIT_CAP_* を実配線）
- dashboard hop（readOnlyHandler）の事前 clamp を削除し pass-through に（backend が policy 所有）。`query`/`search` hop の pre-clamp は QUERY_CAPS 同値で planner と同期済みのため不変
- `exportLogsPanel` の audit TSV に `total > rows.length` ガードを追加（queryAllData と同一の部分配布防止・明示メッセージ）
- 検証: planAuditLog 5 tests 新設・audit 関連 8 ファイル 168 tests green・offscreen 全 76 ファイル 1093 tests green・type-check green・lint 0 errors
