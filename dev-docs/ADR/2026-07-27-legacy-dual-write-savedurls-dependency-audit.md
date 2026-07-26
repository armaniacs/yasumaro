# ADR: レガシー dual-write (`savedUrlsWithTimestamps`) の依存関係調査

**作成日**: 2026-07-27  
**ステータス**: 承認済み  
**関連PBI**: [2026-07-26-13-fix-legacy-dual-write-default](../../pbi/2026-07-26-13-fix-legacy-dual-write-default.md)（完了時は [dev-docs/archived/pbi/](../../archived/pbi/) 参照）

## 背景

PBI-13 は `LEGACY_DUAL_WRITE_ENABLED` のデフォルトを `true` から `false` に変更し、`savedUrlsWithTimestamps` への chrome.storage.local 書き込みを停止することを検討していた。デフォルト変更前に、SQLite 単独で全ての依存機能が充足できるかを確認する必要があった。

## 調査対象

`savedUrlsWithTimestamps` を参照するプロダクションファイル 9 件を調査した。

| # | ファイル | 用途 | SQLite 代替可能性 |
|---|---|---|---|
| 1 | `src/background/migrationService.ts` | 旧 `savedUrlsWithTimestamps` から SQLite へのマイグレーション読み取り | 移行完了後は不要。代替可能。 |
| 2 | `src/background/pipeline/RecordingPipeline.ts` | コメント参照のみ（直接の読み書きなし） | 該当なし |
| 3 | `src/background/pipeline/steps/saveMetadataStep.ts` | `savedUrlsWithTimestamps` への書き込み（dual-write 本体） | `LEGACY_DUAL_WRITE_ENABLED=false` でスキップされる。代替可能。 |
| 4 | `src/dashboard/panels/asyncData/historyPanel.ts` | ストレージ変更検知 + `getSavedUrlEntries()` 経由で履歴表示 | **要改修**。`savedUrlsWithTimestamps` 変更イベントを監視し、エントリ配列から履歴を描画している。 |
| 5 | `src/utils/optimisticLock.ts` | JSDoc 例示のみ（実際の参照なし） | 該当なし |
| 6 | `src/utils/storage/savedUrlStore.ts` | `savedUrlsWithTimestamps` の読み書き・クリーンアップ | **要改修**。URL エントリの追加・更新・削除・定期クリーンアップを直接行っている。 |
| 7 | `src/utils/storage/settingsStore.ts` | コメント参照のみ（設定保存失敗時のクリーンアップ対象として言及） | 該当なし |
| 8 | `src/utils/urlMetadata.ts` | URL 単位のメタデータ（recordType, content, tags, tokens, bytes 等）を `savedUrlsWithTimestamps` エントリに書き込む | **要改修**。31 箇所で楽観的ロックを使い、URL エントリのプロパティとしてメタデータを保持している。 |
| 9 | `src/utils/urlStorage.ts` | `savedUrlsWithTimestamps` エントリの取得・タイムスタンプ更新・LRU 管理 | **要改修**。9 箇所で読み書きしており、重複チェック・履歴表示の基盤になっている。 |

## 結論

**SQLite 単独では `savedUrlsWithTimestamps` の機能を完全に代替できない。**

`savedUrlsWithTimestamps` は単なる「履歴表示用リスト」ではなく、以下の役割を担っている。

1. **URL 単位メタデータストア**: `urlMetadata.ts` が recordType、content、tags、各種 token/byte カウント等を `SavedUrlEntry` オブジェクトのプロパティとして保存している。
2. **重複チェック・LRU 管理の基盤**: `urlStorage.ts` が `savedUrlsWithTimestamps` を読み込んで URL→timestamp マップを構築し、重複判定に使用している。
3. **履歴パネルのデータソース**: `historyPanel.ts` が `savedUrlsWithTimestamps` の変更イベントを検知して即座に UI を更新している。

これらを SQLite だけに置き換えるには、少なくとも以下の改修が必要となる。

- `urlMetadata.ts` の全メタデータ書き込みを SQLite 経由の読み書きに変更
- `urlStorage.ts` の重複チェック・LRU ロジックを SQLite クエリベースに変更
- `historyPanel.ts` を SQLite 変更通知（またはポーリング）ベースに変更
- 上記に伴うテストの広範な更新

これらは PBI-13 のスコープを大きく超える大規模リファクタリングである。

## 決定

- **Task 1（chrome.storage.local 書き込み失敗時のリカバリキュー）**: 実施する。これにより、保存失敗時のデータ消失リスクは軽減される。
- **Task 2（依存調査）**: 本 ADR で記録する。
- **Task 3（`LEGACY_DUAL_WRITE_ENABLED` のデフォルトを `false` に変更）**: **実施しない**。`savedUrlsWithTimestamps` を完全に代替するには大規模な改修が必要であり、現時点では既存機能を損なうリスクが高すぎる。

## 今後の方針

`savedUrlsWithTimestamps` から SQLite への完全移行を検討する場合は、別 PBI として以下を順に実施すること。

1. `urlMetadata.ts` のメタデータ書き込みを SQLite ベースに段階的に移行
2. `urlStorage.ts` の重複チェック・LRU 管理を SQLite クエリに置き換え
3. `historyPanel.ts` のデータ取得・変更通知を SQLite ベースに変更
4. 全ての移行が完了した上で `LEGACY_DUAL_WRITE_ENABLED` のデフォルトを `false` に変更

本 PBI では、回収キューの追加により「片側の書き込み失敗時のデータ消失」という元の問題は緩和される。
