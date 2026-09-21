# PBI: 非アーカイブ SQLite op を wire table 行から導出する(段階適用)

## ユーザーストーリー
開発者として、非アーカイブ SQLite op も archive と同様に1行で追加したい、なぜなら toggle_star 1個のオプが16箇所・8ファイルに散り、copy-paste drift は同型の archive で実績済みだから

## 優先度
- 順位: 5 / 5
- RICEスコア: 1.2（Reach=3 / Impact=1 / Confidence=80% / Effort=2.0週）
- 根拠: 利益は最大級だが Effort が重い(~20 op の table 化)。RICE では最下位。**段階適用**(query/mutate サブセットから)で着地させ、残りは判断を ADR 化。着手は PBI 15 の後が差分読みやすさの観点で望ましい

## ビジネス価値
op 追加が「16箇所・8ファイルの同調編集」から「wire table 1行 + 型署名」に変わる(archive で実証済みの成果)。validate→delegate→project→decode の hop 形状を型で強制し、drift をコンパイル時に検出する

## BDD受け入れシナリオ

```gherkin
Scenario: 新 op 追加が1行になる
  Given query/mutate サブセットが wire table 化されている
  When 新しい op を1行追加する
  Then gateway・handler・service の各 hop が行から導出され、op が端から端まで動く

Scenario: 不一致はコンパイル時に検出される
  Given wire table と message 型・deps 署名
  When 行と型のどちらか片方だけを更新する
  Then compile-time sync assert がビルドを失敗させる

Scenario: 既存 op の挙動は不変
  Given table 化されたサブセット
  When 既存の全テストを実行する
  Then 期待値変更なしで green である
```

## 受け入れ基準
- [x] query/mutate サブセットが wire table 化され、当該 op の16箇所パターンが解体される
- [x] archive と同型の compile-time sync assert(table↔message union↔deps 署名)が置かれる
- [x] maintain ops・archive の扱い(既存 table 維持)を明記し、全量 table 化するかの判断を記録する
- [x] 既存テストの期待値変更なし

## 技術的考慮事項（追記 2026-09-21: 全量 table 化の判断）
- 全量 table 化は不採用。maintain 非archive（init/backup/restore/purge/status系）は hop 形状が異質（Uint8Array・boolean 特殊変換・degraded status）のため既存 path 維持。SQLITE_SEARCH は gateway 経路がなく（kind:search は SQLITE_QUERY に fold）handler を維持。readOnlyHandler/import の dashboard-hop 政策（cap・row-mapping・oversized guard）は層所有のまま残し、行側は subtype＋service codec＋sync assert で drift を検出する。以降の新 query/mutate op は wire table 1行＋（repo 形状が新規の場合のみ）runner 1行で追加可能。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボード操作(星付け・閲覧)が従来通り動く

### 統合テスト
- table 化 op の gateway→handler→service 経路で、行から導出された codec が往復一致する

### 単体テスト
- 行定義の validator・codec の境界(空 rows・null 許容・retriable 欠落)

## 実装アプローチ
- **Outside-In**: toggle_star を最初の移行対象に選び、16箇所→1行の変換を1 op で型として確立してから残りを展開
- 模板は `src/messaging/archiveWireTable.ts`(596行) — ARCHIVE_GATEWAY_DECODERS・ARCHIVE_DISPATCH・callArchive・runArchive の導出構造を踏襲する

## 見積もり
3ストーリーポイント（要チームでの見積もり・段階1: query/mutate）

## 技術的考慮事項
- 依存関係: PBI 15(SqliteClient alias)を先に潰すと差分が小さくなる(推奨、非必須)
- 非機能要件: 既存 op の wire 形状・エラーモード変更なし。archive 系は既存 wire table を維持
- ヘテロ対処: op ごとの差異が大きく全量 table 化が不経済な場合は、その判断を ADR として記録し再議論を防ぐ

## 実装者向け注記

### 現状の証拠(toggle_star の 16箇所・8ファイル)
- union arm: `src/messaging/sqliteMessages.ts:24` / 型配列: `:67`
- `MutateOp` member: `src/messaging/sqliteRpcClient.ts:121` / client overload: `:171`
- gateway overload + case: `src/background/sqlite/offscreenGateway.ts:125,139` / SqliteClient overload: `:233`
- handler fn + registry: `src/offscreen/sqliteMessageHandlers.ts:147-150,339`
- protocol request/response arm: `src/background/handlers/dashboardSqliteProtocol.ts:40,127`
- `CORE_CRUD_SUBTYPES`: `handlers/dashboardSqlite/coreCrudHandler.ts:14-16` / case: `:22-28`
- deps member + delegate: `handlers/dashboardSqlite/deps.ts:60,173`
- service fn + decode: `src/dashboard/dashboardSqliteService.ts:151-157`
- archive 側の完成形(比較用): `archiveWireTable.ts` + `offscreenGateway.ts:58-63` + `sqliteMessageHandlers.ts:286-288` + `dashboardSqliteService.ts:330-343` + `dashboardSqlite/archiveHandler.ts:30-44`
