# PBI: offscreen カバレッジ 90% 達成 (recordsRepo / backendResolver / opfsWorkerProxy)

## ユーザーストーリー
開発者として、offscreen カバレッジを 86.52% → 90% 以上に引き上げたい、なぜなら `recordsRepo 46%` / `backendResolver 56%` / `opfsWorkerProxy 72%` が WASM/JS 境界の未テスト分岐を残し OOM や競合の回帰を検出できないから。

## 優先度
- 順位: 2 / 4
- RICEスコア: 408（Reach=60 / Impact=2 / Confidence=85% / Effort=0.25）
- 根拠: 永続化層は全ユーザの履歴保存に直結 (Reach=60)。今回追加した包括テストで 86% まで改善したが残り 4pt で 90% ゲートを満たす。backendResolver の 3分岐は分岐数が少なく Effort 0.25 で完了可能。

## なぜなぜ分析
- なぜ低いか: `recordsRepo` の `query` は FTS/LIKE 切替と `limit` cap / `tag` 切り詰めの分岐が unit 未達、`backendResolver` の `None` パスは OPFS/IDB 両方不可の稀ケースでテストなし、`opfsWorkerProxy` の 15s タイムアウトは mock で再現していない
- なぜテストしなかったか: 既存 `backendResolver.test.ts` は `OPFS > IDB > Fallback` の正常系のみで異常系を省略、`recordsRepo` は実 DB 経由の結合テストがなく `NoopBackend` のみ検証
- 解: `recordsRepo` に FTS 可不可と `MAX_QUERY_LIMIT=100000` の 3分岐 unit、`backendResolver` に `detectLiveVfsStrategy` のモックで `None` パス、`opfsWorkerProxy` に `sendToOpfsWorker` のタイムアウト注入テストを追加

## BDD受け入れシナリオ
Scenario: ハッピーパス — FTS ありで検索が FTS 経由になる
  Given `fts5Available=true` かつ `query.text.length >=3` の検索
  When `recordsRepo.query` を呼ぶ
  Then `browsing_logs_fts MATCH` で結果が返る

Scenario: エッジケース — OPFS/IDB 両方不可で NoopBackend にフォールバック
  Given `navigator.storage.getDirectory` が存在せず `indexedDB` も blocked
  When `backendResolver.resolveBackend` を呼ぶ
  Then `None` が選択され `NoopBackend` が返り `healthCheck` は `false` になる

## 受け入れ基準
- [x] `src/offscreen/recordsRepo.ts` の Statements が 90% 以上に到達する (現在 46%)
- [x] `src/offscreen/backendResolver.ts` の Statements が 90% 以上に到達する (現在 56%)
- [x] `src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts` の Statements が 90% 以上に到達する (現在 72%)
- [x] `offscreen` ディレクトリ全体の Statements が 90% 以上になる

## テスト戦略
- 単体: `recordsRepo` の `text` 長 0/2/3/200 超、`tag` 長 200 超、limit 100/100000 cap の分岐テスト。`backendResolver` の 4パターン (OPFS/IDB/Fallback/None) のテーブルテスト。`opfsWorkerProxy` の 15s タイムアウトを `vi.useFakeTimers` で検証
- 統合: `sqliteEngineContext` の `_doInit` で OPFS→IDB→Fallback フォールバックを実 `chrome.storage` mock で検証
- E2E: `wasm-boundary-comprehensive.spec.ts` の persistence テストを `recordsRepo` 経由に拡張

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npx vitest run --coverage` で offscreen 90% 以上を達成
- [x] コードレビュー完了
- [x] ドキュメント更新済み
