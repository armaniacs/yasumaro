# PBI: InMemoryTransport の DELETE セマンティクス乖離を明示 — ソフトデリート近似と製品ハードデリートの意図的 drift をドキュメント化

## ユーザーストーリー
SQLite アクセスとテストダブルを保守する開発者として、`InMemoryTransport` の `SQLITE_DELETE` がソフトデリート（`is_deleted=1` を立てるだけ）で製品バックエンド（`FallbackStorageAdapter` / `OpfsWorkerBackend` / `sqliteMessageHandlers`）のハードデリート（行を物理削除）と乖離していることを、コードとドキュメントで明示したい、なぜなら PBI 2026-09-03-07 が query / FTS / ORDER BY の fidelity drift を潰したのに DELETE は取りこぼしており、`inMemoryTransport.ts` の JSDoc は「delete も production と同じ seam を round-trip する」と読めて製品同一挙動を誤認させ、主要な削除テスト（`inMemoryTransport.test.ts:66` "count reflects inserts and soft-deletes"）が COUNT の減少しか見ないため乖離が顕在化せず、削除済みレコードへの再 UPDATE / 削除→再 INSERT の重複検出 / `getRecords()` アサーション / VACUUM・freelist 検証で将来の回帰リスクが残るから

## 優先度
- 順位: 05 / 7
- RICEスコア: **4.4**（Reach=2.5 / Impact=0.5 / Confidence=70% / Effort=0.2人週）
- 根拠: PBI 2026-09-03-07（InMemoryTransport fidelity drift 解消）が query / FTS / ORDER BY の drift は潰したが DELETE は取りこぼした。同じ再発リスクが残る。乖離自体は許容だが「暗黙の乖離」は危険で、削除済みレコードへの再 UPDATE や削除→再 INSERT の重複検出テストが InMemory と製品で異なる結果を返し得る。Effort が小さく「アーカイブ機能を次に触るとき同時対応」が現実的。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ DELETE の drift が放置されている？ | PBI 2026-09-03-07 が (a) `buildExtraWhereSql` 再実装、(b) FTS `substringIncludes` short-circuit、(c) `ORDER BY (a[key] ?? 0)` の 3 点のみを扱い完了した。DELETE のソフト/ハード乖離は言及ゼロ → 本 PBI で明示的にドキュメント化する |
| なぜ乖離が顕在化しない？ | 主要な削除テスト `inMemoryTransport.test.ts:66` "count reflects inserts and soft-deletes" が COUNT の減少しか assert しない。テスト名自体が "soft-deletes" で製品と異なる語彙を正当化しているのが drift の証拠 → テスト名/コメントを乖離を認識した表現に変更する |
| なぜ統一しないのか？ | InMemory に SQL エンジンを積まない方針。helper を製品挙動（物理削除）に寄せる改修は「テストダブルを重くする」ため不可 → 乖離は仕様として固定し、検証は製品バックエンド（`opfsWorker.test.ts` / e2e）に委ねる |
| なぜ `is_deleted` カラムがあるのに製品はハードデリート？ | `is_deleted` は Gist 同期経由で他デバイスの論理削除を受信するケースとアーカイブ作成/復元の includeDeleted フィルタ専用（`archiveRestoreHandlers.ts` / `archivePurgeHandlers.ts`）。ローカル DELETE 経路では使われない → ドキュメントでこの区別を誤らないよう明記する |
| なぜ「明示」で足りるのか？ | 乖離が観点によっては顕在化する（下表参照）が、統一コストが大きく利用箇所が `inMemoryTransport.test.ts` のみ。ガードテストで乖離を仕様固定すれば「暗黙の乖離」が「明示された乖離」になり回帰検出の足場ができる |

## BDD受け入れシナリオ

### Scenario: InMemoryTransport を読んだ開発者が DELETE の乖離を認識できる
  Given `src/background/inMemoryTransport.ts` のクラス JSDoc を読む開発者がいる
  When JSDoc と `SQLITE_DELETE` case（現状 :104-109）を読む
  Then 「DELETE は `is_deleted=1` を立てる論理削除で近似し、製品バックエンド（`FallbackStorageAdapter` / `OpfsWorkerBackend` / `sqliteMessageHandlers`）は物理削除で、この乖離は意図的で統一しない方針」であることが明記されている

### Scenario: SQLITE_DELETE case にインラインコメントが存在する
  Given `select()`（現状 :185-190）には drift 防止コメントがあるが `SQLITE_DELETE` case には無い
  When `SQLITE_DELETE` case を読む
  Then ソフトデリート近似であること・製品はハードデリートであること・統一しない理由がインラインコメントで説明されている

### Scenario: 乖離一覧ドキュメントが存在し DELETE が記載される
  Given `dev-docs/` に「テストダブルの意図的乖離一覧」ドキュメントを新設する
  When そのドキュメントを開く
  Then `InMemoryTransport` の DELETE がソフト vs ハードの乖離として記載され、観点別の影響（再取得 / カウント / 再 UPDATE / 再 INSERT 重複検出 / `getRecords()` / VACUUM・freelist）と「製品側の検証先（`opfsWorker.test.ts` / e2e）」が示され、DELETE 以外の乖離も将来追加できる構造になっている

### Scenario: アーカイブ系の検証不能性が SQLITE_ARCHIVE_DELETE_BY_STAGING に明記される
  Given `SQLITE_ARCHIVE_DELETE_BY_STAGING`（現状 :148-149）は未実装で `success: false` を返す
  When その case を読む
  Then 「VACUUM / freelist（freelistBefore/After）は InMemory で検証不能なので製品バックエンド（`opfsWorker.test.ts` / e2e）でテストせよ」というコメントがある

### Scenario: 削除済みレコードが getRecords() に is_deleted=1 で残ることをガードテストが固定する
  Given `InMemoryTransport` に 1 件レコードを insert し `SQLITE_DELETE` を実行する
  When `getRecords()` を呼ぶ
  Then 返り値に当該レコードが `is_deleted: 1` で含まれる（製品なら行自体が消える）ことをアサートするテストが存在し、これが「意図的乖離」であるとテストコメントで説明されている

### Scenario: 既存の削除テストが乖離を認識した名称になる
  Given `inMemoryTransport.test.ts:66` のテスト名は "count reflects inserts and soft-deletes"
  When 更新後のテストファイルを読む
  Then テスト名またはテスト内コメントが「InMemory は soft-delete 近似、製品は hard-delete。ここで検証しているのは COUNT の一致のみ」という乖離認識を明示した表現になっている

## 受け入れ基準
- [x] `src/background/inMemoryTransport.ts` のクラス JSDoc（現状 :1-13）に DELETE のソフト/ハード乖離と「統一しない方針」が明記されている
- [x] `SQLITE_DELETE` case にインラインコメントが追加され、`select()` の drift 防止コメントと同水準の説明がある
- [x] `SQLITE_ARCHIVE_DELETE_BY_STAGING` case に VACUUM / freelist の検証不能性と製品側検証先が明記されている
- [x] `inMemoryTransport.test.ts:66` のテスト名/コメントが乖離を認識した表現に変更されている
- [x] `dev-docs/` に「テストダブルの意図的乖離一覧」ドキュメントが新設され、DELETE のソフト/ハード乖離が観点別影響表とともに記載されている
- [x] （任意）「削除済みレコードが `getRecords()` に `is_deleted=1` で残る」ことを明示アサートするガードテストが追加され green
- [x] `is_deleted` カラムの用途（Gist 同期経由の論理削除受信 / アーカイブの includeDeleted フィルタ専用、ローカル DELETE では未使用）がドキュメントで正しく区別されている
- [x] `npm run validate` green

## テスト戦略
- 単体（ガード / 任意）: `InMemoryTransport` に insert → `SQLITE_DELETE` → `getRecords()` で `is_deleted === 1` の行が残ることをアサート。テストコメントで「これは製品と乖離した仕様であり、意図的に固定している」ことを明記
- 単体（ガード / 任意）: `SQLITE_DELETE` 後の `SQLITE_QUERY` / `SQLITE_COUNT` が当該行を除外することをアサート（表面一致の維持を回帰検出）
- 単体（ガード / 任意）: 削除済みレコードへの `SQLITE_UPDATE` が InMemory では `find` に成功し `Object.assign` が通ることをアサート（製品なら no-op）。コメントで乖離を明示
- ドキュメント検証: 乖離一覧ドキュメントに DELETE 項目が存在し、観点別影響表と製品側検証先が含まれることを目視レビュー
- 回帰: 既存の `inMemoryTransport.test.ts` 全 tests が名称変更後も green
- 非対象: 製品バックエンドのハードデリート挙動そのものの新規テストは本 PBI のスコープ外（`opfsWorker.test.ts` / `testDir/e2e/dashboard-archive.spec.ts` 等の既存受け皿に委ねる）

## 実装アプローチ
1. `src/background/inMemoryTransport.ts` のクラス JSDoc を書き換え。「delete ... round-trip through the same seam production uses」の一節を、DELETE はソフトデリート近似で製品はハードデリート、統一しない方針である旨に改める（必須）
2. `SQLITE_DELETE` case（現状 :104-109）にインラインコメントを追加。`select()` の drift 防止コメントと同水準で、ソフト/ハードの差・統一しない理由・製品側の実体（`FallbackStorageAdapter.ts` の `hardDelete` / `crudHandlers.ts` の `handleHardDelete` / `sqliteMessageHandlers.ts` の `handleDelete`）を指す
3. `SQLITE_ARCHIVE_DELETE_BY_STAGING` case（現状 :148）にコメントを追加。VACUUM / freelist（`freelistBefore` / `freelistAfter`）は InMemory で検証不能、製品バックエンド（`opfsWorker.test.ts` / e2e）でテストせよ
4. `inMemoryTransport.test.ts:66` のテスト名を乖離認識型に変更（例: "count query excludes soft-deleted rows — note: InMemory approximates DELETE as soft-delete, production hard-deletes"）またはテスト内に同趣旨のコメントを追加
5. `dev-docs/` に「テストダブルの意図的乖離一覧」ドキュメントを新設。DELETE を最初のエントリとして、下記「ソフト vs ハードの差」表・`is_deleted` カラムの正しい用途・製品側検証先を記載。DELETE 以外の乖離（アーカイブ全面非対応、OPFS spike 非対応等）も将来追加できる節構成にする
6. （任意）ガードテストを `inMemoryTransport.test.ts` に追加し、乖離を仕様として固定
7. `npm run validate` を通す

## 見積もり
1 pt（0.2 人週相当。要チームでの見積もり）

## 実装者向け注記

### `InMemoryTransport` の DELETE 実装（`src/background/inMemoryTransport.ts`）
- `SQLITE_DELETE`（:104-109）: `const row = this.records.find(r => r.id === id); if (row) row.is_deleted = 1;` — ソフトデリート（論理削除）。配列からは消さず `is_deleted=1` を立てるだけ。`select()`（:185）が `r.is_deleted` で除外
- `SQLITE_ARCHIVE_DELETE_BY_STAGING`（:148-149）: 未実装（`{ success: false, error: 'Archive is not supported by InMemoryTransport' }`）
- `SQLITE_CLEAR_ALL`（:117-120）: `this.records = []` で物理削除（DELETE と非対称）
- 利用箇所は `src/background/__tests__/inMemoryTransport.test.ts` のみ

### 製品側 fallback の DELETE（すべてハードデリート）
- `src/offscreen/FallbackStorageAdapter.ts:31-35`: `delete(id)` → `this.fallback.hardDelete(id)`
- `src/offscreen/storageFallback.ts:336-339`: `hardDelete(id)` → `data.records = data.records.filter(r => r.id !== id)`。`is_deleted` は書かない
- `IdbVfsBackend` / `OpfsWorkerBackend` → `src/offscreen/opfsWorker/crudHandlers.ts:92-94` `handleHardDelete`: `DELETE FROM browsing_logs WHERE id = ?`
- メッセージ層 `sqliteMessageHandlers.ts:181-185` `handleDelete` → `sqliteHardDelete(id)`
- 製品側に「ソフトデリート」経路は存在しない
- スキーマ `src/offscreen/schema.ts:20` に `is_deleted INTEGER DEFAULT 0`、:48 に `idx_logs_active` があるが、`SQLITE_DELETE` では使われず、アーカイブ復元（`archiveRestoreHandlers.ts:129` `restoredDeleted`）とアーカイブ作成の includeDeleted フィルタ（`archivePurgeHandlers.ts:152`）専用（他デバイスで論理削除されたレコードを Gist 同期経由で受け取るケース用）

### ソフト vs ハードの差が問題になるテスト観点
| 観点 | InMemory | 製品 | 乖離 |
|---|---|---|---|
| 削除後の再取得 | 除外 | 除外 | 表面一致で気付きにくい |
| 件数カウント | is_deleted=0 の件数 | 行が消える | 一致 |
| 削除済みレコードへの再UPDATE | `find` 成功、`Object.assign` 通る | no-op | **乖離** |
| 削除→再INSERT で同一 URL | 旧行が残り重複検出テストが異なる | 旧行消滅 | **乖離** |
| `getRecords()` アサーション | 削除済み行が含まれる | — | **乖離** |
| VACUUM/freelist（`archiveDeleteByStaging` の freelistBefore/After） | 未実装 | 実際に DELETE + VACUUM | InMemory では検証不能 |

現状この乖離が顕在化していない理由: 主要な削除テスト（`inMemoryTransport.test.ts:66-75` "count reflects inserts and soft-deletes"）が COUNT の減少しか見ていない。テスト名自体が "soft-deletes" で製品と異なる語彙を正当化しているのが drift の証拠。

### 「明示が必要」= 記録すべき場所
- `inMemoryTransport.ts` クラス JSDoc（:1-13、現状 "delete ... round-trip through the same seam production uses" と製品同一挙動に読める）に「DELETE は論理削除で近似、製品は物理削除、統一しない方針」
- `SQLITE_DELETE` case（:104-109）にインラインコメント（:185 の `select` には drift 防止コメントがあるが DELETE には無い）
- `SQLITE_ARCHIVE_DELETE_BY_STAGING`（:148）に「VACUUM/freelist は InMemory で検証不能、製品バックエンド（`opfsWorker.test.ts` / e2e）でテストせよ」
- `inMemoryTransport.test.ts:66` のテスト名変更 or コメント追加
- `dev-docs/` に「テストダブルの意図的乖離一覧」ドキュメント（DELETE 以外も将来追加できる形）を新設推奨

### 既存ドキュメント化状況
`dev-docs/archived/pbi/2026-09-03-07-refactor-sqlite-gateway-fidelity.md` が (a) `buildExtraWhereSql` 再実装、(b) FTS `substringIncludes` short-circuit、(c) `ORDER BY (a[key] ?? 0)` の 3 点のみ扱い完了。DELETE のソフト/ハード乖離は言及ゼロ。

### この PBI でやること（主: ドキュメント化。従: ガードテスト。helper 改修は不要）
1. `inMemoryTransport.ts` の JSDoc とインラインコメント追加（必須）
2. `inMemoryTransport.test.ts:66` のテスト名/コメントを乖離を認識した表現に変更
3. `dev-docs/` に「テストダブルの意図的乖離一覧」ドキュメント新設（推奨）
4. （任意）「InMemory で削除したレコードが `getRecords()` に `is_deleted=1` で残る」ことを明示アサートするガードテスト（乖離を仕様として固定）

### 制約
- 統一はしない方針（InMemory に SQL エンジンを積まない）。helper を製品挙動に寄せる改修は不可
- `is_deleted` カラムは製品スキーマに実在するが、ローカル DELETE ではなく Gist 同期経由の論理削除受信・アーカイブ用。ドキュメントでこの区別を誤らない
- アーカイブ系は InMemory 全面非対応。e2e（`testDir/e2e/dashboard-archive.spec.ts` 等）と `opfsWorker.test.ts` が受け皿

## 未解決事項
1. 契約テスト（`ChromeOffscreenTransport` と `InMemoryTransport` の結果一致を検証）は実在するか？ fidelity PBI の完了条件に「6 tests green」とあるが `src` 内に特定できず。存在するなら DELETE ケース追加すべきか
2. `is_deleted` の論理削除は製品のどこかで発生するのか？（`SET is_deleted = 1` を実行する箇所が製品にあるか、Gist 同期の適用側）
3. `pbi/2026-07-07-02` の「論理削除で統一」設計意図は破棄されたのか？ 現状の物理削除は意図的な設計変更か、なし崩しか。もし「本来は論理削除にすべき」ならスコープが「ドキュメント化」から「製品を論理削除に直す」に変わる（別 PBI 1.0 人週規模）
4. ダッシュボードの削除 UX は undo を提供しているか？ 物理削除だと undo 不可
5. 乖離レジストリ・ドキュメントの置き場所は `dev-docs/` の ADR 形式か、`CLAUDE.md` 等の常設ドキュメントか

## Definition of Done
- [x] 全 BDD シナリオがドキュメント/コード/テストとして実現され、ドキュメント系はレビューで、テスト系は自動テストで確認されている
- [x] `inMemoryTransport.ts` の JSDoc とインラインコメントに DELETE 乖離が明記されている（`grep` で確認可能）
- [x] `dev-docs/` に「テストダブルの意図的乖離一覧」ドキュメントが存在し DELETE が記載されている
- [x] `inMemoryTransport.test.ts:66` のテスト名/コメントが乖離を認識した表現になっている
- [x] コードレビュー完了
- [x] `npm run validate` green

## 実装メモ（2026-09-07 autonomous-task-closer）

### 未解決事項 1〜5 の結論
1. **契約テスト（ChromeOffscreenTransport vs InMemoryTransport の結果一致）は実在しない**。`grep -rn "ChromeOffscreenTransport" src/` でヒットするのは型参照（offscreenTransport.ts / offscreenGateway.ts / sqliteClient-queue.test.ts）のみで、一致検証テストは存在しない。fidelity PBI の「6 tests green」は `inMemoryTransport.test.ts` 内の共有 predicate 系テストを指す。→ DELETE ケース追加は該当なし
2. **`is_deleted` の SET は製品コードに存在しない**。`grep` で `SET is_deleted` 相当はゼロ。製品で `is_deleted = 1` を参照するのは `archiveCreateHandlers.ts:99` の集計 SELECT のみ。値は Gist 同期受信時にレコード単位でそのまま保存される（適用側で書き換えない）。→ ドキュメントに「製品コードに SET は存在しない」ことを明記
3. **「論理削除で統一」設計意図は破棄されて現行設計が物理削除**（`storageFallback.ts` の `hardDelete` / `crudHandlers.ts` の `handleHardDelete`）。PBI-32（wa-sqlite sunset）でも削除経路の変更は予定されていない。→ スコープはドキュメント化のまま固定。スコープ拡張（製品を論理削除に直す）は行わない
4. **ダッシュボード削除 UX に undo は非提供**（`src/dashboard` に undo 実装なし、削除は confirm 付き）。物理削除の UX 互換性問題なし
5. **乖離一覧の置き場所は `dev-docs/TEST_DOUBLES_DIVERGENCE.md`**（dev-docs の SCREAMING_SNAKE_CASE 慣例に整合）。ADR 形式ではなくレジストリ形式（将来の乖離追加手順も記載）

### 実装内容
- `inMemoryTransport.ts`: クラス JSDoc に Known intentional divergence 節を追加、`SQLITE_DELETE` case に drift-prevention コメント、`SQLITE_ARCHIVE_DELETE_BY_STAGING` case に VACUUM/freelist 検証不能性コメント
- `inMemoryTransport.test.ts`: テスト名を乖離認識型に変更 + ガードテスト 3 件追加（getRecords 残存 / 削除済み UPDATE 成功 / DELETE→INSERT 重複可視）。17 tests green
- `dev-docs/TEST_DOUBLES_DIVERGENCE.md` 新設（観点別影響表・is_deleted の正しい用途・将来の追加手順）
