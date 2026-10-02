# 依存マップとバッチ計画（ファイル排他・同一ディレクトリ戦略）

## 出所

- 大局的レビュー: holistic-code-review（holistic-code-improvement スキル・フェーズA）。3 領域の地図用 agent（popup+content / dashboard panels / background+utils）の検証済み 32 候補を TOP 5 テーマに統合。
- スコープ: 差分 — 過去台帳（archloop-1001 等）で閉じたテーマは再レビュー対象外。

## RICE 採点表と最終順位（依存優先）

| 順 | NN | 候補 | 種別 | R | I | C | Eff | RICE | 備考 |
|---|---|---|---|---|---|---|---|---:|---|
| 1 | 08 | alarm 二重ディスパッチ解消 | fix | 8 | 3 | 1.0 | 0.5 | 48.0 | check_session_timeout が毎回 2 回実行 |
| 2 | 09 | dashboard purge catch 追加 | fix | 6 | 3 | 1.0 | 0.5 | 36.0 | settingsForm 2 カ所 + generalSettingsPanel |
| 3 | 10 | Bootstrapper サイレント catch 解消 | fix | 5 | 3 | 1.0 | 0.5 | 30.0 | 歴史的理由の catch が実エラーを吞む |
| 4 | 11 | aiSummaryCleansingPanel delta-write 化 | fix | 5 | 2 | 1.0 | 0.5 | 20.0 | 兄弟キー 32 個の巻き戻しレース |
| 5 | 12 | popup async エラー境界 | fix | 8 | 3 | 1.0 | 1.5 | 16.0 | ~11 ハンドラに同ファイル既存パターン |
| 6 | 13 | SettingsRepository merge 統一 | refactor | 7 | 1 | 1.0 | 0.5 | 14.0 | merge-under-lock 2 重化 + cached 二重クリア |
| 7 | 14 | popup main.ts seam 追従 | fix | 6 | 1 | 1.0 | 0.5 | 12.0 | tabUtils.getCurrentTab へ |
| 8 | 15 | obsidianClient 分類統一 | refactor | 5 | 1 | 1.0 | 0.5 | 10.0 | 失敗分類 2 catch の共通化 |
| 9 | 16 | savedUrlRepository 保持ルール統一 | refactor | 5 | 1 | 1.0 | 0.5 | 10.0 | MAX_CONTENT_ENTRIES 3 重化 |
| 10 | 17 | generalSettingsPanel stale スナップショット | fix | 5 | 2 | 1.0 | 1.0 | 10.0 | refresh 後も mount closure を使う |
| 11 | 18 | ublockParser 統一 | refactor | 4 | 1 | 1.0 | 0.5 | 8.0 | plain 版を WithErrors 経由に |
| 12 | 19 | blob URL ライフサイクル | fix | 4 | 2 | 1.0 | 0.5 | 8.0 | error path で revoke されない |
| 13 | 20 | MutationObserver 蓄積解消 | fix | 4 | 1 | 1.0 | 0.5 | 8.0 | クリックのたび積み上がる |
| 14 | 21 | 死んだシーム撤去 | refactor | 7 | 1 | 1.0 | 1.0 | 7.0 | 逸脱: NN22 と同一ファイルのため先 |
| 15 | 22 | dashboard ボタン足場抽出 | refactor | 9 | 2 | 0.8 | 2.0 | 7.2 | ~25 ブロックを 1 エンジンに |
| 16 | 23 | storageTransaction CAS 統一 | refactor | 7 | 2 | 0.8 | 1.5 | 6.5 | 再試行シェル + verify 2 重化 |
| 17 | 24 | recoveryClaimStore sweep | fix | 4 | 2 | 0.8 | 0.5 | 6.4 | claim map 無制限成長 |
| 18 | 25 | providerCatalog 統合 | refactor | 6 | 0.5 | 1.0 | 0.5 | 6.0 | 同一本体の 2 名 |
| 19 | 26 | aiSummaryCleaner strip 足場 | refactor | 6 | 2 | 0.8 | 2.0 | 4.8 | 8 bespoke strip の scaffold |

## 実行順の逸脱理由

- NN21（死んだシーム撤去、RICE 7.0）は NN22（dashboard ボタン足場抽出、RICE 7.2）より点数が低いが、両者とも `src/dashboard/generalSettings/settingsForm.ts` を触るため依存で先に倒す（デッドコードを足場抽出対象に含めない）。
- NN17（stale スナップショット）→ NN20（MutationObserver）は同一ファイル `generalSettingsPanel.ts` のため直列。

## 依存マップ（バッチ計画）

- **バッチA（並列・ファイル非重複）**: 08 / 10 / 11 / 13 / 14 / 15 / 16 / 18 / 23 / 24 / 25
  - 08 は compositionManifest・service-worker を触る。他候補は非重複。
- **バッチB（settingsForm/generalSettingsPanel チェーン直列 + popup 並列）**: 09 → 17 → 20（同一ファイルチェーン）∥ 12 / 14 / 19（popup・connectionTests、チェーンと非重複）
  - 21（死んだシーム撤去）は settingsForm を触るため 09 の settingsForm 部分完了後。
- **バッチC（並列 2 件）**: 22 ∥ 26 — 21 完了後（settingsForm 非重複化）。

## 実装フェーズで追加した PBI（2026-10-02）

当初 19 件の想定だったが、実装・検証の過程で 2 件ふやいた。いずれも既知テーマの残存バグであり、次ラウンドに送るのではなく本ラウンドで閉じる。

| NN | 候補 | 種別 | 発見経緯 |
|---|---|---|---|
| 27 | [2026-10-01-27-fix-cleansing-slider-double-binding](../dev-docs/archived/pbi/2026-10-01-27-fix-cleansing-slider-double-binding.md) | fix | NN11 の実装後、`aiSummaryCleansingPanel.ts:29` が V2 の setup を呼び `:43-59` でも同じ 4 スライダーを束縛しており、V2 側の full-form 書き込み（`aiSummaryCleansingSettingsV2.ts:475-478`）が先に発火して巻き戻しが残っていた。NN11 の新テストはパネル単体 mount で V2 を経由しないため検出できなかった |
| 28 | [2026-10-01-28-fix-cleansing-sliders-unwired](../dev-docs/archived/pbi/2026-10-01-28-fix-cleansing-sliders-unwired.md) | fix | NN27 の検証中、`entrypoints/options/index.html:1236,1246` に実在する 2 スライダー（`fallback-ratio` / `fallback-min-bytes`）が `rangeConfigs` に無く保存されないこと、および `popup-body-protection-threshold` 行に HTML 要素が存在しないことを発見 |
| — | [2026-10-02-01-refactor-provider-priority-slots-consolidation](../dev-docs/archived/pbi/2026-10-02-01-refactor-provider-priority-slots-consolidation.md) | refactor | NN21 の積み残し（`collectCurrentProviderPrioritySlots()` の inline コピー集約）。✅ 実装済み（レビュー待ち） |
| — | [2026-10-02-02-refactor-nn22-guard-sweep](../dev-docs/archived/pbi/2026-10-02-02-refactor-nn22-guard-sweep.md) | refactor | NN22 の積み残し（`'error' in result` 残存 8 箇所の共有ガード寄せ、`exportImport.ts:179` は D1 除外）。✅ 実装済み（レビュー待ち） |

## 台帳送り（積み残し → 次ラウンド予約）

### 大局的レビュー由来（フェーズA）

| テーマ | 出所 | 再検討トリガー |
|---|---|---|
| E2E テスト状態契約の 4 重リテラル（contentKernel ×3 + extractor 型） | popup+content 地図 DRY | 次回 E2E 状態フィールド追加時 |
| i18n バイパス（exportLogsPanel・encryptedBackupPanel のハードコード文字列） | dashboard 地図 SoC | 次回 2 パネル改修時 |
| 境界型の `as unknown as` casts（contentKernel:161・visitGating:225-229・whitelistWriter:66-68） | popup+content 地図 SoC | 次回 settings/CleansingConfig 契約改修時 |
| 小ヘルパ群統合（stringOrEmpty・SETTINGS_FORM_SELECTOR・clearChildren） | dashboard 地図 DRY | 5 つ目の重複出現時 |
| fetchWithRetry の HTTP 5xx 経路 backoff 欠落（fetch.ts:373-376・doc との乖離） | background+utils 地図 堅牢性 | 次回 fetch 改修時 |
| mount-closure god functions 分割（archivePanel・generalSettingsPanel） | dashboard 地図 拡張性 | 次回 2 パネルへのアクション追加時 |

### 実装フェーズで判明（2026-10-02）

| テーマ | 出所 | 再検討トリガー |
|---|---|---|
| `type-check:test` が 429 errors で恒常失敗（tsconfig の misalignment。`entrypoints/popup/main.ts` に `.js` 拡張子を要求する等）。`npm run validate` には未包含 | Wave 1/2 統合 | 次回 tsconfig を触る時（別 PBI として起票が妥当） |
| `markdownExport.ts:285` の固定 1 秒 revoke timer（本番の日次ノート export）。anchor-click で完了シグナルがないため NN19 と同じ解法が使えない | NN19 実装中 | 次の export 系改修時 |
| popup の `statusAddDomain` / `statusAddPath` が `wireOnce` なしで re-render 時にリスナを積層 | NN12 実装中 | 同要素へのリスナ追加時 |
| NN09 / NN12 のエラー文言が `errorMessage` / `errorGeneric` の汎用文字列（`purgeNowFailed`・`contentPurgeNowFailed` 等の `_locales` キーが未追加） | NN09 / NN12 実装中 | 次の i18n 整備時 |
| DomainFilter の mode デフォルト 3 種（設定既定 `blacklist` / 書き `whitelist` / 読み `disabled`）。NN21 は値を変えず pin のみ | NN21 実装中 | ドメインフィルタの裁定を要する機能変更時 |
| `AlarmHandlerDeps` の `reviewSummaryGenerator` / `settingsReader` も未読（NN21 は `sessionTimeoutInstall` のみ削除） | NN21 実装中 | 次の alarmRegistry 整備時 |
| 削除済み export の `vi.mock` stub が残る 4 テスト（navigation / statusPanel / statusPanel-extra / tabSeamNullPin） | NN21 実装中 | 該当テスト改修時 |

## 5 Whys サマリー

- 「なぜ alarm が 2 回実行されるのか」→ PBI 2026-09-15-15 の registry 移行で内部リスナーが撤去されず両経路が wire されたため。解: NN08。
- 「なぜ purge に catch がないのか」→ settingsForm の 2 ハンドラが finally まで書かれて catch を書き忘れたため。兄妹は catch + 表示。解: NN09。
- 「なぜ足場が 25 箇所コピーされるのか」→ isServiceError seam が存在するのに inline unwrap が 9 カ所で再実装されたため。解: NN22（エンジン抽出）。
- 「なぜ死んだシームが生き続けるのか」→ production-dead export の削除ゲートがなく、自テストだけが消費し続けるため。解: NN21。
