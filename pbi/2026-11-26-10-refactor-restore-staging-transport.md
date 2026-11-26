# PBI: OPFS 専用の restore staging メソッドを共通 StorageBackend から分離インターフェースへ移す

## ユーザーストーリー
保守担当者として、OPFS 専用メソッドを共通 StorageBackend インターフェースから外したい、なぜなら現行は 4 メソッドが共通 `Mutable` に追加され、OPFS を使わない 3 バックエンド (IDB / Fallback / Noop) に「常に RESTORE_STAGING_UNSUPPORTED_ERROR を返すだけの stub」が散在する。プロジェクト自身が archive グループで同一問題を分離インターフェース (`ArchiveStaging` + `supportsArchive`) で解決済みであり、次の OPFS 専用輸送追加のたびに stub がバックエンド数分膨らむ構造を、archive 前例の踏襲で断ちたい。

## ユーザーへの背景 (レビュー報告書: テーマ 1 [影響度: 中 | 難易度: 低]、Quick Win)
- 現状: `src/offscreen/StorageBackend.ts:133-136` (共通インターフェースへの 4 メソッド追加)、`StorageBackend.ts:332-339` (NoopBackend stub)、対比として `StorageBackend.ts:137-139` (archive は入れるなという規約コメント)、`src/offscreen/IdbVfsBackend.ts:292-306`、`src/offscreen/FallbackStorageAdapter.ts:79-92` (byte-identical な unsupported stub 2 組)
- 解決済みの対比: `src/offscreen/archiveStaging.ts:43-67` (`ArchiveStaging` + `supportsArchive`)、使用側 `src/offscreen/sqliteMessageHandlers.ts:415-424`

## ビジネス価値
- 次に OPFS 専用輸送 (分割作成 staging 等) を追加する際、「4 バックエンド × stub」の追加コストが発生しない
- 「実装があるのに動かない」メソッド (fail-closed だが形だけある) の消失で、読み手の誤解を防ぐ
- 測定方法: StorageBackend から restore staging メソッドが消え、分離インターフェース + narrowing で同等の fail-closed (RESTORE_STAGING_UNSUPPORTED_ERROR、文言・型は現状のまま) が保たれること

## BDD受け入れシナリオ

```gherkin
Scenario: OPFS 以外のバックエンドは fail-closed を維持する
  Given IDB / Fallback バックエンドに対して restore staging メソッドが呼ばれた
  When supportsRestoreStaging の narrowing が行われる
  Then RESTORE_STAGING_UNSUPPORTED_ERROR が返される (現行と同一文言・型)
  And StorageBackend 共通インターフェースに restore staging メソッドは存在しない

Scenario: OPFS バックエンドは通常どおり動作する
  Given OpfsWorkerBackend が使用される
  When restore staging の 4 メソッドが呼ばれる
  Then 現行と同一の挙動で動作する (テストは無変更で緑)
```

## 受け入れ基準
- [ ] `src/offscreen/restoreStagingTransport.ts` (新規) に `RestoreStagingTransport` インターフェース 4 メソッド + `supportsRestoreStaging` narrowing (archive の hasArchiveCapability と同じ単一判定) が実装されている
- [ ] `StorageBackend` の `Mutable` から 4 メソッドが削除され、NoopBackend stub (332-339) が消えている
- [ ] `IdbVfsBackend.ts:292-306`、`FallbackStorageAdapter.ts:79-92` の stub が削除されている
- [ ] `recordsRepo.ts` の該当委譲が narrowing 付きに変更され、narrowing 外は RESTORE_STAGING_UNSUPPORTED_ERROR で fail-closed (文言・型は現状のまま使い回す)
- [ ] 既存の restore staging テスト群 (restoreStagingHandlers、restoreChunkedTransport など) が無変更で緑
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし (復元 E2E が既存経路を通る)

### 統合テスト
- restoreChunkedTransport / restoreStaging 系 (無変更で緑)、OPFS 以外バックエンドの fail-closed

### 単体テスト
- supportsRestoreStaging narrowing の単体 (OPFS: true、他: false)

## 見積もり
S (3 SP、要チームでの見積もり)

## 技術的考慮事項
- 出所: plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md テーマ 1 [影響度: 中 | 難易度: 低]、ロードマップ 1 位 (Quick Win)
- 外部挙動は完全に不変 (呼び出し側 recordsRepo の委譲は narrowing 後の fail-closed で同じエラー文言を返す。IdB/Fallback はそもそも未初期化前提の destructive op なので narrowing 内で try/catch を維持する)
- archive パターンの踏襲 (単一判定): `supportsRestoreStaging(b: StorageBackend): b is StorageBackend & RestoreStagingTransport` = `b instanceof OpfsWorkerBackend`

## 実装者向け注記

### 現状コードの確認
(着手前に必ず実行すること)
```bash
grep -n "restorePrepareIncoming\|restoreAppend\|restoreCommit\|restoreAbort" src/offscreen/StorageBackend.ts src/offscreen/IdbVfsBackend.ts src/offscreen/FallbackStorageAdapter.ts src/offscreen/recordsRepo.ts | head -20
grep -n "supportsArchive\|ArchiveStaging" src/offscreen/archiveStaging.ts src/offscreen/sqliteMessageHandlers.ts | head -10
```

### 実装手順
1. `restoreStagingTransport.ts` 新設 (インターフェース + narrowing)
2. `StorageBackend.ts` の Mutable から 4 メソッド削除、NoopBackend stub 削除
3. `IdbVfsBackend.ts` / `FallbackStorageAdapter.ts` の stub 削除
4. `recordsRepo.ts` の委譲を narrowing 付きに変更
5. 対応テストの確認 (無変更で緑のはず)

### 落とし穴
- 委譲側の fail-closed文言・型は現状のまま使い回す (変更するとユーザーに見える文言が変わる)
- narrowing は instanceof 単一判定 (archive 前例) を踏襲する。複数条件を書かない
- git 操作禁止。実時間待ち禁止

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす (統合/単体)
- [ ] コードレビュー完了
- [ ] リファクタリング完了 (グリーン後)
- [ ] ドキュメント更新の要否判定: 内部構造の変更でユーザーに見える挙動不変のため、docs 更新は不要
