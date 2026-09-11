# PBI 08: 上限定数を limits.ts へ取り込み（台帳トリガー発火分）

## ユーザーストーリー

上限を管理する開発者として、破壊を防ぐ上限が `src/messaging/limits.ts` に集まり、新規上限が「limits.ts 外に置く理由」を明示する運用になってほしい。なぜなら台帳項目「query cap/alias 統合」のトリガー（上限 drift の再検出）が発火し、8 箇所が SSOT 外に残存しているから。

## 優先度

- 順位: 08 / 10
- RICE スコア: 9.6（Reach=3 / Impact=1 / Confidence=80% / Effort=0.5 人週）
- 根拠（2026-09-11 再評価で drift 再検出 — トリガー発火）:
  - `systemHandlers.ts:286-288` — MAX_LOG_FORWARD_MESSAGE_CHARS / DETAILS_KEYS / SERIALIZED_CHARS（VULN-004 修正時に file-local 化された 3 定数）
  - `sqliteEngineHost.ts:56` — `MAX_QUERY_LIMIT = 100000`（`QUERY_CAPS.fts` と同値の二重定義・`recordsRepo.ts:45` が消費）
  - `archivePanel.ts:23` — `EXPORT_CHUNK_BYTES = 8MB`（`limits.ts:31` の MAX_ARCHIVE_EXPORT_CHUNK_BYTES と二重 — validator は canonical を使用済み）
  - `recordingValidator.ts:16` — MAX_RECORD_SIZE 64K · `piiSanitizer.ts:14,16` — 64K/128K · `aiUsageTracker.ts:214` — MAX_TOKENS_PER_CALL 10M · `obsidianClient.ts:194` — MAX_ERROR_BODY_SIZE 1MB
  - ADR `2026-08-27-limit-policy.md` の「MAX_QUERY_LIMIT を QUERY_CAPS に SSOT 化」主張と実態が乖離

## BDD 受け入れシナリオ

```gherkin
Scenario: 上限の単一参照
  Given limits.ts に 8 箇所の上限定数が集約される
  When 消費者が上限を使う
  Then import 参照であり、数値リテラルの再宣言は drift ガードテストで検出される

Scenario: trust boundary コメントの保持
  Given systemHandlers の log-forward 上限
  When limits.ts から import する
  Then 「境界はこの handler」という WHY コメントは消えず、定義場所だけが移る
```

## 受け入れ基準

- [x] 8 箇所の定数を limits.ts へ移設し消費者を import に（値は不変）
- [x] archivePanel の 8MB を limits の canonical 参照に
- [x] drift ガードテスト: limits.ts 外の上限リテラル再出現を検出（代入パターン grep 方式・round 4 の legacy path ガードと同一パターン）
- [x] ADR 2026-08-27-limit-policy に status note（QUERY_PLAIN_LIMIT 名不採用・残存二重定義の解消）を追記
- [x] 全テスト green

## テスト戦略

drift ガード新設 + 既存上限関連テスト green。

## 見積もり

S-M（0.5 人週）。種別: refactor。

## 実装アプローチ

1. limits.ts に定数群を移設（コメントで所有権明記）
2. 消費者 import 置換
3. drift ガード + ADR note

## 实装メモ（2026-09-11 round 5）

- limits.ts に 8 定数 + drift ガードが**発見した追加 6 定数**（MAX_IMPORT_TEXT_BYTES / MAX_PAYLOAD_STRING_BYTES / MAX_BATCH_TOTAL_BYTES / MAX_PAYLOAD_TOTAL_BYTES / IMPORT_TOTAL_ROW_CAP / MAX_SUMMARY_LENGTH）を取り込み。値は不変。
- 消費者: sqliteEngineHost（re-export）/ systemHandlers（import + 境界コメント保持）/ archivePanel / recordingValidator / piiSanitizer / aiUsageTracker / encryptedBackupPanel / obsidianClient / payloadGuard / importLogsService。
- drift ガード `limits-drift.test.ts`: 値代入パターンを grep し limits.ts 外の再出現を検出（表示フォーマット用 MB 定数等は exempt list で区別）。
- ADR 2026-08-27-limit-policy に status note 済み。
