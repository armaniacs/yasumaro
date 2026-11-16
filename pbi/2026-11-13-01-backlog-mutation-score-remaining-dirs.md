# PBI: 未測定ディレクトリのミューテーションスコア確定とテスト缺口の補強

- 状態: 未着手
- 種別: 非機能追加 (テスト基盤)
- 見積もり: 3 SP
- 起票日: 2026-11-13
- 親: [2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md](../dev-docs/archived/pbi/2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md)

## 背景

Stryker 10.1.1 の採用検証で、全量単一実行は 75,296 ミュータント・10時間超となり端末スリープで中断して完走しないことが判明した。`scripts/mutation-chunks.mjs` による9分割の合算へ切り替えたが、`src/dashboard/**` だけで 23,743 ミュータント (実測 4時間18分で24%) あり、dashboard / background / utils を同一の全ミュータント構成で測ると数十時間を要する。

測定済み5チャンク (constants/privacy, popup, messaging, content, offscreen) の合算は 67.87% (killed 9,357 / tested 13,787) で、thresholds.break 50 を上回る。採用判断には足りるが、生残の理由分類とテスト缺口の補強は未完了。

## 受け入れシナリオ

### S1: 未測定ディレクトリのスコアが記録される

Given 測定済みが 5 チャンクのみの状態で
When `node scripts/mutation-chunks.mjs` を実行し dashboard / background / utils を測る
Then 各チャンクのレポートが `reports/mutation/chunks/` に保存され、`--aggregate` が全9チャンクの合算スコアを出す

### S2: 生残の理由分類が測定量に追従する

Given 生残ミュータントが存在する
When `node scripts/mutation-chunks.mjs --survivors` を実行する
Then ファイル別・mutator別の内訳が出て、等価 / テスト缺口 / 対象外の3分類に振り分けられる

### S3: テスト缺口が補強される

Given `src/popup/statusChecker.ts` の `isFilterMode` 境界と空ドメインリスト早期returnに生残がある
When 当該境界のテストを追加する
Then 再測定で当該ミュータントが killed になる

## 対象

## 検証ルール (2026-11-16 追記)

- チャンク分割: 測定単位が大きすぎて中断すると全損になるため、src配下を21チャンクに分割した (`scripts/mutation-chunks.mjs` の CHUNKS 表)。1単位は3〜8kミュータント
- 合算は重複排除: Strykerの `incremental` が後続チャンクのレポートに既測ミュータントを持ち越すため、単純合計は二重計数になる。`--aggregate` は (file, mutator, 位置, 置換) の一致で一意化し、最良ステータスを採用する
- 測定と1116b実装の前後関係: 一部チャンクの測定後に1116b (async/await化・バッチ化) が対象ソースを変更した。変更は意味保存のリファクタであり、合否判定 (break 50 に対する60%台) を覆す規模ではないため再測定は行わず、ここに記録する

- 未測定: `src/dashboard/**`, `src/background/**`, `src/utils/**` (a-l / m-z の2分割)
- テスト缺口: `src/popup/statusChecker.ts` の `isFilterMode` / `findMatchedPattern` / `domain_whitelist || []` 既定値
- 分類記録: `src/messaging/{validators,sqliteWireTable,archiveWireTable}.ts`、`src/offscreen/{opfsWorker,migrationBackup}.ts`

## 実行手順

1. `node scripts/mutation-chunks.mjs --only 06-dashboard` を夜間等の長時間枠で実行し、レポートを保存する
2. 同様に 07-background / 08-utils-a-l / 09-utils-m-z を順に実行する (完了チャンクは自動スキップ)
3. `--survivors` の出力を3分類 (等価 / テスト缺口 / 対象外) に振り分け、テスト缺口から順に補強する
4. 補強後に対象チャンクを再実行し、`--aggregate` の変化を記録する

## 制約

- thresholds は変更しない (high 80 / low 60 / break 50)
- `ignoreStatic: true` と `coverageAnalysis: perTest` は維持する。静的ミュータント除外は実行時間の98%を占めていたため
- 等価ミュータントを killing するためのテストは追加しない (挙動差がないものを固定すると仕様の凍結になる)

## 完了条件

- [ ] dashboard / background / utils の4チャンクのレポートが保存されている
- [ ] `--aggregate` が全9チャンクの合算スコアを出し、その値が記録されている
- [ ] 生残の3分類が記録され、テスト缺口の補強が実施されている
- [ ] `npm run validate` が通る
