# 2026-09-25 Checking Team 残債 PBI 化 — 採点台帳

ワークスペース全量レビュー（2026-09-24、報告書は `plans/2026-09-24-2213-review-workspace.md`）で得た残存指摘を PBI 化。Phase 5 で 23 指摘（High 3 + Medium 19 + 連動修正 1）を修正済みで、残った「確認待ち 15 Medium」と「未対応の Low 16 件」を 31 候補として抽出し、RICE 採点して 30 PBI を出力した。候補 1 件は調査の結果 PBI 化不要と判定し、本台帳に記録する。

NN は 2026-09-25 内の通し番号（2026-09-24 の 01〜16 はアーカイブ済みで、当日に空き番はない）。ファイル名の NN がそのまま着手順。

## 採点基準

RICE = (Reach × Impact × Confidence) / Effort。

| 要素 | 基準 |
|------|------|
| Reach | 直近 1 リリースで影響を受ける実行単位の数（呼び出しサイト、wire op、設定キー、UI 導線、production import）。保守性のみでユーザー挙動が変わらないものは 1 固定（変更量は Effort に計上） |
| Impact | 3 = データ損失や致命的バグ / 2 = 実害のある不具合・信頼性・セキュリティ / 1 = ユーザー可視の品質改善 / 0.5 = 内部品質と開発者体験 / 0.25 = 記録と防御のみ |
| Confidence | 100% = コードで実証済み・テスト可能 / 80% = 前提の一部に確認が必要 / 50% = 設計判断待ち |
| Effort | ストーリーポイント（0.25 / 0.5 / 1 / 1.5 / 2 / 3+） |

同点は「リスク軽減 → 時間的緊急性」の順。依存関係はスコアより優先して順位に反映した。

## 採点表

| 順位 | PBI | 候補 | Reach | Impact | Conf | Effort | RICE | 種別 |
|---|---|---|---:|---:|---:|---:|---:|---|
| 01 | `2026-09-25-01-fix-transport-replay-safety.md` | トランスポート mutate の再実行安全性保証 | 25 | 2 | 80% | 2 | 20.0 | fix |
| 02 | `2026-09-25-02-investigate-withlock-cas-deep-equal.md` | withLock の object 競合検知ポリシー | 14 | 1.5 | 80% | 2 | 8.4 | investigate |
| 03 | `2026-09-25-03-refactor-previewonly-flag-cleanup.md` | previewOnly 二重判定と不要 cast の削除 | 8 | 0.5 | 100% | 0.5 | 8.0 | refactor |
| 04 | `2026-09-25-04-fix-obsidian-get-retry.md` | Obsidian 接続確認 GET の再試行 | 2 | 1 | 100% | 0.5 | 4.0 | fix |
| 05 | `2026-09-25-05-fix-trustchecker-legacy-dead-code.md` | trustChecker レガシー API の削除 | 3 | 0.5 | 100% | 0.5 | 3.0 | fix |
| 06 | `2026-09-25-06-refactor-ui-provider-label-ssot.md` | UI から providerCatalog 依存の解消 | 3 | 0.5 | 100% | 0.5 | 3.0 | refactor |
| 07 | `2026-09-25-07-refactor-format-bytes-ssot.md` | バイト表示 helper の SSOT 化 | 6 | 0.5 | 100% | 1 | 3.0 | refactor |
| 08 | `2026-09-25-08-doc-trust-record-policy-correction.md` | trust 記録可否仕様と陳腐化記述の是正 | 2 | 0.25 | 100% | 0.25 | 2.0 | doc |
| 09 | `2026-09-25-09-fix-popup-untranslated-title-token.md` | popup 未翻訳 tooltip とトークン未使用属性 | 2 | 0.5 | 100% | 0.5 | 2.0 | fix |
| 10 | `2026-09-25-10-investigate-preset-prompt-locale.md` | プリセットプロンプトのロケール方針 | 5 | 1 | 50% | 1.5 | 1.67 | investigate |
| 11 | `2026-09-25-11-refactor-structured-failure-taxonomy.md` | 構造化 failure taxonomy の SSOT 化 | 3 | 2 | 80% | 3 | 1.60 | refactor |
| 12 | `2026-09-25-12-fix-offline-recovery-single-owner.md` | 録画復旧経路の owner 単一化 | 3 | 2 | 80% | 3 | 1.60 | fix |
| 13 | `2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` | Obsidian 書込 replay の冪等性方式 | 2 | 2 | 50% | 1 | 2.0 | investigate |
| 14 | `2026-09-25-14-refactor-ci-paths-filter.md` | CI ジョブの paths フィルタ設計 | 6 | 0.5 | 100% | 2 | 1.50 | refactor |
| 15 | `2026-09-25-15-investigate-ai-provider-circuit-breaker.md` | AI プロバイダの circuit breaker | 9 | 1 | 50% | 3 | 1.50 | investigate |
| 16 | `2026-09-25-16-investigate-dashboard-sqlite-ipc-roundtrip.md` | ダッシュボード SQLite IPC 往復削減 | 8 | 0.5 | 50% | 1.5 | 1.33 | investigate |
| 17 | `2026-09-25-17-fix-settings-migration-completion-state.md` | 設定移行の完了状態と除外キー | 1 | 3 | 80% | 2 | 1.20 | fix |
| 18 | `2026-09-25-18-investigate-settings-key-single-writer.md` | denied_domains / threshold の単一 writer 化 | 6 | 1 | 50% | 2 | 1.50 | investigate |
| 19 | `2026-09-25-19-doc-docs-catalog-accessibility-i18n.md` | docs カタログへの 2 文書掲載 | 2 | 0.25 | 100% | 0.5 | 1.00 | doc |
| 20 | `2026-09-25-20-doc-messaging-layer-decision-record.md` | messaging 逆依存の判断記録 | 1 | 0.25 | 100% | 0.25 | 1.00 | doc |
| 21 | `2026-09-25-21-doc-ssrf-threat-model-residual-risk.md` | SSRF ガード残存リスクの明文化 | 1 | 0.5 | 80% | 0.5 | 0.80 | doc |
| 22 | `2026-09-25-22-investigate-pending-queue-poison-record.md` | pendingSqliteQueue の毒レコード隔離 | 3 | 1 | 50% | 2 | 0.75 | investigate |
| 23 | `2026-09-25-23-investigate-deprecated-alias-sunset.md` | 非推奨エイリアスの sunset 基準 | 2 | 0.5 | 80% | 1.5 | 0.53 | investigate |
| 24 | `2026-09-25-24-investigate-privacy-reconsent-ux.md` | 同意拒否・撤回後の再同意導線 | 2 | 1 | 50% | 2 | 0.50 | investigate |
| 25 | `2026-09-25-25-fix-encryption-secret-wrapped-storage.md` | ENCRYPTION_SECRET のラップ形保存 | 1 | 3 | 50% | 3 | 0.50 | fix |
| 26 | `2026-09-25-26-backlog-wasm-binary-reproducibility-watch.md` | wasm ship バイナリ再現性の監視契約 | 1 | 0.25 | 80% | 0.5 | 0.40 | backlog |
| 27 | `2026-09-25-27-investigate-master-password-removal-reencrypt.md` | マスターパスワード解除時の鍵再暗号化 | 1 | 2 | 50% | 3 | 0.33 | investigate |
| 28 | `2026-09-25-28-investigate-content-hot-path-yield.md` | 抽出ホットパスの負荷実測と方式選定 | 1 | 1 | 50% | 2 | 0.25 | investigate |
| 29 | `2026-09-25-29-backlog-offscreen-gateway-archive-split.md` | OffscreenGateway の archive 責務分割 | 1 | 0.5 | 100% | 2 | 0.25 | backlog |
| 30 | `2026-09-25-30-refactor-utils-namespace-reorg.md` | utils フラット namespace の再編 | 1 | 0.25 | 100% | 3 | 0.08 | refactor |

種別内訳: fix 6 / refactor 9 / doc 5 / investigate 8 / backlog 2。investigate 8 件は着手時の設計裁定で実装範囲が確定するため、裁定後に `fix` PBI を同ラウンドで起票する（Effort は裁定ilogue分のみを見込み、実装分は別途見積もる）。

## 依存グラフと直列チェーン

RICE スコアより依存を先に置く。直列が必要なチェーンは次の 3 本。

```
C28 failure taxonomy → C14 復旧 owner → C13 書込 replay 冪等性   (PBI 11 → 12 → 13)
C28 failure taxonomy → C10 circuit breaker                        (PBI 11 → 15)
C01 ENCRYPTION_SECRET ラップ形保存 → C02 マスターパスワード解除     (PBI 25 → 27)
C16 withLock CAS 方針 → C06 設定キー単一 writer                    (PBI 02 → 18)
C17 設定移行の完了状態 → C18 設定キー単一 writer                   (PBI 17 → 18)
C15 transport replay safety → C04 archive 責務分割                (PBI 01 → 29)
C05 / C20 / C30 / C22 の重複・デッドコード除去 → C03 utils 再編   (PBI 06, 07, 03, 05 → 30)
```

- PBI 11 → 12 → 13 は同一の recovery 契約（`stepExecutor` / `recordingOutcome` / `offlineQueueProcessor`）を触るため直列。
- PBI 02 → 18 と 17 → 18 は storage ロックと migration の裁定が前提。PBI 18 は RICE 1.50 だが順位 18 に降格（依存優先）。
- PBI 01 と 29 は `src/background/sqlite/offscreenGateway.ts` を共有するため直列。
- PBI 30 は専用ブランチと段階移行を要するため、他の PBI と同時進行しない。
- PBI 04, 05, 06, 08, 09, 14, 19, 20, 21 は独立しており、ファイル非重複なら最大 4 件ずつ並列実装可能。

## 5 Whys サマリー（Phase 2 調査で判明した根本原因）

- **RETRY の二重回収**: なぜ二重登録するか → enqueue と pending 登録が別 seam で独立に必ず実行されるため。enqueue の結果が `void enqueueOfflineJob()` から outcome に戻らないため。**解: enqueue 結果を構造化して outcome seam へ運び、owner を単一化する**（PBI 12）
- **failure 種別が文面で決まる**: なぜ文言変更で挙動が変わるのか → `RetryPolicy` が message substring を契約にしているため。message が不安定なのは AI と Obsidian の sanitization で status と name と cause が失われるため。**解: failure kind の SSOT を 3 境界へ伝播させる**（PBI 11）
- **設定移行の途中中断**: なぜ設定が欠落するのか → 完了フラグを backup と削除より先に書いているため。**解: 完了状態を明示段階にし、除外キーを許可リストにする**（PBI 17）
- **object 競合の見落とし**: なぜ検知できないのか → pre-write 比較が object を明示的に skip しているため。version だけに依存する根拠が ADR に残っていないため。**解: deep-equal 導入か契約強化かを裁定する**（PBI 02）
- **復号不能の潜伏データ損失**: なぜ解除で鍵が消えるのか → 解除が認証メタデータだけを削除し、API キーの再暗号化を行わないため。ADR は削除方針を承認しており候補要件と衝突する。**解: ADR supersede の裁定を先に行う**（PBI 27）
- **Tranco 偏り（再評価で変化）**: 記録をブロックしないのは `TrustLookup` が `LOCKED` のみ `canProceed=false` とするためです。残る実害は古い blog 記述と不可能なテスト fixture のみ。**解: 現行仕様の明文化と記述の是正**（PBI 08）

## 調査で内容が変わった候補

| 候補 | 報告書の指摘 | 調査後の実像 | 反映先 |
|---|---|---|---|
| Tranco 偏り | 記録可否への直接写像 | 現行コードでは `LOCKED` のみブロック。リスト外は `UNVERIFIED` で記録される | PBI 08（実装ではなく doc に変更） |
| setElementHtml の script 除去 | 過剰な安全確認の誘発 | 二段防御は意図的。production 呼び出し 37 箇所 15 ファイル。防御縮小は不可 | 本台帳の不採用欄 |
| ObsidianClient のリトライ | 単発 fetch でリトライしない | HTTP surface は GET×2 と PUT×1 のみ。安全な GET リトライと書込 replay 冪等化は別物 | PBI 04 と PBI 13 に分割 |
| removeMasterPassword | 暗号化済み API キーの復号不能 | 実 UI は dashboard が認証キー 3 個を直接 remove。ADR 2026-03-24 と要件が衝突 | PBI 27（investigate 化） |

## 不採用（PBI 化不要）

- **setElementHtml の `<script>` 削除層の縮小**: `src/utils/htmlFragment.ts:59-75` は `DOMParser` の inert 特性に加えて生成された script 要素を防御的に除去する二段構えで、production 呼び出しは 37 箇所 15 ファイルに及ぶ。`src/utils/__tests__/htmlFragment.test.ts:10-77` の 8 ケースが「実行されず DOM からも削除される」を pin している。レビューでも「セキュリティを弱めない」方針が確定済みで、コード変更を入れると共通描画基盤の安全性を下げる逆効果になる。**PBI を作らず、防御縮小を行わない判断を本台帳に記録する。**

## 参照

- レビュー報告書: `plans/2026-09-24-2213-review-workspace.md`（総合評価 88/100、High 3 / Medium 34 / Low 16）
- 個別 PBI: `pbi/2026-09-25-01` 〜 `pbi/2026-09-25-30`
