# PBI 28 調査報告: コンテンツ抽出ホットパスの計測と方式裁定

PBI: `pbi/2026-09-25-28-investigate-content-hot-path-yield.md`（investigate・production 変更なし）
日付: 2026-09-27

## 0. 前提の実測確認とドリフト

| PBI 記載 | 実測 |
|---|---|
| `src/content/contentKernel.ts:99-101`（extractPageContent） | ✅ 一致 |
| `src/utils/contentExtractor/pageContentPipeline.ts:7-11` | ❌ ドリフト — `src/utils/pageContentPipeline.ts:48` に移動済み（`preparePageContent`） |
| `src/utils/contentExtractor/index.ts:437-441`（extractMainContentWithInfo） | ⚠️ 行番号ドリフト — 同関数は `index.ts:114` に存在（437-441 は別コード）。production entry であることは一致 |
| `cloneNode(true)` 2 箇所（`index.ts:221,276`） | ✅ 一致（cleanse 用・AI cleanse 用） |
| `scheduler.yield` / `globalThis.scheduler?.yield` が production・test・entrypoints で 0 件 | ✅ 一致（本調査の計測で Chromium 実機には存在することを確認 — 未使用なだけ） |
| `cleanseViaOffscreen()` 存在・production call site 0・flag default false | ✅ 一致（`cleansingOffscreenDelegate.ts`、`types.ts:208-209`、`defaults.ts:87`） |
| `bench:check` は deterministic 4 counter のみ・`bench:e2e` と分離 | ✅ 一致 |
| 既存テスト 4 件 | ✅ 存在＋本調査で green 確認（28 件）。`c4.clone-dedup.bench.mjs` は micro suite で実行確認（L p50 211.95ms） |

## 1. 5 Whys（事実 → 裁定 → 根拠 → 残存リスク）

### Q1: ホットパスは本当にメインスレッドを占有するのか

- **事実**: 実 production コード（esbuild で `index.ts` を browser IIFE に束ねて実ページへ注入）を heavy fixture（/news・/spa × scale 8/16/32）で実行し、1 回実行 wall（= 1 main-thread task）を計測。`scheduler.yield` は実機 Chromium に存在した。
- **裁定**: heavy ページ × 低速 CPU でのみ longtask 級（§2 の表）。通常ページ・通常 hardware では 50ms 未満。
- **根拠**: §2 の実測値。
- **残存リスク**: 実ユーザーの DOM 分布は fixture と異なる。最大 duration の上限はページ依存。

### Q2: チャンク分割＋yield で longtask は消えるのか

- **事実**: 同一 extractor を top-level section 粒度で 8 分割し実 yield を挟む prototype を計測。chunk max は full-run max とほぼ同等（spa16/4x: 123.6ms vs 140.6ms）、total は 4〜7 倍に悪化（同条件 947ms vs 377ms）。
- **裁定**: **現行アルゴリズムの section 粒度チャンキングは不採用**。各 pass がほぼ全量の walk を再実行するため work が分割されず、hide/show の churn が加算されるだけ。
- **根拠**: §2 の B 列。真の yield 化には extractor 内部の再構成（per-node scheduler + generation epoch）が必要であり、本 prototype の延長では到達できない。
- **残存リスク**: なし（不採用のため）。

### Q3: offscreen は production 配線なしに評価できるのか

- **事実**: serialize（outerHTML）+ MessageChannel round-trip + DOMParser の slice walls を実測。spa32/4x でも ser 7.3ms・rt 2.4ms・parse 14.6ms。実 offscreen では parse+extract がメインスレッドを離れるため、残余は ser+rt+結果受領の ~15ms。
- **裁定**: **offscreen 化を採用方式に裁定**（§4）。main-thread 残余が longtask 閾値を 1 桁下回る唯一の方式。
- **根拠**: §2 の C 列。yield 方式の失敗（Q2）と対照。
- **残存リスク**: 非同期境界の伝播（§4）、offscreen lifecycle 管理、scheduler 非対応環境での offscreen 内 yield 手段の未確認。

### Q4: 同期最適化で足りるのではないか

- **事実**: c4 が clone 重複（extract→cleanse の二重 clone）を計測面として pin 済み（L p50 211.95ms）。clone 半減は bounded win。
- **裁定**: 同期最適化（clone 重複除去）は**補完施策**として有効だが、longtask クラスを変えない（4x spa16 で 140ms → 半減しても 70ms 超）。採用方式にはしない。
- **根拠**: §2 の A 列と c4。
- **残存リスク**: なし。

### Q5: longtask 件数を gate に入れるべきか

- **事実**: 本調査で PerformanceObserver 'longtask' は headless・headed いずれの Playwright 駆動でも発火しなかった（200ms busy loop で 0 entries）。v1 計測は全 longtask 0 の偽陰性だったため v2（wall 分布）で取り直した。
- **裁定**: **bench:check には入れない**（deterministic 4 counter の責務を維持）。将来 gate 化する場合は別 command・別 baseline。wall 分布方式（本調査の script）をその雛形にする。
- **根拠**: observer 方式の環境依存性と、wall 方式の再現性。
- **残存リスク**: CI 環境での wall ばらつき。gate 化時は throttling 固定 + p50 比較が必要。

## 2. 測定結果（実 production コード・実 Chromium・4x throttle＋等倍）

条件: fixture server（bench/e2e/server.mjs）、esbuild IIFE bundle、`extractMainContentWithInfo(10000, {cleanseEnabled:true})`。A は 1 回実行 walls ×5 の max/mean、B は 8 chunk の chunk max/total、C は slice 分解。longtask ⟺ 50ms 超（同期 1 実行 = 1 task のため）。

| page/scale | A max 4x | A max 1x | B chunkmax 4x | B total 4x | C ser+rt+parse 4x |
|---|---|---|---|---|---|
| news8 | 35.0ms − | 6.2ms − | 20.1ms − | 156ms | 1.0+1.4+4.1ms |
| news16 | 43.9ms − | 11.7ms − | 36.8ms − | 284ms | 1.8+0.9+5.0ms |
| news32 | 76.6ms **LT** | 19.6ms − | 67.0ms **LT** | 532ms | 3.5+1.8+7.2ms |
| spa8 | 74.3ms **LT** | 18.8ms − | 60.5ms **LT** | 469ms | 2.7+1.1+6.2ms |
| spa16 | 140.6ms **LT** | 36.7ms − | 123.6ms **LT** | 947ms | 4.8+1.9+9.0ms |
| spa32 | 283.8ms **LT** | 71.0ms **LT** | 255.6ms **LT** | 1933ms | 7.3+2.4+14.6ms |

− = longtask なし / LT = longtask 級。等倍（本機 M 系）では spa32 のみ LT。4x（低速 proxy）では news32・spa8 以上で LT。

読み:
- 通常 hardware・通常ページは longtask なし — 緊急度は低い。
- 低速 CPU × heavy ページで最大 284ms — 対策の対象はここ。
- B は chunk max が A max と同等かつ total が 4〜7 倍 — **yield 化の失敗**（Q2）。
- C の main-thread 残余（ser+rt）は最大 9.7ms — **longtask  class の解消**（Q3）。

## 3. 方式比較と裁定

| 方式 | longtask への効果 | コスト | 判定 |
|---|---|---|---|
| 現状維持 + 同期最適化（clone 重複除去） | bounded（半減級。heavy×低速は残る） | 小（c4 計測面あり） | 補完施策として推奨。採用方式にはしない |
| 非同期 rAF batching + scheduler.yield | prototype で効果なし（chunk max ≈ 全量、total ×4-7） | 大（extractor 内部の再構成 + epoch + preview 非同期伝播） | **不採用** |
| **offscreen 化** | main-thread 残余 ~15ms（longtask 解消） | 中（wiring + flag path + 非同期境界伝播 + lifecycle） | **採用** |

**裁定: offscreen 化を採用方式とする**。`cleanseViaOffscreen()` の PoC・`cleansing_offscreen_enabled` flag（default false）は存在するが production call site 0 のため、後続実装 PBI は wiring・設定経路・`extractPageContent` 同期契約の非同期伝播（preview 自動保存フローへの影響評価を含む）・offscreen lifecycle 管理を範囲とする。Offscreen document 内では `chrome.runtime` messaging と Web API のみ使用。非同期化後もページ DOM を変更しない detached 処理に限定する。

scheduler 非対応 fallback・mutation generation epoch は offscreen 方式では不要になる（同一 document 内の非同期分割を行わないため）。ただし offscreen document 内での yield 手段の有無は後続実装 PBI の確認事項として残す。

## 4. 後続実装 PBI への引き継ぎ（推定 3 SP）

1. `cleanseViaOffscreen()` の production wiring（call site 追加）と `cleansing_offscreen_enabled` の設定経路・default 方針
2. `extractPageContent` 同期契約の変更影響: preview 自動保存フローへの非同期伝播の評価（PBI 落とし穴の伝播検討）
3. offscreen document の lifecycle（生成・破棄・ slab leak 防止）と messaging（結果返送の structured clone コストは本文文字列のみで小さいことを本調査で確認済み）
4. offscreen 内 yield 手段の確認（`scheduler.yield` の有無・代替）
5. sync clone 重複除去は別途の bounded 最適化として分離（本 PBI の採用方式には含めない）
6. longtask gate 化は行わない（bench:check 不変）。将来は別 command・別 baseline（本調査 script が雛形）

**制約**: ページ DOM を変更しない detached 処理に限定。`chrome.runtime` messaging と Web API 以外を offscreen 内で使わない。`bench:check` の責務を変更しない。ESM `.js`・async/await。

## 5. PBI 28 DoD との対応

- production ホットパス・clone 2 箇所・delegate・flag・scheduler・bench 経路の確認: §0（`pageContentPipeline.ts` の移動ドリフトを記録）✅
- ページごとの longtask 件数・最大 duration ベースライン: §2（wall 分布方式。件数=max>50ms の有無、最大=max）✅
- 3 方式の同一条件比較: §2（同一ページ・同一 DOM・同一 throttle）✅
- 件数・最大・合計の区別: §2（observer 合計の罠を避け max を主指標に）✅
- 採用 1 方式の裁定と不採用理由・残存制約: §3 ✅
- offscreen の default・call site・wiring・API 制約の評価: §0・§3・§4 ✅
- scheduler 非対応 fallback と epoch の裁定: §3（offscreen 方式では不要・未確認事項として引継ぎ）✅
- detached 限定の受け入れ条件: §3・§4 ✅
- rAF + yield 規約の評価: §2 B 列（不採用の実測根拠）✅
- gate 分離方針: Q5・§4 ✅
- bench:check 4 counter の責務維持: Q5 ✅
- 既存テスト 4 件の対象範囲確認: §0（28 件 green）✅
- 30・14 との依存・競合: 30（namespace 再編）は `pageContentPipeline.ts` の移動として顕在化済み（§0）。14（ci-paths-filter）は完了済みで bench path に影響なし ✅
- 計測と裁定に限定・実装は別 PBI: §4 ✅
