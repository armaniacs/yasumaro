# PBI 2026-09-12-32 — supportsArchive の narrowing 統一（doc/code 不一致解消）

- **種別**: 🔧非機能追加（refactor・hygiene）
- **優先度**: 8 位 / RICE **6.4**（R4 × I0.5 × C80% / E0.25人日）
- **出典**: round 12 診断 候補 32・サブエージェント探索 + 直接検証（台帳「supportsArchive doc/code 一致」の concrete 解）

## 背景（なぜ）

archive narrowing に 2 スペリングが存在: export された `supportsArchive()`（archiveStaging.ts:59-65・prod 未使用・archiveFallbackRejection.test.ts のみ）と `handleArchive` の per-method probe（sqliteMessageHandlers.ts:253-265・:257-264 で `entry.method` を確認）。StorageBackend.ts:110,:122-126 のコメントは未使用の supportsArchive を文書化している。将来 subset backend が実装された場合、読み手が信じたスペリングによって挙動が変わる。

## スコープ

- `handleArchive` を `supportsArchive(backend)` 経由 + typed `ArchiveStaging` 呼び出しに統一（archive seam の単一化）
- per-method probe を削除
- StorageBackend のコメントを実装どおりに修正

## 受け入れ基準（BDD）

### シナリオ 1: 非対応 backend は fail-closed（ハッピーパス）
```gherkin
Given IDB / fallback backend
When archive op を dispatch する
then ARCHIVE_UNSUPPORTED_ERROR で拒否される（archiveFallbackRejection テストどおり）
```

### シナリオ 2: narrowing が 1 箇所で決まる（境界）
```gherkin
Given supportsArchive の判定
When handleArchive が実行される
then narrowing は supportsArchive 1 箇所のみで決まり、per-method probe は存在しない
```

## DoD

- [x] narrowing 統一・probe 削除・コメント修正
- [x] archive 関連テスト green（既存 pin 維持）
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし（現行挙動不変）

## 実装メモ（2026-09-12）

- `handleArchive` を `supportsArchive(backend)` 経由（type guard `StorageBackend & ArchiveStaging`）に統一。per-method probe（typeof チェック）を削除
- `ClassBasedBackend` テスト fake に `archiveStatus` を追加（supportsArchive の probe 対象 — 全 14 op は contract 上同時に旅するため部分 fake は非対応 backend 扱い）
- 検証: archiveWireDispatch + archiveFallbackRejection 25 tests green・offscreen 全 77 ファイル 1067 tests green・type-check green・lint 0 errors
