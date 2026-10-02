# 2026-10-02 実残バックログ台帳（leftover-1002）

## 出所

- CHANGELOG 6.9.32 の 15 items はすべて ALREADY-FIXED（実装済み・検証済み）のため起票不要。
- 実残 ~8 件を harvest し、PBI 03–10 に起票した。本台帳は RICE 採点・バッチ順・送り先の SSOT。

## RICE 採点表（RICE 降順）

| 順 | PBI | 系統 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---:|
| 1 | [2026-10-02-03-fix-popup-listener-stacking.md](../dev-docs/archived/pbi/2026-10-02-03-fix-popup-listener-stacking.md) | C6 | 8 | 3 | 0.60 | 0.5 | 28.80 |
| 2 | [2026-10-02-04-fix-markdown-export-revoke-timer.md](../dev-docs/archived/pbi/2026-10-02-04-fix-markdown-export-revoke-timer.md) | C4 | 10 | 2 | 0.85 | 0.8 | 21.25 |
| 3 | [2026-10-02-05-refactor-import-guard-structural.md](../dev-docs/archived/pbi/2026-10-02-05-refactor-import-guard-structural.md) | C1 | 8 | 3 | 0.80 | 1.0 | 19.20 |
| 4 | [2026-10-02-07-fix-error-copy-locales.md](../dev-docs/archived/pbi/2026-10-02-07-fix-error-copy-locales.md) | C8 | 7 | 2 | 0.95 | 1.0 | 13.30 |
| 5 | [2026-10-02-06-test-concurrent-export-isolation.md](../dev-docs/archived/pbi/2026-10-02-06-test-concurrent-export-isolation.md) | C3 | 6 | 1.5 | 0.90 | 1.0 | 8.10 |
| 6 | [2026-10-02-08-fix-domain-filter-defaults.md](../dev-docs/archived/pbi/2026-10-02-08-fix-domain-filter-defaults.md) | C7 | 4 | 2 | 0.83 | 1.0 | 6.67 |
| 7 | [2026-10-02-09-fix-collector-throw-semantics.md](../dev-docs/archived/pbi/2026-10-02-09-fix-collector-throw-semantics.md) | C2 | 4 | 1 | 0.80 | 1.0 | 3.20 |
| 8 | [2026-10-02-10-chore-type-test-gate.md](../dev-docs/archived/pbi/2026-10-02-10-chore-type-test-gate.md) | C5 | 4 | 1 | 0.50 | 1.0 | 2.00 |

RICE = R × I × C / E。C7 は 4×2×0.83/1.0 = 6.64 ≒ 6.67（2/3 端数丸め）。

## バッチ計画（実装順）

- **Wave1: 03 + 04 + 05 + 06** — C6/C8 serial 注記: 03（C6）と 07（C8）はいずれも `src/popup/statusPanel.ts`（03:329-377 / 07:346,369）に触るため直列（03 → 07 の順）。06 はテスト追加のみでソース変更なしのため Wave1 内で並列安全（parallel-safe）。
- **Wave2: 07 + 08 + 09 + 10** — 相互にファイル非重複（locales+statusPanel / domainFilter 3 層 / settingsPipeline-collector / testDir+validate 配線）のため並列可。ただし 07 は Wave1 の 03 完了後に着手（上記 serial 制約）。

## 実装状況（Wave1）

| PBI | 状態 | 内容 |
|---|---|---|
| 03 | ✅ 完了 | `statusPanel.ts` wireOnce 寄せ + parity 4 tests |
| 04 | ✅ 完了 | `markdownExport.ts` finally 確定 revoke + 2 tests（`exportLogsService` 60s 変種は意図的に無変更） |
| 05 | ✅ 完了 | D1=(b) narrow guard `isImportError` + `exportImport.ts:179` 置換 + guard 2 tests（`dashboardSqliteService` 無変更） |
| 06 | ✅ 完了 | 分離テスト 11 件のみ追加（ソース無変更、M1/M2 は RED 確認後に revert） |

## 実装状況（Wave2）

| PBI | 状態 | 内容 |
|---|---|---|
| 07 | ✅ 完了 | locales 3 キー×日英 + `settingsForm.ts` getMessageOr + `statusPanel.ts` 2 箇所 i18n 化 + 新規 2 テスト・更新 2 スイート |
| 08 | ✅ 完了 | 既定値裁定 `'blacklist'` (`defaults.ts` を正、他 2 層を寄せ) + matrix 5 tests + `storage.test.ts` 4 assertions 更新。経路は `src/utils/...` 移設先で実施 |
| 09 | ✅ 完了 | 裁定 RESTORE propagate (`collectASafe` 削除) + pipeline `collector_failed` 中断 + B-view stored fallback + 新規 3 tests |
| 10 | ✅ 完了 | 方式 (b) baseline 復活 (pin 496、実測 489) + `validate` 配線。本番 tsc clean |

## 送り（deferred・トリガー待ち）

- 未読 alarm deps: `AlarmHandlerDeps` の `reviewSummaryGenerator` / `settingsReader` 未読 — 次の alarmRegistry 整備時に再検討。
- stale mocks（trigger-gated）: 削除済み export の `vi.mock` stub 残 4 テスト（navigation / statusPanel / statusPanel-extra / tabSeamNullPin）— 該当テスト改修時に除去。
- phase-A テーマ（次ラウンド予約）: E2E 状態契約 4 重リテラル / i18n バイパス（exportLogsPanel・encryptedBackupPanel）/ 境界型 `as unknown as` casts / 小ヘルパ群統合 / fetch 5xx backoff 欠落 / mount-closure god functions 分割 — 各トリガー発火時に起票。
- INDEX watches（既存監視の維持）: stryker vitest-runner / TS7 adoption / wasm reproducibility / offscreen-gateway archive split / defense-in-depth / empty-catch audit / tagCooccurrence 移設 / local-provider origin rule / wasqlite sunset / future 統合台帳 — 本ラウンドでは着手せず監視継続。
