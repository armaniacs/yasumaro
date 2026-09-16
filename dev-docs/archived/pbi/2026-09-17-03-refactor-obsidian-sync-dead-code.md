# PBI: ObsidianSyncService 死コードの裁定（削除）

優先度: 順位 5 / 10（RICE: 4.0 = Reach 5 / Impact 0.5 / Confidence 0.8 / Effort 0.5 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし。ただし後続 PBI pbi/2026-09-17-04-refactor-markdown-entry-ssot.md より先に実施すること（本 PBI で削除するファイルが Markdown 重複5箇所の1つのため）

## ユーザーストーリー
拡張機能を保守する開発者として、`ObsidianSyncService` の死コードを削除してほしい、なぜなら本番の Obsidian 書込は pipeline ステップが単独で所有しており、参照ゼロの `SyncTarget` 実装を残すことは読む人の混乱と markdown サニタイズ重複の増加を招くだけだから。

## 背景（現状と課題）
- `src/background/obsidianSyncService.ts`（約134行、`SyncTarget` インターフェース実装）は本番コードから参照がゼロである。`src/` 全体での `ObsidianSyncService` の言及はテストコードのみ（`src/background/__tests__/obsidianSyncService.test.ts` 全体、`src/background/__tests__/markdownJoinSafety.test.ts` の `ObsidianSyncService` 用ケース）。`src/__tests__/sqlite-security-integrity.test.ts` にも名前の言及があるが、読み取り確認した限りコメントとホワイトリスト値の説明のみで、クラスへの import や実行依存はない。
- 本番の Obsidian 書込は `src/background/pipeline/steps/saveToObsidianStep.ts`（`RecordingOrchestrator` の saveObsidian ステップ、offlineRetry jobKind: 'obsidian_sync' 付き）が単独で所有している。
- なぜ死んでいるか: `SyncTarget` 抽象（sync/syncBatch/testConnection）はバッチ再同期を想定して設計されたが、Obsidian については pipeline ステップと offline retry がその役割を吸収した。`GistSyncTarget` だけがこの抽象の現役利用者であり、`src/dashboard/gistSettings.ts` の接続テスト処理から使用されていることが読み取りで確認できる。
- 判断済みの理由（YAGNI）: 抽象が1実装者しか持たない状態で死コードを維持するコスト（読む人の混乱、markdown サニタイズ重複の増加）が、将来の再利用可能性の価値を上回る。よって削除で裁定する。

## 実装ガイド（着手時点の現状確認済み）

### 削除対象ファイル
- `src/background/obsidianSyncService.ts`（`ObsidianSyncService` クラス本体）
- `src/background/__tests__/obsidianSyncService.test.ts`（同クラス専用のテスト）

### 同時に対応が必要なファイル
- `src/background/__tests__/markdownJoinSafety.test.ts`: 冒頭の import 宣言と、`ObsidianSyncService` 用ケース（title suffix が break out しないことの検証）を削除する。`GistSyncTarget` 用ケースは残す。削除するケースの等価検証は `GistSyncTarget` 側に既に存在するためカバレッジは維持される。削除後に後続 PBI pbi/2026-09-17-04 で統合される formatter テストに吸収されることを、その PBI 側で明記すること。
- `src/background/syncTargets/SyncTarget.ts`: 冒頭の doc comment が「Obsidian, Gist, etc.」と複数先を想定した書き方になっているため、「現時点では `GistSyncTarget` 専用。新しい sync 先を追加する際はこの抽象を再評価する」旨に書き換える。
- `src/background/syncTargets/SyncBatchRunner.ts`: 冒頭の doc comment が「Shared batch-sync policy for SyncTarget implementations (Gist, Obsidian)」と Obsidian を現役扱いしているため、「現時点では `GistSyncTarget` 専用。新しい sync 先を追加する際はこの抽象を再評価する」旨に書き換える。

### 触ってはいけないもの
- `src/background/syncTargets/gistSyncTarget.ts` の `GistSyncTarget` 本体 — 現役の唯一の `SyncTarget` 実装。挙動変更なし。
- `src/background/pipeline/steps/saveToObsidianStep.ts` — 本番の Obsidian 書込所有者。触らない。
- `src/__tests__/sqlite-security-integrity.test.ts` の `obsidian_synced` ホワイトリスト値 — `ObsidianSyncService` クラスへの依存ではなく、SQLite 更新フィールドの整合性検証であるため残す。コメント文中のクラス名言及は、混乱を避ける範囲で文言調整してよい。
- `src/utils/markdownSanitizer.ts` — 削除対象ではない。サニタイザ本体の重複解消は後続 PBI pbi/2026-09-17-04 の範囲。

### 作業順序（推奨）
1. `markdownJoinSafety.test.ts` から `ObsidianSyncService` 用ケースと import を削除（`GistSyncTarget` 用ケースが残ることを確認）
2. `obsidianSyncService.test.ts` と `obsidianSyncService.ts` を削除
3. `SyncTarget.ts` と `SyncBatchRunner.ts` の doc comment を `GistSyncTarget` 専用旨に更新
4. 全検証

### 検証コマンド
```bash
npm run type-check
npm run lint
npm test
grep -rn "ObsidianSyncService" src/  # コメント言及を除き参照ゼロであること
```

---

## BDD受け入れシナリオ
```gherkin
Scenario: ObsidianSyncService への参照が消滅している
  Given 本番コードベース
  When  ObsidianSyncService を grep する
  Then  本番コードからの参照がゼロであり、テストからの参照も消滅している（sqlite-security-integrity.test.ts のコメント言及を除く）ことを検証手順で確認できる

Scenario: GistSyncTarget のバッチ同期が変わらず動く
  Given GistSyncTarget
  When  syncBatch を実行する
  Then  既存の SyncBatchRunner 経路の挙動が変わらない（件数・リトライ・ログ方針が削除前と同一）
```

## 受け入れ基準
- [x] `src/background/obsidianSyncService.ts` が削除されている
- [x] `src/background/__tests__/obsidianSyncService.test.ts` が削除されている
- [x] `markdownJoinSafety.test.ts` の `ObsidianSyncService` 用ケースが削除され、`GistSyncTarget` 用ケースが green のまま残っている
- [x] `SyncTarget.ts` と `SyncBatchRunner.ts` に「現時点では `GistSyncTarget` 専用。新しい sync 先を追加する際はこの抽象を再評価する」旨の doc comment がある
- [x] `grep -rn "ObsidianSyncService" src/` の残存がコメント言及のみである
- [x] 後続 PBI pbi/2026-09-17-04 との順序（本 PBI が先）が守られ、formatter テストへの吸収方針がそちらに引き継がれている
- [x] `npm run type-check` / `npm run lint` / `npm test` が green

## テスト戦略
- 削除に伴うテストの除去（`obsidianSyncService.test.ts` 全体、`markdownJoinSafety.test.ts` の `ObsidianSyncService` 用ケース）と、残存テストの維持（`GistSyncTarget` 用ケース、`gistSyncTarget` 系テストが壊れないこと）
- Scenario 1 は grep による参照ゼロ検証手順で pin する（自動テスト化が難しければ受け入れ時の手動検証＋記録で可）
- Scenario 2 は既存の `GistSyncTarget`・`SyncBatchRunner` 系テストの回帰 green で pin する

## 見積もり
0.5 pt（半日程度）。削除と doc comment 更新のみで、挙動変更を含まないため。

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
