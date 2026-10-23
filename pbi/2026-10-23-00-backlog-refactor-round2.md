# リファクタリング診断バックログ（2026-10-23 round2）

> `/yasumaro-refactor` による読み取り専用診断の結果台帳。7 レンズ（DRY / SRP / 型 / 副作用 / エラー処理 / 命名 / 挙動境界）で 5 パス（4 領域の並列走査 + 主スレッド横断検証 + 残差精読 + 統合判定 + 最終スイープ）を行い、約 70 件の観測を 12 PBI + 対象外 13 件 + 却下 12 件へ統合した。コード変更は一切行っていない。

## RICE スコア表（全 12 PBI）

RICE = Reach（影響するモジュール・呼出箇所・テストの数）× Impact（1-3: 将来の変更コスト・バグ温床リスク）× Confidence（0.5-1.0: 裏取りの強さ）÷ Effort（人日）

| 順位 | PBI | テーマ | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 01 | [2026-10-23-01](2026-10-23-01-refactor-tag-fold-ssot.md) | タグ fold SSOT | 13 | 2 | 1.0 | 0.5 | 52 |
| 02 | [2026-10-23-02](2026-10-23-02-refactor-settings-value-types.md) | Settings 値型 + cast 撤去 | 12 | 3 | 1.0 | 1.0 | 36 |
| 03 | [2026-10-23-03](2026-10-23-03-refactor-gateway-response-seam.md) | gateway 応答ガード + 型 | 9 | 2 | 1.0 | 0.75 | 24 |
| 04 | [2026-10-23-04](2026-10-23-04-refactor-batch-read-cap.md) | バッチ読込上限 200 集約 | 7 | 1 | 0.8 | 0.3 | 18.7 |
| 05 | [2026-10-23-05](2026-10-23-05-refactor-share-percent-format.md) | 割合％丸め共通化 | 6 | 1 | 1.0 | 0.4 | 15 |
| 06 | [2026-10-23-06](2026-10-23-06-refactor-new-module-hygiene.md) | 新設衛生残差 bundle | 8 | 1 | 1.0 | 0.6 | 13.3 |
| 07 | [2026-10-23-07](2026-10-23-07-refactor-busy-button-seam.md) | 処理中ボタン定型 | 10 | 1 | 0.8 | 0.75 | 10.7 |
| 08 | [2026-10-23-08](2026-10-23-08-refactor-proposal-row-wiring.md) | 提案行配線共通化 | 6 | 2 | 0.8 | 1.0 | 9.6 |
| 09 | [2026-10-23-09](2026-10-23-09-refactor-repository-seam-contract.md) | repository seam 契約 | 6 | 2 | 0.8 | 1.0 | 9.6 |
| 10 | [2026-10-23-10](2026-10-23-10-refactor-router-collection-accessor.md) | router アクセサ単純化 | 2 | 0.5 | 1.0 | 0.2 | 5 |
| 11 | [2026-10-23-11](2026-10-23-11-refactor-content-flag-watcher.md) | content フラグ監視 | 4 | 1 | 0.5 | 0.75 | 2.7 |
| 12 | [2026-10-23-12](2026-10-23-12-refactor-predicate-placement.md) | ガード述語配置 | 4 | 1 | 0.5 | 0.75 | 2.7 |

## 依存グラフと実施順の推奨

- **RICE 順が既定**。同点の 08/09 は 08 を先に（対象外 O1 の fix が 08 待ちのため）。
- **NN02 → NN09・NN10**: 同ファイル群（repository・router）の型と seam を同時変更しない。
- **NN01 → 対象外 O6/O8**：タグ照合意味の fix は fold SSOT の後に乗せる。
- **NN08 → 対象外 O1**：複数行の誤配線 fix は行単位 seam の後に行う。
- **NN02/NN09 → 対象外 O5**：blacklist の CAS 化は型・seam 整備の後に行う。
- **並列可**: NN01 / NN03 / NN04 / NN05 / NN06 / NN07 は互いに独立（触れるファイルが重複しない）。
- **判断分岐を含む PBI**: NN10・NN11・NN12 は「残す・寄せない」判断で閉じる道を DoD に含む。判断は PBI に記録する。

## 対象外リスト（挙動変更を伴うため PBI 化しない・fix/owner 判断）

実装ではなく、別途 fix 型 PBI または owner 判断で扱う。NN との前後関係を併記した。

| 番号 | 内容 | 根拠 file:line | 後続 |
|---|---|---|---|
| O1 | domainAnalysisPanel の複数提案行が先頭行のみ配線（先頭に N 重 listener） | `domainAnalysisPanel.ts:249-251` 呼出し × `:164-166` 親 querySelector（主スレッドが実読で確認） | fix。NN08 の後に実施 |
| O2 | tagsPanel の提案スキャン・適用が最新 200 件切断（201 件目以降の旧タグは提案・適用漏れ） | `tagsPanel.ts:214,217,239` | fix/仕様判断（全件走査か paging か） |
| O3 | `CONDITION_LABELS` をモジュール頂で `t()` 評価（言語切替後に再評価されない） | `savedCollectionsPanelView.ts:36-40`（主スレッドが実読で確認） | fix（関数化・再評価） |
| O4 | `buildNoiseProposals` がソートなしで slice（入力の降順に暗黙依存） | `domainIntelAggregate.ts:97-103` | 要判断（明示ソートは表示順変更） |
| O5 | blacklist の read-modify-write が CAS 経路を迂回（競合 add 消失の温床） | `domainIntelRepository.ts:47-57`（whitelist 側は PBI 2026-10-18-12 で CAS 済み） | fix。NN02・NN09 の後に実施 |
| O6 | blacklist の完全一致のみ（trim/lowercase なしで重複蓄積） | `domainIntelRepository.ts:48-49,56` | fix/仕様。NN01 の後に実施 |
| O7 | ASK/EXPORT validator の gaps（空 question・空 scope・負数 since/until 等） | `validators.ts:676-729`（主スレッドが実読で確認） | fix（段階的締付け。panel 側は ''→null 済みのため低） |
| O8 | 保存 tags CSV の4系統解釈（webhook・display・rename・ASK scope の post-filter） | `webhookExportPayload.ts:46-54`・`tagUtils.ts:183-204`・`tagNormalizationProposals.ts:65-84`・`askHistoryHandlers.ts:193-196`（4 件目は主スレッドが追加実測） | fix/仕様（照合意味の統一 + 組合わせテスト）。NN01 の後に実施 |
| O9 | `ONBOARDING_DISMISSED`・`SAVED_COLLECTIONS` が restore 対象外（復元後に banner 再表示・コレクション消失） | `restorableSettings.ts` に spec 行なし（grep 0 件） | owner 判断（復元すべきか） |
| O10 | `upsertSavedCollection` の `now` 無検証（`now <= 0/NaN` の行は次回 normalize で消失） | `savedCollections.ts:58-68` → `:40-42` | fix（upsert ガード） |
| O11 | `CAPTURE_SCOPE` 英語固定 + `domainIntel_*`/`normProposal*` キー命名不統一（キー契約変更のため要判断） | `captureFailureReasons.ts:93-101`・`messages.json:2493-2519,4530-4553` | owner 判断 |
| O12 | statusPanel の `void ... .then()` に rejection 処理なし（`requestContentFromTab` は投げる） | `statusPanel.ts:84` × `contentFetchGateway.ts:78,83,104,140,145`（主スレッドが実読で確認。前回対象外 3 の類例） | fix（`.catch` 追加） |
| O13 | `wxt.config.ts:230-314` の権限宣言（不整合疑い。領域担当の申告のみで主スレッド未検証） | 未検証 | 要 verification（本 round では PBI 化しない） |

## YAGNI 却下リスト（共通化しない・PBI 化しない）

| 却下内容 | 理由 |
|---|---|
| 3 aggregate（bias/session/similarity）の骨格共通化 | 偶然の重複。しきい値・意味が別であり、共通化は過度な抽象化 |
| MIN 2・MAX 3・0.5 の同値統合 | 偶然の同値。各モジュールが所有する |
| `bulkSetStarred` の batch API 化 | 新規契約が必要な構造変更。現行は単一 invalidation で合理的 |
| bulk undo の batch 復元・entry 系の DI-with-default・content の module キャッシュ（PBI 2026-09-11-05） | 意図的設計。pin 済みまたは受容パターン |
| extractor/offscreen の将来温床 speculation | 将来の仮定では PBI 化しない |
| webhook 契約・collections scope 非対称・未配線語彙 | 既存 PBI（2026-10-22-05/06・2026-10-23-06/08/09・2026-10-22-03/04/06）の残務として記録済み。新規なし |

## 飽和の根拠

- パス 1（領域縦断）: 5 領域に並列 spawn。4 領域が納品（dashboard 16 件・storage/messaging 20 件・横断 17 件・popup/content/offscreen 13 件）。background 領域は応答なく中断したが、主スレッドが同領域を代行検証（gateway 3 件・handler 2 件・validator・MessageRouter・composition・webhook payload を実読）したため未探索の穴はない。残差として O13 のみ未検証と明記する。
- パス 2（主スレッド検証）: 新規 2 件（O12・O8 の 4 系統目）。
- パス 3（残差精読）: 新規 1 件（NN11 の flag-watcher 候補）。content 2 件を読切り、P10 は意図的設計として却下。
- パス 4（統合判定）: 新規 0 件（YAGNI フィルタ・RICE 採点のみ）。
- パス 5（最終スイープ）: 初期化境界（`dashboard.ts:95`・`tagsPanel.ts:408`）を確認。新規 0 件。
- 2 回連続 0 件（パス 4・5）で飽和と判定し停止する。

## 次のアクションの案内

- 実装するなら arch-delivery-loop（RICE 順で自律実装〜検証〜版上げ）。NN02 と NN09・NN10 の前後関係だけ守る。
- 個別に手動実装なら各 PBI ファイルを開く。NN10・NN11・NN12 は判断記録での close あり。
- 対象外 O1-O13 は fix 型 PBI または owner 判断で別途扱う（本 round の実装対象外）。
