# 2026-10-01 arch-delivery-loop 診断ラウンド — 採点台帳

Phase 0 で並列サブエージェント 4 系統（background / dashboard / offscreen-storage / content-extraction）が抽出した 14 候補を RICE 採点し、上位 7 件を PBI 化した。残り 7 件は本台帳に送り、トリガー発火時に PBI 化する。

語彙は `codebase-design`（module / interface / depth / seam / adapter / leverage / locality）に準拠。ドメイン語彙は `CONTEXT.md`。

## RICE スコア表（降順）

| 順位 | 候補 | Reach | Impact | Confidence | Effort(週) | RICE | 判定 |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | O2 StatusChannel 状態表示の単一 seam 化 | 60 | 1 | 0.8 | 2.0 | 24.0 | PBI 01 |
| 2 | O1 ReloadGuard 競合ガードの単一 module 化 | 12 | 2 | 0.8 | 1.0 | 19.2 | PBI 02 |
| 3 | B1 RecordingAdmission 判定前段の単一 module 化 | 10 | 2 | 0.8 | 1.0 | 16.0 | PBI 03 |
| 4 | S2 OffscreenGateway `execute(op)` への畳み込み | 30 | 1 | 0.8 | 1.5 | 16.0 | PBI 04 |
| 5 | S1 SqliteEngineHost 状態 accessor の縮小 | 8 | 2 | 0.8 | 1.5 | 8.5 | PBI 05 |
| 6 | B2 replay 書き込みの SavePhase seam 移設 | 3 | 2 | 0.8 | 0.75 | 6.4 | PBI 06 |
| 7 | C1 抽出オーケストレータの単一 seam 化 | 6 | 1 | 0.8 | 1.0 | 4.8 | PBI 07 |
| — | O3 SettingsWrite module（15 writers 統一） | 15 | 2 | 0.5 | 2.5 | 6.0 | 台帳送り |
| — | C3 text/tokenizer 単一 seam 化 | 5 | 1 | 0.8 | 0.75 | 5.3 | 台帳送り |
| — | B3 SlotRunner＋InFlightCoalescer 抽出 | 5 | 1 | 0.5 | 1.5 | 1.7 | 台帳送り |
| — | O4 generalSettingsPanel mount spec 化 | 4 | 1 | 0.5 | 2.0 | 1.0 | 台帳送り |
| — | C2 hybrid policy-row helper 共通化 | 4 | 0.5 | 0.5 | 1.0 | 1.0 | 台帳送り |
| — | S4 読取 policy 集約＋SettingsRepository 分割 | 6 | 1 | 0.5 | 2.0 | 1.5 | 台帳送り |
| — | S3 wire-row `defineWireOp` 共通化 | 4 | 0.5 | 0.5 | 1.5 | 0.7 | 台帳送り |

- 同点（B1/S2）は推奨強度（Strong > Medium-Strong）で順序付け。
- O3 は RICE 6.0 で B2/C1 を上回るが、15 writers の移行が大きく O4 の mount 仕様と `settingsPipeline.ts` で領域競合するため、O4 との一体設計が必要と判断し台帳送りとした。
- S4 は読取 policy 集約（a）と SettingsRepository 分割（b）の 2 粒度を含むため、着手時に分割して PBI 化する。

## 依存グラフ

- S3 は S2 の完了を前提とする（S2 着地後に台帳から昇格）。
- O3 は O4 と同一領域（`settingsPipeline.ts`・layout 判定）のため、着手時は一体の PBI として再設計する。
- それ以外の PBI 間に依存なし。触るファイルも重ならないことを各 PBI の実装前に grep で確認する。

## 台帳送り 7 件の再評価条件

| 候補 | RICE | 再評価条件 |
|---|---|---|
| O3 SettingsWrite | 6.0 | 次回 settings 系改修時。O4 と一体設計すること |
| C3 tokenizer seam | 5.3 | 次回 text 系改修時。TS-first → Rust port → parity の順（ADR-017） |
| B3 SlotRunner/Coalescer | 1.7 | 次回 AI provider slot 改修時 |
| O4 mount spec | 1.0 | 次回 general-settings 改修時。O3 と一体設計すること |
| C2 hybrid helper | 1.0 | 5 つ目の hybrid core 出現時 |
| S4 read/settings split | 1.5 | 読取 policy 系の bug 顕在化時（b は 2 件目の write 系 bug 時） |
| S3 defineWireOp | 0.7 | S2 着地後。4 table 横断の変更が必要になった時 |

## 5 Whys サマリー

- 「なぜ admission 前段が 3 写しになるのか」→ 各 handler factory が協調者の組立まで担うため。示唆: 判定は 1 module、handler は要求組立のみに。解: B1 の RecordingAdmission。
- 「なぜ status が 60 箇所の慣習になるのか」→ 表示先・TTL・mirror が呼出側の知識のため。示唆: 登録 1 回の channel に。解: O2 の StatusChannel。
- 「なぜ reload 競合が 3  counters になるのか」→ ring / model / registry が各々の staleness を持つため。示唆: counter だけを共有 module に。解: O1 の ReloadGuard。

## PBI 一覧

| NN | PBI | 順位 | 状態 |
|---|---|---|---|
| 01 | [2026-10-01-01-refactor-status-channel-unification.md](../dev-docs/archived/pbi/2026-10-01-01-refactor-status-channel-unification.md) | 1 | 完了・アーカイブ済み |
| 02 | [2026-10-01-02-refactor-reload-guard-single-module.md](../dev-docs/archived/pbi/2026-10-01-02-refactor-reload-guard-single-module.md) | 2 | 完了・アーカイブ済み |
| 03 | [2026-10-01-03-refactor-recording-admission-module.md](../dev-docs/archived/pbi/2026-10-01-03-refactor-recording-admission-module.md) | 3 | 完了・アーカイブ済み |
| 04 | [2026-10-01-04-refactor-gateway-execute-collapse.md](../dev-docs/archived/pbi/2026-10-01-04-refactor-gateway-execute-collapse.md) | 4 | 完了・アーカイブ済み |
| 05 | [2026-10-01-05-refactor-engine-host-narrow-seam.md](../dev-docs/archived/pbi/2026-10-01-05-refactor-engine-host-narrow-seam.md) | 5 | 完了・アーカイブ済み |
| 06 | [2026-10-01-06-refactor-retry-savephase-seam.md](../dev-docs/archived/pbi/2026-10-01-06-refactor-retry-savephase-seam.md) | 6 | 完了・アーカイブ済み |
| 07 | [2026-10-01-07-refactor-extractor-single-seam.md](../dev-docs/archived/pbi/2026-10-01-07-refactor-extractor-single-seam.md) | 7 | 完了・アーカイブ済み |

ラウンド完遂済み（PBI 01-07 は 2026-10-01 に実装・アーカイブ）。本台帳は live 台帳として残す。
