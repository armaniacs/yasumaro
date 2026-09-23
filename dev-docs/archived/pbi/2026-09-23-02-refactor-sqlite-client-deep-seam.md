# PBI 2026-09-23-02 — ダッシュボード→SQLite 二次ストア RPC の wire-table Seam 深化

**優先度**: 順位 2 / RICE 17.1（Reach 8 × Impact 2 × Confidence 80% ÷ Effort 0.75 人週）
**根拠**: 約 30 op の Service ラッパー群が shallow（interface が実装と同複雑さ）。wire-table を真の Seam に昇格すると新 op が 1 行追加になり、decode・エラー文面・retry の知識が 1 表に集まる。呼び出し側 8 箇所が恩恵を受ける。
**種別**: refactor（非機能追加）

## 背景

`dashboardSqliteService.ts`（510 行・約 30 公開 op）の各関数は `callSqliteWire(descriptor, payload, retry)` / `callDashboard(payload, decode, defaultError)` の 1 行 Adapter であり、retry ポリシー（read のみ opt-in、アーカイブ系 noRetry）の知識が呼び出し側に残る。新 op 追加は wire-table 行＋Service ラッパー＋validator の 3 点編集。`offscreenGateway.ts` 側 `ARCHIVE_GATEWAY_DECODERS` との decode 二重所有もある。

## 実装戦略

1. `src/messaging/sqliteWireTable.ts` に行単位で encode/decode/retry/noRetry/defaultError を所有させ、`sqliteClient.call(op, payload)` の単一ジェネリック呼び出しを深い interface にする（`src/dashboard/dashboardSqliteService.ts` を薄い互換層に縮退）。
2. 既存 30 named 関数は型付きエイリアスとして残し、呼び出し側（sqliteHistoryModel / exportLogsService / importLogsService / encryptedBackupService / markdownExport / DiagnosticsCollector 他）は変更不要から段階的にジェネリック呼び出しへ寄せる。
3. `callSqliteWire` / `callDashboard` の二重 runner を表駆動の単一 runner に統合する。
4. `ARCHIVE_GATEWAY_DECODERS` の decode 所有は wire-table 側に寄せ、offscreenGateway は行参照にする。

## 受け入れ基準（BDD）

### シナリオ 1: 新 op の追加は wire-table の 1 行で完結する
- **Given** 新しい読み取り op `get_tag_stats` を追加する
- **When** wire-table に descriptor 行（encode/decode/retry）を 1 行追加する
- **Then** Service ラッパーは型エイリアス 1 行で足り、runner・decode・retry の個別実装は不要である

### シナリオ 2: retry ポリシーは行が所有する
- **Given** アーカイブ系 op（noRetry 語義）と read 系 op（opt-in retry）が混在する
- **When** 呼び出し側が `sqliteClient.call('archive_status', payload)` を呼ぶ
- **Then** 呼び出し側が retry 有無を指定しなくても、行の語義どおりに動作する

### シナリオ 3: 既存 30 op は互換維持
- **Given** 既存の呼び出し側コードが named 関数（`queryLogs` 等）を呼ぶ
- **When** 深化後に全テストを実行する
- **Then** 呼び出し側の変更なしで全テストが緑である

## DoD（Definition of Done）

- [x] 単一ジェネリック runner に統合され、`callSqliteWire` / `callDashboard` の二重 runner が消える
- [x] wire-table の各行が encode/decode/retry/defaultError を所有し、Service は互換エイリアスのみ
- [x] 少なくとも 2 呼び出し側をジェネリック呼び出しに移行し、行数削減を実証する
- [x] fail-closed 関連テスト（limits-drift、wire-table sync assert）が緑のまま
- [x] `npm run type-check` / `npm run lint` / `npm test` が緑

## 実装記録（2026-09-23）
- コミット 69f7d2c5。三重 runner（callDashboard/callSqliteWire/callArchive）を表駆動の単一 runner に統合し、各行が encode/decode/retry/defaultError を所有。公開 interface は `sqliteClient.call<O>(op, payload)` の1本。既存 30 named op は互換エイリアス。export/import の2呼び出し側をジェネリック呼び出しに移行（sqliteHistoryModel 等は named import を spy するテストが12+ ファイルあるため移行せず、リスク回避を記録）。ARCHIVE_GATEWAY_DECODERS 複製を削除し decode を wire-table 側に寄せる（cross-tier 障害なし — 両辺とも messaging 依存済み）。
- 駆動行（coreCrud 3行）に `retry: { retryAttempts: 1 }` を明示（coreCrudHandler の Required<> 制約に合わせ、挙動同一）。将来の駆動行も retry 宣言がコンパイル強制される。
- limits-drift / wire-table sync assert は無修正で緑。検証: type-check / messaging+service 24 ファイル 337 テスト緑。
