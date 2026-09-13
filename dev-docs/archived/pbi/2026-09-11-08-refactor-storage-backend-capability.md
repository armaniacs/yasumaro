# PBI 08: StorageBackend の archive 不可 stub 28 重複を capability seam に統合

## ユーザーストーリー

storage backend を保守する開発者として、「archive/backup/audit は OPFS 必須」という政策が 1 箇所にあり、新しい backend や op 追加時に stub を 14 箇所書き写す必要がない状態を望む。なぜなら現状は同一文言 stub が 28 箇所（+6）に複製され、test が文言を pin して 1 修正が 34 箇所に波及するから。

## 優先度

- 順位: 08 / 9
- RICE スコア: 9.6（Reach=3 / Impact=2 / Confidence=80% / Effort=0.5 人週）
- 根拠（2026-09-11 診断）:
  - `src/offscreen/StorageBackend.ts:69-122` — interface 29 メソッドのうち 14 が 3 backend 中 2 つ（Idb/Fallback）で非対応
  - `src/offscreen/IdbVfsBackend.ts:276-330` — 14 行の `Archive requires OPFS storage.` stub + `:273` backup + `:332-334` restore
  - `src/offscreen/FallbackStorageAdapter.ts:57-111` — 14 行同一 stub + `:54` backup + `:114` restore + `:128-132` audit 2 件
  - `src/offscreen/__tests__/archiveFallbackRejection.test.ts:8-14` — 正確な文字列を pin（文言 1 修正が 34 箇所に波及）
  - deletion test: 政策（「archive は OPFS でのみ可能」）を 1 箇所に置けば stub の山は消える = 正の集約

## BDD 受け入れシナリオ

```gherkin
Scenario: IdbVfsBackend で archive 呼び出しが拒否される
  Given アクティブ backend が IdbVfsBackend
  When  archiveCreate を呼ぶ
  Then  capability 検査が失敗し、共有メッセージ（1 箇所定義）のエラーが返る

Scenario: OPFS backend では archive が実行される
  Given アクティブ backend が OpfsWorkerBackend
  When  archiveCreate を呼ぶ
  Then  通常どおり実行される

Scenario: stub 文言の修正が 1 箇所で完結する
  Given 共有 archiveUnsupported() ヘルパ
  When  エラー文言を変更する
  Then  変更箇所は 1 ファイル 1 箇所のみ
```

## 受け入れ基準

- [x] capability クエリ（例: `supportsArchive()`）または等価な 1 seam を `StorageBackend` interface に追加
- [x] 共有 `archiveUnsupported()` ヘルパ + メッセージ定数 1 箇所に統合し、Idb/Fallback/Noop の 28+6 stub を削除
- [x] `archiveFallbackRejection.test.ts` は定数参照で pin する（文字列リテラル直書きをやめる）
- [x] 全 3 backend + Noop で archive 系 op の拒否/実行が既存テストどおり
- [x] offscreen 関連テスト green

## テスト戦略

- 既存: archiveFallbackRejection.test（14 メソッド × 2 backend）を定数参照に更新して green
- drift ガード: StorageBackend の archive 系メソッドが全て capability 経由であることを型レベルで固定（可能なら）

## 見積もり

S-M（0.5 人週）。種別: refactor。

## 実装アプローチ

1. `StorageBackend.ts` に capability クエリ + 共有ヘルパを追加
2. IdbVfsBackend / FallbackStorageAdapter / NoopBackend の stub を置換
3. test を定数参照に更新
4. （任意）facets 分割は本 PBI では行わず capability 統合のみ — facets は将来の archive 改修時に再評価

## 実装メモ（2026-09-11）

- `StorageBackend.ts` に `ARCHIVE_UNSUPPORTED_ERROR` / `BINARY_BACKUP_UNSUPPORTED_ERROR` / `BINARY_RESTORE_UNSUPPORTED_ERROR` / `AUDIT_LOG_UNSUPPORTED_ERROR` 定数 + `archiveUnsupported()` 共有 stub を 1 箇所で定義。
- IdbVfsBackend（14+2）と FallbackStorageAdapter（14+2+audit 2）の stub を共有ヘルパ/定数参照に置換（28+6 → 0 重複）。NoopBackend は NOT_INITIALIZED（別契約）のため据え置き。
- `archiveFallbackRejection.test.ts` は定数参照で pin（文言 1 修正が 1 箇所で完結）。
- スコープ調整: `supportsArchive()` capability クエリは追加しなかった — 呼び出し側が pre-check する経路が現時点で無く、「1 adapter = 仮の seam」原則に従い stub 統合のみで効果を得る。facets 分割も将来の archive 改修時に再評価。
