# PBI 16 調査報告: ダッシュボード SQLite 取得の IPC 往復 — 現行維持の裁定

PBI: `pbi/2026-09-25-16-investigate-dashboard-sqlite-ipc-roundtrip.md`（investigate・production 変更なし）
日付: 2026-09-27

## 0. 計測方法

`dashboardGateway.callDashboard`（dashboard→SW の唯一境界）を数える seam に、**実 `fetchPeriodRows` + 実 `dashboardSqliteService`** を接続し、SW 応答の protocol 形状で decode まで通すスクラッチスペックで計測（実行後に削除）。retry は既存テストと同一の instant 化。測定はメッセージ数のみ（unit 環境の wall はプロセス内解決のため絶対値として使わない。1 local IPC ≈ sub-ms〜2ms の業界的目安で換算し、明示的に推定と区別する）。

前提のドリフト1件: PBI の「7 パネル」は現在 **9 パネル**（researchSessionsPanel・revisitInsightsPanel 等の追加）。`fetchAllPeriodRows` を使うパネルも含む。以下の計測は `fetchPeriodRows` 単位で行い、ページ数でスケールする。

## 1. ベースライン実測（現行方式）

| 条件 | status | query | 計 |
|---|---|---|---|
| initialized・1 ページ | 1 | 1 | **2** |
| initialized・5 ページ（domainAnalysisPanel 上限） | 5 | 5 | **10** |
| uninitialized・1 ページ | 4 | 0 | **4**（その後 throw、外側 retry が初期化待ち） |

PBI の主張（最大 10 往復・uninitialized で status 4/query 0）を正確に再現した。SW 側は status→`deps.getStatus()`、query→offscreen 背後の query 実行であり、支配的コストは sqlite 実行自体（IPC エンベロープではない）。

## 2. 3 方式の同一条件比較

| 方式 | initialized 5p | uninitialized | 評価 |
|---|---|---|---|
| 現行（preflight あり） | 10 | status 4 → throw（query 0） | 基準 |
| (1) preflight 廃止（query 直送 prototype） | **5** | **1 ページ 4 回の error query（5p で 20）** | initialized は半減するが、**uninitialized で悪化**（4 status → 20 error query。各 error は SW→offscreen の無駄働きを伴う）。不採用 |
| (2) readiness-only TTL キャッシュ（30s prototype） | 初回 6、2 周目以降 5/round | 現行どおり（status 経路は残る） | 1 open あたり ~5 msg 削減。対価: restore/import/migration 後の invalidate 機構 + diagnostics 除外の維持。削減幅に対して機構が不釣り合い。不採用 |
| (3) query response への status 同梱 | 5（試算。SW 変更が必要なため prototype なし） | preflight 相当の判定を response 側へ移動 | 最もきれいな件数だが、message contract 変更 + version skew（dashboard/SW/options page の再起動前提）+ lifecycle 8 件の mock 更新。~10ms のために払うには過大。不採用 |

uninitialized 時の query 抑止と外側 retry は現行のまま（fetch → status 4 回 → throw → 外側 retry が初期化を待つ）。diagnostics は現在時刻 status のためいずれの方式でも共有対象外（採用なしのため moot）。

## 3. 5 Whys（要旨）

1. **なぜ 2 往復なのか** — query 前の readiness preflight が別 message として直列化されるため（`fetchPeriodRows.ts:50-60`、`dashboardGateway` の document 直列化）。
2. **preflight の価値は何か** — uninitialized 時の query 回避 + 外側 retry による初期化待ち。(1) の実測で廃止の代償（error query 増）を定量化し、不採用を確定。
3. **なぜ status が共有されないのか** — status は dashboard service の state であり fetch 境界の cache ではない。(2) の TTL は技術的に成立するが、invalidate 機構のコストが削減幅に見合わない。
4. **なぜ response が統合されないのか** — 別 subtype・別 contract の設計であり、統合は version skew の再起動前提を伴う。~10ms の削減に対して過大。
5. **測定と選定の結論** — 下記 §4。

## 4. 裁定: 現行維持（`refactor` なし）

- **実害の定量化**: 最悪条件（5 ページ・initialized）で 10 local IPC ≈ 10〜20ms/パネル。query 実行 + 描画に埋もれる水準であり、ユーザー可視の害ではない。
- **3 方式はいずれも不採用**（§2 の表）。削減幅（最大 ~5 msg/open）に対して、uninitialized 悪化・staleness 機構・contract 変更のいずれも割に合わない。
- **contract 未変更**: query success `{rows, total}` / status 別 subtype / `fetchPeriodRows` の status→query 順序をすべて維持。既存 pin（`fetchPeriodRows.test.ts` の通常経路・uninitialized 経路、8 consumer lifecycle）は無変更で green のまま。
- **将来の再評価条件**: (a) 1 ページあたりの IPC が実測で問題になる場合（その場合は (3) の status 同梱が第一候補）(b) パネル数・ページ上限の増加で往復が線形に増えた場合 (c) offscreen hop の実測が支配的になった場合。

## 5. PBI 16 DoD との対応

- ベースライン（1/5 ページ・initialized/uninitialized）: §1 ✅
- 最大 10 往復の再現: §1 ✅
- 3 方式の同一条件比較と採否根拠: §2 ✅
- 採用方式と `refactor` 要否の明記: §4（**現行維持・refactor なし**）✅
- uninitialized の query 抑止と retry の扱い: §2（現行のまま。テストは既存 pin）✅
- TTL 採用時の invalidate・diagnostics 非共有: 不採用のため該当なし（条件と理由を §2 に記録）✅
- response 変更時の再起動前提・contract 一致: 不採用のため該当なし（理由を §2 に記録）✅
- 既存テストの必要範囲更新: **更新なし**（contract 未変更のため。既存 pin が現行維持の証拠）✅
- lifecycle mock の必要範囲更新: **更新なし**（同上）✅
- BDD・E2E・統合・単体の対応テスト: 既存テストが現行契約を pin 済み。新規テストなし（計測スクラッチは削除。計測値と方法は本報告書に記録）✅
- 現行維持の根拠と contract 未変更の判断: §4 ✅
