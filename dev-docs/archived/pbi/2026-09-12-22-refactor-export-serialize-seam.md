# PBI 2026-09-12-22 — Export serialize を StorageBackend interface へ（backend で export 形状が分岐する実バグ解消）

- **種別**: 🔧非機能追加（refactor + fix・形状分岐の実バグ解消を伴う）
- **優先度**: 6 位 / RICE **6.4**（R6 × I2 × C80% / E1.5人日）
- **出典**: round 11 診断 候補 22・サブエージェント探索 + 直接検証（台帳「recordsRepo.serialize interface 化」の concrete 解）

## 背景（なぜ）

export が backend で形状分岐する実バグ: OPFS worker は **bare array・13 列**（backupHandlers.ts:19-20,42・`as` 6 箇所）、IDB/fallback は **{version:1, table, rows} envelope・11 列**（recordsRepo.ts:124-166）。`SQLITE_EXPORT` wire op は到達可能かつ形状 parity 未テスト。recordsRepo.serialize（:110-173）は `tryOpfsProxy('SERIALIZE')` + init チェック + fallback 分岐 + execWithCache で `StorageBackend` interface を迂回（deletion test: どの枝を消しても該当 backend の export が壊れる = 単一 owner 不在）。worker mapper の `as` 6 箇所は rowCodec 強制の外で、schema 型変更が export を静的に壊す。

## スコープ

- `Queryable` interface に `serialize()` を追加し 3 backend が薄実装
- envelope + 列リストを rowCodec 派生の SSOT に統一（worker の手書き mapper は `mapNamed` へ）
- `recordsRepo.serialize` は他メソッド同様の 3 行委譲に
- 振る舞い: 全 backend が同一 envelope + 同一列集合を返すように統一（OPFS の列が 13 → SSOT 列に）

## 受け入れ基準（BDD）

### シナリオ 1: 全 backend が同一形状を返す（ハッピーパス）
```gherkin
Given 3 backend に同一の seed
When serialize() を呼ぶ
Then JSON が {version:1, table:'browsing_logs', rows} で、列集合が SSOT と一致する
```

### シナリオ 2: 列 SSOT の drift が検出される（境界）
```gherkin
Given EXPORT_COLUMNS が rowCodec の COLUMN_NAMES から派生
When schema 列が追加される
Then drift ガードテストが SSOT 未更新を検出する
```

## DoD

- [x] interface 追加・3 実装・recordsRepo 縮約・SSOT 統一
- [x] serialize-shape parametric テスト + drift ガード新設
- [x] offscreen export 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `Queryable` interface に `serialize()` + `SerializeResult` を追加。3 backend が薄実装: OpfsWorkerBackend（worker SERIALIZE）、IdbVfsBackend（EXPORT_COLUMNS SELECT + envelope）、FallbackStorageAdapter（query + envelope）
- `exportEnvelope.ts` SSOT 新設: EXPORT_COLUMNS（13 列 whitelist）+ `projectExportRow`（missing → null）+ `buildExportEnvelope`。drift guard テストで EXPORT_COLUMNS ⊆ BROWSING_LOG_COLUMNS を pin
- worker `handleSerialize` の手書き mapper（`as` 6 箇所）を削除し envelope SSOT へ。recordsRepo.serialize は 3 行委譲（tryOpfsProxy/init/fallback 分岐 + execWithCache 60 行を削除）
- recordsRepo-coverage の serialize pin 6 件を委譲契約に更新（旧: 3 分岐再現 / 新: delegation + single-seam 検証）
- 検証: exportEnvelope 3 tests + coverage 37 tests green・offscreen 全 76 ファイル 1055 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（OPFS 経由の export JSON が envelope + SSOT 列に統一される = 分岐の解消）
