# PBI 13 調査報告: Obsidian 書込 replay の冪等性方式の確定

PBI: `pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md`（investigate・production 変更なし）
依存: PBI 12（recovery owner 裁定・2026-09-27 完了アーカイブ済み — `84d26644`）、PBI 11（failure SSOT・完了アーカイブ済み）
日付: 2026-09-27

## 0. 調査台帳（現状の事実 — 実測行番号付き）

| 項目 | 事実 | 出典 |
|---|---|---|
| write の read-modify-write | `appendToDailyNote` = GET（404 は空文字）→ section insert → PUT。`globalWriteMutex` で競合排除。同一 operation の識別は保証しない | `obsidianClient.ts:174-203` |
| HTTP surface | GET 2 回（daily note 取得 + 既存内容）+ PUT 1 回。PATCH/POST/DELETE はクライアント未実装 | `obsidianClient.ts:205-224,236-276` |
| replay 時の時刻再生成 | `formatMarkdownStep` が entry 変換時に `new Date().toLocaleTimeString(...)` で timestamp を生成 — **retry ごとに値が変わる**。`retryObsidianWrite`（2-step subset）がこの step を replay するため、PUT body が replay ごとに変わる | `pipeline/steps/formatMarkdownStep.ts:34-47`、`RecordingOrchestrator.ts:155-173` |
| section editor の挙動 | `insertIntoSection` / `_insertUnderExistingSection` は同一内容を検出せず**無条件に splice 挿入**。dedupe test は存在しない | `noteSectionEditor.ts:13-30` |
| `traceId` | helper・log に渡るだけ。本文・header・idempotency key ではない | `obsidianClient.ts:188-197` |
| `job.id` | `processJob(job, payload)` が `job` 全体を受けるが使用は `payload` のみ — **`job.id` は捨てられている**（PBI 12 実装後も変わらず） | `offlineQueueProcessor.ts:93,100` |
| production write call site | (1) `saveToObsidianStep`（pipeline 内・自動）(2) dashboard append（`dashboardSqlite/deps.ts:237-240`、ユーザー明示操作） | 同左 |
| retry owner（PBI 12 裁定） | 自動 retry の owner は **offline retry queue**（`offlineQueueProcessor`、5 分 alarm・durable claim）。Obsidian-only retry path（`retryObsidianWrite`）は queue からの呼び出し先であり、owner ではない。二重 owner は claim で排除済み | PBI 12 報告 + `offlineQueueProcessor.ts:80-115` |
| failure SSOT | `failureTaxonomy.ts`（Layer 0）。write 側は `failureFromHttpStatus` で `FailureMetadata` を付与済み。retry 述語（`FAILURE_RETRY_PROFILE`）と breaker 方式は重複定義しない | `utils/failureTaxonomy.ts` |
| HTTPS / API key | 非 loopback 平文 HTTP は `obsidianConfigValidator.ts:35-66` で拒否済み。API key は Authorization header のみ | 同左 |
| 既存 pin テスト | `noteSectionEditor.test.ts` は「常に挿入する」現行挙動を pin。dedupe の期待値変更が必要になる | 同左 |

## 1. 5 Whys

### Q1: なぜ write 経路の retry 設計が遅れているのか（時刻再生成の問題）

- **事実**: `formatMarkdownStep` は entry 変換時に現在時刻から timestamp を生成する。offline job payload には変換前データ（title/url/summary/tags）が入っており、`retryObsidianWrite` が replay のたびに markdown を作り直すため、**PUT body が replay ごとに変わる**。PUT は同一 body なら HTTP として冪等だが、body が変わるため「2 回の異なる write」として挙動し、section editor の無条件挿入と合わさって section が重複する。
- **判断材料**: markdown の変換に必要な入力（title/url/summary/tags + timestamp）は初回 pipeline 実行時にすべて確定している。replay で再変換する理由がない。
- **裁定**: **markdown を初回 pipeline 実行時に確定し、offline job payload に完成品として保存する**。replay は payload から markdown を読んで PUT するだけ（変換しない）。これにより replay の PUT body が同一になり、HTTP 冪等（同一 body PUT）の性質を得る。保存先は offline job payload（chrome.storage.local — durable、SW memory に依存しない）。
- **残存リスク**: payload サイズ増（markdown 文字列 1 份）。queue 上限 50KB の計算に含まれるため、既存上限チェックはそのまま有効。

### Q2: なぜ job ID をそのまま冪等性に使えないのか

- **事実**: `processJob(job, payload)` が `job.id` を捨てている。retry traceId も `retryObsidianWrite` 内で毎回新規生成される。
- **判断材料**: (a) job.id を payload に保持して stable operation ID に使う (b) operation ID を採用しない。
- **裁定**: **operation ID は採用しない**。理由は Q3（上流 API に idempotency header が存在しない）— operation ID の送出先がない。ローカル dedupe は Q4 の本文内容検出で表現し、ID による照合は不要になる。`job.id` の payload 保持も行わない（ログの紐付け程度にしか使えない）。
- **残存リスク**: 後続 fix で marker/DUI の運用を変える場合に再検討。現時点では採用理由が立たない。

### Q3: Local REST API plugin は idempotency header や 409 をサポートするのか

- **一次情報（2026-09-27 取得）**: 上流 README（coddingtonbear/obsidian-local-rest-api、master branch）— response headers の記載は `Content-Location` / `Markdown-Patch-Warnings` / `Deprecation` / `Mcp-Session-Id` のみで、**idempotency key header は存在しない**。409 Conflict の明記もない。OpenAPI spec は `obsidian://local-rest-api/openapi.yaml` で提供される（契約 owner: 上流リポジトリ）。`ifMatch`（optimistic concurrency）と `Reject-If-Content-Preexists` は存在するが **PATCH 専用**であり、本プロジェクトの HTTP surface（GET 2 + PUT 1、PBI 制約で追加禁止）では利用できない。
- **裁定**: **idempotency header と 409 扱いに依存しない**。409 の retryable/terminal/idempotent-success 分類も採用しない（上流が 409 を返す契約にないため）。未提供を前提に、クライアント側で冪等性を表現する（Q1・Q4）。
- **残存リスク**: 上流が将来 idempotency header を追加した場合も、本方式（同一 body PUT + 内容検出）と共存可能。上流の 6.0 sunset（PATCH legacy format）は本プロジェクトに影響しない（PATCH 未使用）。

### Q4: dedupe の長さ（24 時間等）をどこで固定するのか

- **判断材料**: (a) 本文 marker（生成物に機械可読な ID を埋め、その存在で重複判定）+ dedupe window (b) **同一内容検出**（section 内に同一 content 行が既に存在すれば再挿入しない。時間 window なし）。
- **裁定**: **同一内容検出を採用し、dedupe window は設けない**（時間に依存しない完全冪等）。理由: (1) Q1 の裁定（時刻固定 → 同一 body）と組み合わせると、replay の content 行は byte-identical になるため、行一致だけで十分に判定できる (2) marker はユーザーのノートを汚し、marker の整合管理（手編集で破壊された marker への扱い）という新たな状態を持ち込む (3) dedupe window は「window 内だけ守る」= 窓外の replay は重複する弱い保証で、SW 再起動や長期障害後に破綻する。
- **追加条件**: 内容一致は `insertIntoSection` 内の section 範囲（DEFAULT_SECTION_HEADER から次の `#` まで）だけを対象にする。他 section・他 note には影響しない。
- **同時刻・同内容の別録画**: 時刻固定は offline job payload 内で完結するため、2 回目の録画は新しい pipeline run が新しい payload（別 timestamp）を持つ。同一 URL・同一秒の衝突は行内の URL 表記で区別される（要確認は後続 fix のテスト）。
- **残存リスク**: ユーザーが同内容行を手動で削除した直後に replay すると再挿入される（冪等性の再現として正しい挙動）。

### Q5: dashboard append と自動 retry で冪等性の強度を別にしてよいか

- **事実**: dashboard append（`dashboardSqlite/deps.ts:237-240`）はユーザー明示操作。offline replay は自動 retry。
- **裁定**: **別にする**。同一内容検出は **offline replay 経路のみ**に適用する。dashboard append は現状の無条件挿入を維持（ユーザーが同じエントリを意図的に 2 回 append する権利を保つ）。
- **境界**: `appendToDailyNote` にオプション引数を追加し、`saveToObsidianStep`（自動経路）からは dedupe 有効、dashboard append からは無効（既定値は無効 = 後方互換）。2 call site に同一の retry 処理を適用しない。
- **残存リスク**: なし（オプション既定値で後方互換）。

## 2. 裁定まとめ

| 項目 | 裁定 |
|---|---|
| 生成時刻の固定 | 初回 pipeline 実行時に markdown を確定し、offline job payload に完成品を保存（chrome.storage.local）。replay は再変換しない |
| operation ID | **不採用**。上流 idempotency header が存在しないため送出先がない。ローカル dedupe は内容検出で代替。`job.id` は payload に保持しない |
| idempotency header / 409 | **依存しない**（上流未提供 — 一次情報 §1 Q3）。409 分類も不採用 |
| 本文 marker / dedupe window | **不採用**。代わりに同一内容検出（section 範囲内の行一致）を `insertIntoSection` に追加。時間 window なしの完全冪等 |
| 同一 body PUT と全体 replay の区別 | 同一 body PUT は HTTP 冪等（再送安全）。全体 replay は時刻固定 + 内容検出で冪等化。両者を同じ「retry」として扱わない |
| retry owner | offline retry queue（PBI 12 裁定どおり）。Obsidian-only retry path は呼び出し先 |
| dashboard append | ユーザー明示操作。dedupe 無効（既定値で後方互換） |
| failure SSOT | `failureTaxonomy` を共有（write 側は既存の `failureFromHttpStatus` 付与を維持。retry 述語の重複定義はしない） |
| 既存重複の除去 | **範囲外**（本 PBI でも後続 fix でも行わない） |

## 3. 後続 `fix` の変更対象とテスト範囲（起票仕様）

**種別**: `fix`、推定 1.5 SP。

**変更対象**:
1. `saveToObsidianStep` 失敗時の offline enqueue（または `offlineQueueProcessor`）: payload に**完成済み markdown** を追加する（`formatMarkdownStep` の出力をそのまま保存）。変換入力ではなく完成品を運ぶ
2. `RecordingOrchestrator.retryObsidianWrite` / `executeRetrySubset`: obsidian_sync replay では formatMarkdownStep を再実行せず payload の markdown を使用する（2-step subset の構造を保ったまま、format を skip する形）
3. `NoteSectionEditor.insertIntoSection`: 新オプション（例: `dedupe?: boolean`、既定 false）を追加し、true 時は section 範囲内の同一 content 行を検出して再挿入しない
4. `appendToDailyNote`: オプション透過。dashboard append は無指定（現状維持）

**BDD（Outside-In）**:
- offline `obsidian_sync` 初回処理後に一時障害 → replay しても同じ section が 1 件だけ残る
- replay の PUT body が初回失敗時の body と同一である（timestamp が変わらない）
- 同一内容検出は offline replay 経路のみ有効で、dashboard append は無条件挿入のまま

**統合テスト**:
- `offlineQueueProcessor.test.ts`: `obsidian_sync` が AI を再実行しない契約の維持 + payload の markdown がそのまま PUT される契約
- `recordingPipeline-full.test.ts:247-292`: queue と Obsidian-only retry path の replay 境界
- `obsidianClient.ts` mutex 済み read-modify-write: 同一 operation の replay で 1 件だけ残る

**単体テスト**:
- 同一 payload → 同一 markdown（時刻不変）
- 内容検出: 一致・不一致・欠落（新規 section）の 3 分岐
- dashboard append が dedupe 無効のまま
- API key が markdown / operation ID / log / 例外に含まれない

**既存 pin の変更**:
- `noteSectionEditor.test.ts` の「常に挿入する」pin は**残したまま**、dedupe 有効時の新テストを追加する（既定値 false のため旧 pin は壊れない）

**引き継ぎ制約**: HTTPS 既定・非 loopback 平文拒否維持 / GET 2 + PUT 1 以外の HTTP surface を追加しない（`dev-docs/API_ENDPOINTS.md` の整合確認を含める） / API key は Authorization header 以外に出さない / SW memory に operation ID を保存しない（不採用のため該当なし） / ESM `.js`・async/await 維持。

## 4. PBI 13 DoD との対応

- PBI 12 に基づく recovery route owner の確定: §0・§1（offline retry queue が owner）✅
- PBI 11 の failure SSOT 共有可否: §0・§2（共有する。重複定義しない）✅
- 5 Whys（事実・判断材料・裁定・残存リスク）: §1 ✅
- 同一 body PUT と全体 replay の区別: §1 Q1・§2 ✅
- 生成時刻の固定時点と保存先: §1 Q1（初回実行時・offline job payload）✅
- operation ID の採否（不採用）と理由: §1 Q2・§3 ✅
- marker / dedupe window / 409 の代替方式: §1 Q3・Q4 ✅
- Local REST API の一次情報・契約 owner: §1 Q3（README + OpenAPI・上流リポジトリ）✅
- dedupe window の値と固定場所: 採用しない旨を §1 Q4 に明記 ✅
- dashboard append と自動 retry の境界: §1 Q5・§2 ✅
- 2 つの write call site の適用範囲: §3 ✅
- API key・HTTPS・HTTP surface・ESM・async/await の制約引き継ぎ: §3 ✅
- 既存 pin テストの変更対象と Outside-In 方針: §3 ✅
- 既存重複の除去が範囲外: §2 ✅
- 実装は別 fix に分割: §3（1.5 SP 起票仕様）✅
- 本 PBI では対象ファイル以外の変更・テスト実行・git 操作なし: 本報告書のみ ✅
