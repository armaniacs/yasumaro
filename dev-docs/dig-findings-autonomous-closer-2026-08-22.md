# なぜなぜ分析 — 2026-08-22 autonomous-task-closer 洗い出し

## 現象 1: src/dashboard/trancoConsent.ts がコンパイルエラー

`getSettings` の import が削除されているのに、4 箇所で `await getSettings()` が残存し、`npm run type-check` が失敗する。

### 5 Whys
1. なぜコンパイルエラーなのか → `import { getSettings, ... } from '../utils/storage/settingsStore.js'` から `getSettings` が消えたが、呼び出しが残った
2. なぜ import が消えたのか → PBI03 の SettingsRepository 移行で `settingsRepository` を import する変更が行われたが、呼び出し側の置き換えが未完で中断された
3. なぜ置き換えが中断されたのか → セッションが「再開」前に終了し、作業中の diff がコミットされずに残った
4. なぜコミットされなかったのか → type-check 失敗のまま放置され、検証ゲートを通さなかった
5. なぜゲートを通さなかったのか → 作業の途中でセッションが切れた（外部要因）

→ 解: `getSettings()` を `settingsRepository.getAll()` に置き換え、type-check / test / build を通してコミットする。

## 現象 2: dev-docs/plans/2026-08-22-pbi02-diagnostics-panel-snapshot-design.md が残存

対応 PBI `pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md` は既に `dev-docs/archived/pbi/` へ移動されているが、設計 plan が `dev-docs/plans/` に残っている。

### 5 Whys
1. なぜ plan が残っているのか → PBI 完了時に design plan も archived/plans へ移動されなかった
2. なぜ移動されなかったのか → 完了チェックリストに「対応 plan のアーカイブ」が明示されていなかった / 実装 plan はアーカイブされたが設計 planは別ファイルとして見落とされた
3. なぜ見落とされたのか → 実装 plan (`...-plan.md`) と設計 plan (`...-design.md`) が別ファイルになっており、PBI 完了時の整理で design 側が対象外になった
4. なぜ別ファイルになったのか → 設計書として独立した design doc を残す運用だったが、完了時の運用ルールが design doc にも適用される明記がなかった
5. なぜ明記がなかったのか → INDEX の運用ルールが「実装計画」のアーカイブまでしか書いていない

→ 解: 設計 plan を `dev-docs/archived/plans/` へ `git mv` し、今後は PBI 完了時に design doc も含めてアーカイブする運用を INDEX に明記する（既存ルールの補足）。

## 現象 3: pbi/2026-08-22-04-backlog-ai-test-progress-client.md が未完了として残存

PBI ファイルが存在し、チェックボックスが未チェック。

### 5 Whys
1. なぜ PBI ファイルが残っているのか → 優先度 4/4 の backlog として意図的に保留されている
2. なぜ保留されているのか → 現消費者が `connectionTests.ts` の1件のみで、real seam 成立の条件である第2消費者が未出現
3. なぜ第2消費者が未出現なのか → popup のクイックテストや diagnosticsPanel の再実行ボタン等、該当する機能要望がまだ起票されていない
4. なぜ要望が起票されていないのか → ユーザー/開発計画上、現時点でその需要がない
5. なぜ需要がないのか → 現行の generalSettings 接続テストだけで機能上の支障がない

→ 解: 本 PBI は backlog（保留条件付き）として運用する。着手トリガーが満たされるまでは実装せず、PBI ファイルを `pbi/` に残す。本 autonomous closer では「未完了 0」として扱わず、トリガー待ちの意図的 backlog として記録する。

## 現象 4: dev-docs/plans/2026-06-29-maintenance-plan.md / verified-crx-upload.md が残存

Plan ファイルが存在するが、未チェックボックスはない。

### 5 Whys
1. なぜ plan ファイルが残っているのか → 運用継続中のメンテナンス計画と、Chrome Web Store 審査完了待ちの手順書
2. なぜ運用継続中/審査待ちなのか → 外部依存（wxt の脆弱性修正リリース、CWS 審査）が解決していない
3. なぜ外部依存が解決していないのか → プロジェクト側で制御できないタイミングの問題

→ 解: これらは「完了待ちの plan」ではなく「継続監視/外部トリガー待ちの運用ドキュメント」として残す。今回はアーカイブしない。
