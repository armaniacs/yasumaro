# Deep-Dig Findings — 2026-07-09

## Overview
Deep-dig interview for the recommended implementation order of review-cycle PBIs (Checking Team feat-6_5 review).

## Assumptions Challenged & Decisions

### PBI-10 (purgeLegacyStorage SQLite health check)
| Assumption | Risk | Finding | Decision |
|------------|------|---------|----------|
| storage.ts はコンテキスト非依存 | 高 | purgeLegacyStorage() は Service Worker/popup/dashboard の全コンテキストから呼ばれる可能性がある。SqliteClient に直接アクセスできない | **saveSettings() 側で事前チェックする方式** — saveSettings() は Service Worker コンテキストで呼ばれるため、SqliteClient にアクセス可能。storage.ts は変更しない |

### M10 (insertBatch per-row SELECT changes)
| Assumption | Risk | Finding | Decision |
|------------|------|---------|----------|
| sqlite.ts:682-686 に per-row changes() がある | 高 | sqlite.ts の insertBatch は既に BEGIN IMMEDIATE/COMMIT でラップ済み。per-row changes() は **opfsWorker.ts:554** に存在する | **opfsWorker.ts の per-row SELECT changes() を修正**。COMMIT後の1回に移動する |

### M11 (OPFS Worker transaction)
| Assumption | Risk | Finding | Decision |
|------------|------|---------|----------|
| opfsWorker.ts handleInsertBatch に明示的トランザクションがない | 中 | 既に BEGIN (507) / COMMIT (562) / ROLLBACK (564) が実装済み | **M11は既に解決済み**。対応不要 |

### PBI-13 vs PBI-09 (storageFallback.ts 競合)
| Assumption | Risk | Decision |
|------------|------|----------|
| 両者の変更が storageFallback.ts の同一関数を編集する | 中 | **PBI-13（Mutex）→ PBI-09（カラム共通化）** の順で実施 |

### PBI-11 (gist_synced)
| Assumption | Risk | Decision |
|------------|------|----------|
| opfsWorker.ts の SELECT クエリにも gist_synced 追加が必要か | 低 | **schema.ts + migration + GistSyncTarget の変更のみ**。opfsWorker は現状スコープ外 |

### M32 (WAL mode timing)
| Assumption | Risk | Finding | Decision |
|------------|------|---------|----------|
| WALモード設定をスキーマ実行前に移動して安全か | 中 | sqlite.ts:327 がスキーマ実行 (:260-325) の後にある | **PRAGMA journal_mode=WAL + wal_autocheckpoint をスキーマ実行の直前に移動** |

### PBI-09 commonization scope
| Assumption | Risk | Decision |
|------------|------|----------|
| 3層でINSERT APIが異なる（execWithCache / sqlExec / プレーンオブジェクト） | 中 | **カラム名列挙のみを schema.ts で共通化**。SQL文生成やパラメータビルダーは各層で個別に持つ |

### PBI-15 architecture changes (M7/M8/M12/M13/M14)
| Assumption | Risk | Decision |
|------------|------|----------|
| これらは Phase 5 最後で十分か | 高 → 中 | **計画通り最後にまとめる**。設計議論が必要なため、具体的修正が落ち着いてから着手 |

### Overall scope
| Decision |
|----------|
| **1ブランチで全12項目を連続実施**。各Phase完了時にコミット |

## Unresolved Questions
- M13（LIMIT強制上限）は簡単な局所修正だが Phase 5 最後に回っている。必要なら前倒し可能
- M10の修正が opfsWorker.ts の insertBatch 1箇所で済むかどうかはコード確認後確定
- PBI-08 の「機密設定キー」の正確なリストは実装時に Settings 型定義から確定する
