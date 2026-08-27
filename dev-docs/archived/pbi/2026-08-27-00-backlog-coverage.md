# Backlog: 2026-08-27 低カバレッジ 4分類を 90% 以上に

## 概要
`npx vitest run --coverage` で Statements 92.1% は達成しているが、分類別で 90% 未満が 4件残る。これらを 90% 以上に引き上げ、全分類で 90% ゲートを満たす。

## RICE スコア表
| 順位 | PBI | 分類 | 現状 Statements | Reach | Impact | Confidence | Effort | RICE | 根拠 |
|------|-----|------|---------------|-------|--------|------------|--------|------|------|
| 1 | 09-test-content-coverage-90 | content | 72.94% | 80 | 2 | 80% | 0.3 | 427 | 全ユーザの閲覧処理に影響。extractor/visitGate の DOM依存を E2E で補完 |
| 2 | 10-test-offscreen-coverage-90 | offscreen | 86.52% | 60 | 2 | 85% | 0.25 | 408 | 永続化層の未達分岐が OOM/競合の回帰を隠す |
| 3 | 11-test-offscreen-engine-context-coverage-90 | offscreen/sqliteEngineContext | 86.85% | 40 | 1.5 | 80% | 0.2 | 240 | WASM初期化競合の未達が残る |
| 4 | 12-test-background-migration-coverage-90 | background/migration | 87.82% | 30 | 1 | 75% | 0.15 | 150 | 初回 1 回のみのマイグレーション、影響小 |

## 依存関係
- 全 4件は触るディレクトリが異なるため互いに独立、並列実行可能
- 09 (content) が最も Effort 大のため先に着手し、残り 3件は 09 と並列で進められる

## なぜなぜ分析サマリ
- content: `extractor.ts` の `requestAnimationFrame` バッチが jsdom 未実行、`visitGate` の threshold 判定が clock 注入なしでテスト不能 → E2E + 注入テストで解消
- offscreen: `recordsRepo` の FTS/LIKE 切替と `backendResolver` の None パスが未達 → テーブル駆動テストで解消
- engineContext: `opfsWorkerProxy` の 15s タイムアウトが未達 → fakeTimers で解消
- migration: `migrationState` の storage undefined 分岐が未達 → InMemory adapter で解消

## 推奨着手順
- `09,10,11,12` を並列で着手可能。RICE 順では `09 → 10 → 11 → 12`。
- ファイルが重ならないため 4件を同一メッセージ内で並列にサブエージェント起動可能 (worktree 分離不要)。

## 出力ファイル
- `pbi/2026-08-27-09-test-content-coverage-90.md`
- `pbi/2026-08-27-10-test-offscreen-coverage-90.md`
- `pbi/2026-08-27-11-test-offscreen-engine-context-coverage-90.md`
- `pbi/2026-08-27-12-test-background-migration-coverage-90.md`
