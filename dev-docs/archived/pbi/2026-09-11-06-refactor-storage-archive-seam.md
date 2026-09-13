# PBI: StorageBackend から archive seam を分離し ArchiveStaging に移す

## ユーザーストーリー

開発者として、StorageBackend の 30 メソッドから 14 の archive 操作を専用 ArchiveStaging モジュールの背後に移したい、なぜなら現状は 1 つの adapter しか実装しない archive 群が seam を跨いで漏れており、接口が肥大化してテスト対象が定まらないから。

## 優先度

- 順位: 3 / 5
- RICEスコア: 12.8（Reach=20 / Impact=2 / Confidence=80% / Effort=2.5人日）
- 根拠: Strong 判定。接口縮小（30→16）と局所性向上の効果が大きい。Effort は 14 操作の移設＋呼び出し元更新で中。依存なし。

## ビジネス価値

- StorageBackend が core read/write に専念し、新規 adapter 実装者の学習コストが下がる
- archive 系欠陥が ArchiveStaging 1 接口に集約され、テストが 1 接口を叩けば済む
- archive 機能追加時に触る範囲が明確になり、core 読み書きへの波及がなくなる

## BDD受け入れシナリオ

```gherkin
Scenario: アーカイブ作成・復元が ArchiveStaging 経由で完走する
  Given アーカイブ対象の閲覧ログが存在する
  When 呼び出し元が ArchiveStaging 経由でアーカイブ作成と復元を要求する
  Then プレビュー・作成・復元・パージの一連フローが完走する
  And 従来の StorageBackend 直結経路と結果が同一である

Scenario: archive 未対応 backend は明確に拒否される
  Given archive を実装しない StorageBackend adapter がある
  When ArchiveStaging 経由で archive 操作を要求する
  Then ARCHIVE_UNSUPPORTED 相当の明確なエラーが返る
  And core の読み書きには影響しない
```

## 受け入れ基準

- [x] 14 の archive 操作が ArchiveStaging モジュールの背後にある（`src/offscreen/archiveStaging.ts` 新設: `ArchiveStaging` + `supportsArchive()`）
- [x] StorageBackend 接口が core read/write のみに縮小している（Mutable から 14 署名・NoopBackend の 14 余分・`archiveUnsupported` 共有 stub を除去）
- [x] archive 呼び出し元が ArchiveStaging 経由に置換されている（`handleArchive` が per-method narrow + fail-closed。呼び出し元は従来から wire-table 経由で backend 直呼びは無し）
- [x] archive 未対応 adapter の stub が共有化されている（stub 28 件を削除し dispatch 1 箇所の fail-closed に統一 — round 4 PBI-08 の `ARCHIVE_UNSUPPORTED_ERROR` 定数は維持）
- [x] `npm run type-check` と archive 関連テスト・E2E が green（type-check exit 0・offscreen 全 978 green。E2E は headless のため vitest + parametric で代替）

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- アーカイブ作成 → 復元 → パージの一連フロー（既存 archive E2E spec を ArchiveStaging 経由で実行）

### 統合テスト

- ArchiveStaging seam 越しの 14 操作テスト（公開関数名・noRetry 契約・応答フィールド不変）
- 未対応 backend の拒否テスト（14 メソッド × 非対応 adapter）

### 単体テスト

- archiveWireTable との対応テスト（新 op は行追加のみで動くこと）
- StorageBackend 縮小後の型アサート（archive メソッド不在）

## 実装アプローチ

- **Outside-In**: ArchiveStaging seam 越しの E2E から開始し、失敗を確認してから実装
- **Red-Green-Refactor**: seam 定義 → 14 操作移設 → 呼び出し元置換 → StorageBackend 縮小の順
- **リファクタリング**: green になるたびに重複 stub を共有化

## 見積もり

M（2.5人日。要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし。ただし round 3 の archiveWireTable（14 op の codec テーブル）と round 4 PBI-08 の `archiveUnsupported()` 共有 stub を前提とする
- テスタビリティ: ArchiveStaging を差し替え可能な seam にし、E2E は実 backend・単体は fake で実行
- 非機能要件: 公開 14 関数名・noRetry 契約・応答フィールドは不変（round 3 の不変条件を維持）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# archive 操作の実装・利用箇所を探す
grep -rn "archive" src/offscreen/StorageBackend.ts | head -30
grep -rn "ARCHIVE_WIRE_TABLE\|ARCHIVE_DISPATCH" src/messaging/ --include="*.ts" -l
grep -rn "archiveUnsupported" src/ --include="*.ts" -l
```

### 実装手順

1. 対象 6 ファイルの archive 関連メソッド棚卸し（StorageBackend.ts / OpfsWorkerBackend.ts / IdbVfsBackend.ts / FallbackStorageAdapter.ts / backendResolver.ts / archiveWireTable.ts）
2. `ArchiveStaging` モジュール新設（14 操作の専用 seam）
3. 呼び出し元を ArchiveStaging 経由に置換
4. StorageBackend から archive 群を除去（core read/write のみ）
5. 未対応 stub を `archiveUnsupported()` に統一 → type-check → archive E2E green

### 落とし穴

- archive token の scope binding（round 4 PBI-01 の 4 subtype 拡張）を壊さないこと
- `archive_preview` 型の `cutoffDate`（round 2 で修正済み）の欠落を再発させないこと
- 1 adapter しか実装しない操作の capability クエリは呼び出し経路がないため導入しない（round 4 PBI-08 の判断を維持）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（Y2 更新 4 件 + dispatch fail-closed 3 件 + 既存 wire 22 件）
- [x] コードレビュー完了（自律レビュー: backend 直呼び 0 件・`this` bind 維持・token scope は worker 側で不変）
- [x] ドキュメント更新済み（ARCHITECTURE_MAP Quick Index に ArchiveStaging 行を追加）
- [x] ロールバック手段の検討（git revert で可能・振る舞い不変のため feature flag 不要）

## 実装メモ（2026-09-11 autonomous-task-closer）

- 削除: IdbVfs/Fallback の stub 28 件 + NoopBackend の 14 余分 + `archiveUnsupported()` 共有関数（利用者ゼロに）。`ARCHIVE_UNSUPPORTED_ERROR` 定数は維持（Y2 が定数を pin）。
- 設計判断: `supportsArchive()` は全 14 一括 probe だが dispatch は per-method チェック — 部分実装 backend に未実装 op を要求しない。`this` bind（e2e 回帰の WHY）は維持。
- Y2 テストを新契約に更新（所有の不在 + narrow + 定数 pin）。dispatch fail-closed 3 件を `archiveWireDispatch.test.ts` に追加。
- なぜなぜ: なぜ stub が 28 件も残ったのか → round 4 で共有 stub 化はしたが「除去」は dispatch が `backend[method]` 型を要求するため不可だった → 解: dispatch を narrow + fail-closed に変えてから除去（順序が逆では型が壊れる）。
