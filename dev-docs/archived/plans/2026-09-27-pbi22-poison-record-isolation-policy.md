# PBI 22 調査報告: pendingSqliteQueue の毒レコード隔離方式

PBI: `pbi/2026-09-25-22-investigate-pending-queue-poison-record.md`（investigate・production 変更なし）
依存: PBI 01（transport retry policy・完了アーカイブ済み）、PBI 11（failure taxonomy・完了アーカイブ済み）
日付: 2026-09-27

## 0. 現状の事実と前提ドリフト

実測した現状（PBI 起票時からの変化は「ドリフト」として明示する）:

| 項目 | PBI 前提 | 実測現状 |
|---|---|---|
| キュー上限 | 5,000 件 | **500 件**（`MAX_PENDING_RECORDS`）— ドリフト |
| chunk | 50 件 | 50 件（`BATCH_SIZE`）— 一致 |
| retry 上限 | 5 回 drop | 5 回（`MAX_RETRY_COUNT`）— 一致 |
| TTL | 7 日 | **24 時間**（`TTL_MS`）— ドリフト |
| 「50KB・200 件・TTL 7 日・1 cycle 20 件」 | 本キューの制約として記載 | **別キュー（offlineNetworkQueue）の制約**。pendingSqliteQueue には存在しない — 前提の混同 |
| throw 時の挙動 | catch されず flush 全体が止まる | **`flushBatch` が chunk 単位で catch し継続**（`persistentRetryQueue.ts:311-327`）— ドリフト。records は storage に残る点は一致 |
| success response の件数照合 | `inserted + skipped < chunk.length` を確認せず捨てる | 一致。`SqliteClientLike` 型は `success` のみ参照し `count` すら読まない |
| row error の扱い | 成功 response に畳み込まれる | 一致（`crudHandlers.ts:121-140` — per-row catch で何も加算せず通過） |
| flush call site | 3 箇所（enqueue・startup・periodic） | flush は **2 箇所**（lifecycleHandlers・alarmRegistry）。saveSqliteStep は enqueue のみ — 呼称のドリフト |
| 混合 chunk・件数不一致のテスト | 存在しない | 一致（存在しないことを確認） |

## 1. 5 Whys（事実 → 裁定 → 根拠 → 残存リスク）

### Q1: なぜ poison が仲間を巻き込むのか

- **事実**: 成否判定が 50 件 chunk 単位。`flushPendingRecords` は `result.success` のみを見て chunk 全体の運命を決める。失敗 chunk は全 record が同じ `retryCount` を共有し 5 回で一斉 drop される。
- **裁定**: §3 の record 単位分離方式を採用する（後続 fix）。
- **根拠**: chunk 単位の運命共有が 49 件巻き添えの直接原因。
- **残存リスク**: なし（原因特定済み）。

### Q2: なぜ失敗 row を識別しないのか

- **事実**: worker が row error を成功 response に畳み込む（§0）。response には per-record の失敗情報が存在しない。swallow された row は `inserted` にも `skipped` にも加算されない。
- **裁定**: 方式選定の前に **row error の可視化が前提**（§3）。可視化なしに二分探索も index 方式も成立しない。
- **根拠**: 失敗が見えなければ、どの分離方式も「何を分離するか」を決められない。
- **残存リスク**: 可視化の実装範囲（worker + backend + wire + SW）が方式 B のコストに含まれる。

### Q3: taxonomy と retry 資格の対応はどうなるか

- **事実**: taxonomy 7 kind（network・timeout・http・auth・rate_limit・configuration・csp）。PBI 01 は transport 層の retry policy（messaging 中立層・fail-closed）を確定済み。
- **裁定**: 下記の failure-kind 判定表を採用する。

| 分類 | 対応する事象 | retry 資格 | 扱い |
|---|---|---|---|
| retriable batch failure | network・timeout・http（offscreen 到達不能・worker crash・5xx） | あり | chunk 全体を次回 flush に残す。**分割しない** |
| deterministic record failure | row error 可視化後の per-record 失敗（制約違反・型不正等、再実行しても成功しないもの） | なし（当該 record） | §3 の分離方式で隔離。他 record は影響を受けない |
| duplicate skip | inserted=0・skipped=N（全件保存済み） | 不要 | 正常終了。再試行しない |
| count mismatch（contract failure） | `inserted + skipped < chunk.length`（無言消失の可能性） | 保留 | chunk 全体を残す（削除しない）。黙って成功扱いしない |
| configuration・csp・auth | sqlite local insert では基本発生しない。発生時は deterministic に準ずる | なし | 運用で確認するまで chunk 全体を残す |

- **根拠**: PBI 11 の kind 定義と PBI 01 の fail-closed 原則を sqlite 文脈に写像したもの。
- **残存リスク**: 「deterministic」の判定は可視化後の row error 内容に依存する。初版は「連続 N 回失敗した record を deterministic とみなす」ヒューリスティクスが必要になる可能性があり、後続 fix の受け入れ条件に含める。

### Q4: 二分探索と failure-index のどちらを選ぶか

- **事実**: (A) 再帰二分探索は現行 response 形状で動作可能だが、swallow 現状では「成功」する半分を分割し続け、決して poison に到達しない。(B) failure-index 方式は 1 回の追加 flush で精密隔離できるが、4 層の同時更新が必要。
- **裁定**: **(B) failure-index response 契約を採用する**。(A) は row error 可視化の前提を満たしても、retriable との区別のたびに O(log n) メッセージを消費し、transient 误判で message が膨らむ。(B) は改修が一括だが、隔離の message コストは flush 1 回分で有界。
- **根拠**: message 数の有界性（PBI の価値「transient 1 回が 100 件超の message に膨らむ防止」）と判定の精密性。
- **残存リスク**: 4 層同時更新の抜け（落とし穴どおり）。後続 fix の受け入れ条件に層ごとのテストを含める。

### Q5: 実データなしに裁定できるのか

- **事実**: production の poison incident データは存在しない（「実データ待ち」の正体）。
- **裁定**: synthetic poison（制約違反 row を混ぜた 1+N 混合 chunk）による推論と code facts で裁定する。実データは不要 — 方式の正しさは response 契約と判定表で決まり、個別の poison 内容には依存しない。
- **根拠**: 分離方式は「失敗の特定方法」の設計であり、特定の poison 標本を必要としない。
- **残存リスク**: 未知の failure mode（想定外の row error 種別）は (B) の index に載らず count mismatch 側に落ちる。mismatch を「残す」扱いにすることで安全側に倒している。

## 2. 採用方式の定義（後続 fix 仕様）

1. **row error の可視化**（前提工事）: `crudHandlers` の per-row catch を失敗記録に変え、`insertBatch` response に failure indexes（chunk 内 index の配列）を追加する。swallow（無加算通過）を禁止する。
2. **failure-index 契約**: response = `{ success, count, inserted, skipped, failedIndexes? }`。SW 側 `SqliteClientLike` 型を拡張し、現行の `success` のみ参照をやめる。
3. **隔離規則**: failedIndexes の record のみ retry lifecycle を継続（個別 retryCount）。それ以外の record は queue から削除（成功扱い）。retriable batch failure（transport 層の判定）は chunk 全体を残し、分割しない。
4. **duplicate**: `inserted=0・skipped=N` は正常終了。再試行・分割の対象外。
5. **count mismatch**: `inserted + skipped + failedIndexes.length < chunk.length` は contract failure として chunk 全体を残す。無言削除を禁止する。
6. **同時更新の範囲**: Offscreen Worker・全 backend・wire decoder・Service Worker。層ごとのテストを後続 fix に含める。
7. **維持する既存契約**: 明示的 batch failure の failed-chunk-retention + 後続継続、throw 時の storage 残留、durable retry state（`chrome.storage.local`）、キュー上限 500・chunk 50・retry 5 回・TTL 24 時間。
8. **3 call site**（enqueue・startup flush・periodic flush）は同じ isolation 契約を使う。

## 3. 後続 `fix` への分解（推定 2 SP）

1. row error 可視化 + failure-index 契約の 4 層同時更新（Outside-In: 1-poison+N-healthy 混合 chunk テストを先に Red にする）
2. SW 側の隔離規則実装（個別 retryCount・mismatch retention・duplicate 正常終了）
3. 既存期待値の更新: `pendingSqliteQueue.test.ts` の shared `retryCount` 期待値を record 単位分離に合わせて更新（PBI 落とし穴どおり、無更新の維持は禁止）
4. `insertBatch-counting-parametric.test.ts` に row-error 可視化後の失敗経路を固定（swallow の再発防止）
5. BDD 4 シナリオ（混合分離・transient 非分割・duplicate 成功・mismatch 非黙殺）を E2E 最小構成 + 統合テストで検証

## 4. PBI 22 DoD との対応

- taxonomy の 4 分類: §1 Q3 の判定表 ✅
- 二分探索 vs failure-index の比較: §1 Q4 ✅
- 1 方式の裁定 + retriable 非分割の記録: §2 ✅
- 混合 chunk と件数不一致の受け入れ条件の後継 fix への引継ぎ: §2・§3 ✅
- response 方式の採否と 4 層同時更新の確定: §2（採用・同時更新あり）✅
- durable retry state + 既存上限の維持方針: §2（上限値は実測の 500・50・5・24h に訂正）✅
- production 変更なし・裁定と受け入れ条件の移行: 本報告書 + §3 ✅
