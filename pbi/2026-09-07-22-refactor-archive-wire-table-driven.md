# PBI: Archive wire 層の表駆動統合 — 7-hop 1:1 pass-through の畳み込みと重複ブロック削除

## ユーザーストーリー
SQLite / アーカイブ wire 層を保守する開発者として、1 つの archive subtype が 7 層（service → SW handler → deps → offscreenGateway → offscreen MessageHandlers → dbMaintenance → OpfsWorkerBackend → opfsWorker dispatch）を通り、各層が 14-way の 1:1 写像になっているのを、`MaintainOp` を正とする単一テーブル（op → wire type → decode → noRetry flag）に畳みたい、なぜなら現状は新 subtype 追加時に 7 ファイル編集が必須で、既に TypeScript が黙って通すコピペ重複ブロック 3 箇所（重複 overload、重複 interface、重複 payload 型の到達不能第 2 ブロック）が実在し、次の subtype 追加で同期漏れが確定するから

## 優先度
- 順位: 03 / 6（本ラウンド）
- RICEスコア: **12.0**（Reach=3 / Impact=3 / Confidence=80% / Effort=0.6人週）
- 根拠: archive 領域は直近 200 コミットで最大のチャーンゾーン（dashboardSqlite/deps 8 回、sqliteMessageHandlers 7 回、OpfsWorkerBackend 7 回等）。重複ブロックは検証済み: `offscreenGateway.ts` は overload 6 件（archiveOpen〜archiveStatus）と switch case 6 件が到達不能な第 2 ブロックとして丸ごと重複、`StorageBackend.ts:19-24,116-121` は interface 宣言が完全重複、`opfsWorker/types.ts:150-173` は payload 5 件が完全重複。`OpfsWorkerBackend.ts:80-97` のコメント自体が「bare proxy result double-wrapped」事故の応急処置を告白している。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 7 層もあるのか | PBI 2026-09-06-02 で archive 機能を既存の層構造（service/handler/deps/gateway/handlers/maintenance/backend/worker）に沿って追加した。各層の役割は分かったが、14 subtype 分の写像が各層で手書きになった |
| なぜ重複ブロックが生えたのか | subtype 追加時のコピペで、同一宣言の 2 回書き（interface は宣言マージで黙認、overload は後勝ち、switch case は重複してもエラーにならない）が検出されなかった。lint も 0 errors で通る |
| なぜ wrap/unwrap バグが起きるのか | 層をまたぐたびに result を整形する手書きコードが 14 × 層数あり、`OpfsWorkerBackend` のコメントが「bare proxy result double-wrapped」事故を記録している。pass-through 層が厚いほど事故る |
| なぜテーブル化で解けるのか | `MaintainOp`（sqliteRpcClient.ts）が既に domain 層の union として存在し、各層の差は「wire 型名 + decode 関数 + noRetry flag」だけ。宣言的テーブル 1 つから各層の写像を生成すれば、新 subtype は 1-2 ファイル編集で済む |
| deletion test | 中間層 1 層を削除しても隣の層に同一 14-way テーブルが残る = pass-through の証明。テーブル化すれば削除で複雑さが消える |

## BDD受け入れシナリオ

### Scenario: 重複ブロックが消えている
  Given 撤去後の `src/background/sqlite/offscreenGateway.ts` / `src/offscreen/StorageBackend.ts` / `src/offscreen/opfsWorker/types.ts`
  When `archiveOpen|archiveQuery|archiveUpdate|archiveSave|archiveClose|archiveStatus` の宣言を grep する
  Then 各シンボルは 1 回だけ宣言され、到達不能な第 2 ブロック（重複 overload・重複 interface・重複 payload）が存在しない

### Scenario: 新しい archive subtype が 1-2 ファイルで追加できる
  Given テーブル駆動の wire 層
  When 新しい maintain op（例: `archiveRename`）を追加する場合の手順を追う
  Then 編集は `MaintainOp` union と worker ハンドラ実装（＋必要なら service の公開関数）のみで、gateway / dbMaintenance / Backend / deps の手書き写像追記が不要であることをコードリーディングで確認できる

### Scenario: noRetry 指定が保持される
  Given noRetry 必須の bulk 操作（archiveCreate / archiveRestore / archiveDeleteByStaging / archiveOpen / archiveSave）
  When 各 op を実行する
  Then リトライ挙動が変更前と同一（テーブルの noRetry 列で宣言され、blind retry による二重実行が起きない）

### Scenario: 振る舞いが変更前と同一
  Given 既存の archive 関連テスト群（dashboardSqliteHandlers、sqliteMessageHandlers-coverage、offscreenGateway、OpfsWorkerBackend 系）
  When 全テストを実行する
  Then 成功応答・エラー文言が不変で green

## 受け入れ基準
- [x] `offscreenGateway.ts` の重複 overload 6 件と重複 switch case 6 件（到達不能第 2 ブロック）が削除されている
- [x] `StorageBackend.ts` の重複 interface 宣言（ArchiveOpenResult 等 6 件 ×2）と `Mutable` 内重複メソッド宣言が削除されている
- [x] `opfsWorker/types.ts` の重複 payload interface（ArchiveOpen/Query/Update/Save/Close ×2）が削除されている
- [x] `dbMaintenance.ts` の 14 転送関数と `OpfsWorkerBackend.ts` の 14 転送メソッドが、テーブル駆動またはジェネリック 1 関数に畳まれている（または層ごと削除。どちらを採ったか PBI 実装メモに記録）
- [x] `offscreenGateway.ts` の maintain switch がテーブル駆動になり、noRetry 5 件（create / restore / deleteByStaging / open / save）が宣言的に保持されている
- [x] `sqliteMessageHandlers.ts` の 14 ハンドラ unwrap 整形がテーブル or 共通ヘルパーに集約されている
- [x] `dashboardSqliteService.ts` の archive 系 14 関数（:338-492）が、decode の共通化により薄くなっている（公開関数名は維持。呼び出し側の破壊的変更はしない）
- [x] deps.ts の `ArchiveDeps` 14 メソッドは維持（SW handler と service の契約面は変えない。畳み込みは handler 内部実装で行う）
- [x] `OpfsWorkerBackend.ts:80-97` の応急処置コメントが不要になる、または正しい整形が型で保証されている
- [x] 新規追加テーブルの単体テスト（op → wire type → decode の対応表が `MaintainOp` union と同期していること。exhaustive チェック含む）が green
- [x] 既存 archive 関連テスト全体が green（エラーメッセージ・応答形状不変）
- [x] `npm run type-check` / `npm run lint` / `npm test` / `npm run build` が green

## テスト戦略
- 単体: テーブル（op→wire 型名・decode・noRetry）と `MaintainOp` union の同期を exhaustive に検証する新規テスト
- 単体: noRetry 5 op が retry しないことの既存テスト維持
- 回帰: dashboardSqliteHandlers 系 / sqliteMessageHandlers-coverage / offscreenGateway / OpfsWorkerBackend / dashboardSqliteService 系の既存テスト全 green
- 非対象: worker 内 SQL 実装（archiveCreateHandlers 等の本体）、InMemoryTransport の archive 未対応の扱い、PBI 32（wa-sqlite sunset）

## 実装アプローチ
1. `MaintainOp` の archive 14 op を列挙し、テーブル型（`{ wireType, decode(result), noRetry? }`）を定義（配置は `src/background/sqlite/` か `src/messaging/` の中立位置）
2. `offscreenGateway.ts`: 重複ブロック削除 → switch をテーブル駆動に。`callInternal` の型パラメータをテーブル列から導出
3. `StorageBackend.ts` / `opfsWorker/types.ts`: 重複宣言削除
4. `dbMaintenance.ts` / `OpfsWorkerBackend.ts`: 転送関数をジェネリック化（`forwardArchiveOp(op)`）または削除（Backend が直接 handlers を見る形にできるか検証）
5. `sqliteMessageHandlers.ts`: 14 ハンドラの unwrap 整形を共通ヘルパーに。registry（:472-516）はテーブルから派生
6. `dashboardSqliteService.ts` / `archiveHandler.ts`: decode 共通化。`deps` のメソッド署名は維持
7. exhaustive 同期テスト追加 → 全検証

## 見積もり
3 pt（0.6 人週相当）

## 未解決事項
1. テーブルの置き場所（background/sqlite vs messaging）→ offscreenGateway と MessageHandlers の両方が参照するため、依存方向（background → offscreen 禁止、messaging は中立）を守れる位置に実装時に決定
2. `dbMaintenance.ts` の削除可否 — Layer 的に offscreen 内部なので削除（Backend 直結）が筋だが、opfsWorker dispatch との契約を確認してから決める。実装メモに記録
3. `dashboardSqliteService.ts` の archive 14 関数を公開 API として維持するか、薄いジェネリック 1 関数に寄せるか → 呼び出し側（archivePanel 等）の破壊を避けるため公開関数維持を基本とし、内部を共通化

## Definition of Done
- [x] 全 BDD シナリオが自動テスト（または確認手順）として実現されパスする
- [x] 重複ブロック 3 箇所（gateway overload / StorageBackend / types payload）が削除されている（grep で確認）
- [x] 新 subtype 追加時の編集点が 1-2 ファイルに減っていることを実装メモが示している
- [x] noRetry 5 op の挙動が不変（テスト green）
- [ ] コードレビュー完了
- [x] `npm run type-check` / `npm run lint` / `npm test` / `npm run build` green

## 実装メモ（2026-09-07、ブランチ refactor/pbi22-archive-wire）

### 最終テーブル形状

`src/messaging/archiveWireTable.ts`（新規、中立配置）に `ARCHIVE_WIRE_TABLE`
14 行: `{ op, messageType, workerType, noRetry? }`。`ArchiveOpType` をキーに
各層が decode／args を持つ派生テーブルを保持する（gateway の
`ARCHIVE_GATEWAY_DECODERS`、handlers の `ARCHIVE_DISPATCH`）。
同期は 2 層で保証する: テーブルファイル内のコンパイル時両方向 asserts
（`MaintainOp` の `archive*` union ⇔ テーブル op、`SqliteMessage` の
`SQLITE_ARCHIVE_*` ⇔ テーブル messageType）と、
`src/messaging/__tests__/archiveWireTable.test.ts` のランタイム asserts
（`SQLITE_MESSAGE_TYPES`／`WORKER_MESSAGE_TYPES` 定数との両方向一致、
noRetry 集合の一致）。

### 削除行数

`git diff --stat`: 8 ファイル変更で 449 deletions / 308 insertions（純減 141 行）。
新規 3 ファイル（テーブル本体＋テスト 2 件）。層別の畳み込みは以下。

- gateway: overload 6 件・switch case 6 件を削除し、archive 14 case を
  テーブル参照＋`ARCHIVE_GATEWAY_DECODERS` 12 行相当に集約（非 archive
  7 case は switch のまま）。ペイロードは op から discriminator を除いた
  spread（従来の明示組み立てと同一フィールド）。
- `OpfsWorkerBackend`: 14 メソッドを `proxyArchive<W, D>` 1 ジェネリック経由の
  1 行委譲に畳み、二重包み応急コメント 2 件を削除。`{ success: true,
  ...project(raw) }` の単一構築点が型で二重包みを不可にしている。
- handlers: 14 ハンドラ（約 170 行）を `ARCHIVE_DISPATCH` 設定表＋
  `handleArchive` 共通実行（約 110 行）に集約。registry の 14 行は
  1 行バインドとして残し、`satisfies Record<SqliteMessageType, ...>` の
  網羅性検査を維持。
- service: 公開 14 関数の名前・シグネチャ維持、`callArchive`＋
  `requiredArchiveField` に寄せて薄化。
- 副産物: `dashboardSqliteProtocol.ts` の `archive_preview` リクエスト型に
  欠落していた `cutoffDate: string` を追加（validator・handler・service が
  すべて要求しているのに型だけ欠落していた不整合。振る舞い不変）。

### 未解決事項の結論

1. テーブルの置き場所 → `src/messaging/archiveWireTable.ts` に決定。
   background と offscreen が既に messaging に依存し、`background →
   offscreen` 禁止を侵さない唯一の中立位置。製品コードは offscreen を
   import せず、worker 型文字列はリテラル保持＋テストで同期検証。
2. `dbMaintenance.ts` の削除可否 → 転送 14 関数は削除、モジュール自体は
   存続。handlers が `engine.getBackend()` に直結する（Backend 直結が筋との
   方針通り）。非 archive 関数（purge／backup／restore／health）は他
   ハンドラが使うため残す。削除した archive 型エイリアス 14 件の外部利用は
   なく（grep 確認）、`dbMaintenance.test.ts` も非 archive のみを検証して
   いるため破壊なし。
3. service 公開関数 → 14 件すべて維持。内部のみ `callArchive` シームに
   共通化し、decode の応答フィールドアクセスは静的型検査を維持
   （`DashboardSqliteResponseFor<S>` 経由）。呼び出し側の変更はゼロ。

### 新 subtype 追加手順（1-2 ファイル）

例 `archiveRename` を足す場合: (1) `MaintainOp` union に追加＋
`ARCHIVE_WIRE_TABLE` に 1 行追加（置き忘れはコンパイル時 assert と
ランタイムテストが検出）＋ worker ハンドラ実装、(2) 必要なら service 公開
関数 1 件。gateway／handlers／Backend／deps の手書き写像追記は不要。
`ARCHIVE_GATEWAY_DECODERS` と `ARCHIVE_DISPATCH` に行追加が必要だが、
いずれも `Record<ArchiveOpType, ...>` 型のため置き忘れはコンパイルエラーに
なる（handlers 側の registry も `satisfies` で同様）。

### noRetry に関する注記

PBI 記載の必須 5 op（create／restore／deleteByStaging／open／save）に加え、
現行コードで `archiveClose` にも `noRetry: true` が付いていた。振る舞い不変
を優先し 6 件すべてテーブルに継承した（`ARCHIVE_NO_RETRY_OPS` で宣言）。
close の noRetry を外す変更は別 PBI の判断とする。

### 検証結果（2026-09-07、worktree 内）

- `npm run type-check`: green（修正過程で 5 件検出→解消: テーブル
  `noRetry` アクセス 2 件、gateway switch 網羅性 1 件、protocol
  `cutoffDate` 欠落 1 件、Backend ジェネリック制約 1 件）
- `npm run lint`: error 0（warning 124 件はベースラインと同一の既存 logger 警告）
- `npx vitest run src/messaging src/background src/offscreen src/dashboard`:
  392 files / 5934 passed・10 skipped
- `npm test`（全スイート）: 709 files passed・1 skipped / 11929 passed・21 skipped
- `npm run build`: green、`dist/chromium-mv3/assets/opfsWorker-*.js` 残存確認
