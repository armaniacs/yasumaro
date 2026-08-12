# PBI: ダッシュボード複数タブで AI テスト進捗が干渉しないようにする

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**ステータス**: ❌クローズ（重複・実装済み）
**優先度**: -（対応不要）
**種別**: ✨機能追加（fix：レビュー指摘への対応）

---

## 調査結果：このPBIは既に実装済みである

なぜなぜ分析を20回行う前に、コードベース調査で本PBIが記述する内容が
**commit `889d6a11`（2026-08-05、「Checking Team レビュー残存指摘の PBI 実装」）で
既に完全実装済み**であることが判明した。実装元は
`dev-docs/archived/pbi/2026-08-04-05-fix-dashboard-multitab-interference.md`
（アーカイブ済み＝完了扱い）。

### 実装済みの内容（本PBIの受け入れ基準と1:1で対応）

| 本PBIの受け入れ基準 | 実装箇所 | 状態 |
|---|---|---|
| 進捗メッセージに相関IDが含まれている | `src/dashboard/generalSettings/connectionTests.ts:258` で `runId` を生成し、`RemoteAIService.testConnection(onProgress, runId)` → `onProgress?.({ ..., runId })` (`src/background/ai/RemoteAIService.ts:169-176`) で `AiTestProgress.runId` (`src/background/ai/AIService.ts:32`) に伝播 | ✅ 実装済み |
| 受信側は自分の相関IDのメッセージのみを描画する | `connectionTests.ts:280` の `progressListener` が `message.progress.runId === runId` で自分の実行のみ描画 | ✅ 実装済み |
| 単一タブでの動作が変わらない | `runId` は optional（`?: string`）、後方互換維持 | ✅ 実装済み |
| 関連するテストが通る | `src/background/__tests__/aiTestProgressNotifier.test.ts` に runId 関連のテストあり（同commitで拡充） | ✅ 実装済み |

伝播経路: `connectionTests.ts` (runId生成)
→ `TEST_AI` message (`message.runId`)
→ `createTestAiHandler` (`src/background/handlers/messageHandlers.ts:558`)
→ `AIService.testConnection(onProgress, runId)`
→ `RemoteAIService.testConnection` が `onProgress` 経由で `notifyAiTestProgress`
→ `chrome.runtime.sendMessage({ type, progress: { ..., runId } })`
→ dashboard側 `progressListener` が `runId` 一致のみ描画。

### なぜ重複PBIが作られたか（根本原因）

1. **Why 1**: なぜ実装済みの内容が新規PBIとして再提起されたか
   → 2026-08-12時点のレビュー（Checking Team等）が現在のコードを見て
     「相関IDが無い」と再度指摘したため。
2. **Why 2**: なぜレビューは実装済みと気づかなかったのか
   → 実装は2026-08-05のPBI群（`2026-08-04-05-*`）の一部として行われ、
     その成果物は `dev-docs/archived/pbi/` に移動済みで、
     `pbi/00-INDEX.md` などの「現在有効なPBI一覧」からは見えない状態だった。
3. **Why 3**: なぜアーカイブされたPBIの内容が再発見されにくいのか
   → アーカイブが「完了記録」として扱われ、実装済み機能の一覧としては
     検索されない運用になっている（PBIタイトルにも "correlation" 等の
     検索しやすいキーワードが統一されていない）。
4. **Why 4**: なぜ新規PBI作成前にコードを確認しなかったのか
   → レビュー指摘からPBI起票までのプロセスに「現状コード確認」の
     ステップが必須化されていない。
5. **根本原因**: レビュー指摘 → PBI起票のワークフローに、
   「対象コードが既に対応済みでないかの一次確認」が組み込まれておらず、
   アーカイブ済みPBIが検索対象外になっているため、同一指摘が
   複数回PBI化されるリスクがある。

### 対応

- 本PBIファイルはクローズとし、`dev-docs/archived/pbi/` には移動しない
  （元々不要だったタスクのため、archiveではなく本ファイルに調査結果を残す）。
- 今後のレビュー起点PBI作成では、起票前に対象シンボル（本件なら `runId`,
  `AI_TEST_PROGRESS`）を `grep -r` するステップを徹底する。

## 非スコープ

- マルチウィンドウUIの新規実装（今回の調査範囲外、必要なら別途起票）
