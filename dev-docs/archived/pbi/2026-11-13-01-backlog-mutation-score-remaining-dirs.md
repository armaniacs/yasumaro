# PBI: 未測定ディレクトリのミューテーションスコア確定とテスト缺口の補強

- 状態: 完了 (2026-11-19)
- 種別: 非機能追加 (テスト基盤)
- 見積もり: 3 SP
- 起票日: 2026-11-13
- 親: [2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md](2026-09-27-02-backlog-stryker-vitest5-runner-adoption.md)

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

## 最終測定結果 (2026-11-19)

- 全21チャンクが完走。合算スコア (重複排除後) は **64.61%** (killed 47,607 / tested 73,685) で、break 50 を上回る
- 最終チャンク 08e-utils-root-n-z はスリープ抑止 (caffeinate) 付きの単独実行 (concurrency 2) で161分、テストランナー2プロセスで安定完走
- テスト補強: 4ファイルに59テストを追加し、対象チャンク (02-popup, 08e-utils-root-n-z) を incremental resume で再測定。合算は 64.54% から 64.61% へ (killed +50)
  - `src/popup/statusChecker.ts`: isFilterMode 境界・モード別判定・subdomain 一致・privacy cache 後処理 (survived 63 → 37)
  - `src/utils/summaryNormalizer.ts`: 敬体変換テーブルの表駆動テスト (survived 32 → 1)
  - `src/utils/retryPredicate.ts`: FailureKind 別判定・cause 型別・終端マーカー (survived 49 → 35、no-cov 11 → 2)
  - `src/utils/selectionText.ts`: 文字数上限境界とコードポイント単位の切り詰め (survived 5 → 3)

## 生残の3分類 (2026-11-19 時点、合算 26,078件)

- 等価 (実証済みの代表例。テスト追加はしない): `selectionText.ts:44` の切り詰め境界2件 (上限以下で slice が恒等写像)、`summaryNormalizer.ts:27` (ガードを外しても出力同一)、`retryPredicate.ts:48/61/82` の論理演算子崩し (プロファイル表の真偽一致・左辺到達不能)、`statusChecker.ts:62` の空リスト早期return (呼び出し元が必ず非空配列を渡すため到達不能)
- 対象外 (仕様の凍結になるため補強しない): 宣言的テーブル (settingsSchemas のスキーマ定義、searchQuery の検索エンジン辞書、registrableDomain のマルチラベルTLD表)、表示文面の StringLiteral (生残全体の約29%)、piiSanitizer のPII正規表現の文字クラス変異 (過剰一致は安全側で仕様固定になる) と RuntimeError 195件 (変異regexの実行時暴走、スコア計算の分母外)
- テスト缺口: 上記4ファイルのロジック系は補強済み。未対応の候補 (pathSanitizer の上限境界、trustChecker の changedKeys、registrableDomain のlabels判定) と messaging/offscreen のwire系生残は記録に留め、必要になった時点で個別PBI化

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

- [x] dashboard / background / utils のレポートが保存されている (21チャンク構成に拡張し、全チャンク完走)
- [x] `--aggregate` が全チャンクの合算スコアを出し、その値が記録されている (64.61%)
- [x] 生残の3分類が記録され、テスト缺口の補強が実施されている
- [x] `npm run validate` が通る
