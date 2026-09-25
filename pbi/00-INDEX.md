# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

**`pbi/` には未完了のPBIだけを置く。** 完了したものは `dev-docs/archived/pbi/` へ移動し、
このINDEXの表からは削除して「アーカイブ履歴」に1行残す。

凡例: ⬜ 未着手 / 🔶 部分実装（一部基準のみ満たす）
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能）
種別: ✨機能追加（feat、ユーザーに見える新機能） / 🔧非機能追加（fix/refactor、バグ修正・内部改善・性能改善など機能追加を伴わないもの）

---

## 進行中 ⬜ 未着手 / 🔶 部分実装

### 2026-09-26 メタ認知分析ラウンド — ✅ 4件完了・アーカイブ済み ✨機能追加

開発提案「情報探索のメタ認知化」の3案を、記録データの実態と照らし合わせて RICE で採点した。

- 提案1（熟読度フィルター）: 不採用。滞在時間を記録していないため。
- 提案2（セッション＆パス分析）: 既存データで作れる部分（02。✅ 完了）、遷移記録の基盤（03。✅ 実装完了・一部 DoD 未実施）、探索パスと指標（04）の3つに分けた。✅ すべて完了・アーカイブ済み。
- 提案3（ループ課題・タイムカプセル）: 09-24 台帳の「再訪分析」を統合した（01）。✅ 完了・アーカイブ済み（アーカイブ履歴参照）。

各 PBI は、低価格モデルでも実装できる詳細設計（ファイル・型・アルゴリズム・i18n 文言・テストケース）を含む。採点・前提の差異・ユーザー裁定・不採用理由の詳細は [2026-09-26-00-backlog-metacognition-analytics.md](2026-09-26-00-backlog-metacognition-analytics.md) を参照。

このラウンドの 4 PBI はすべて実装済み・アーカイブ済みです（内訳はアーカイブ履歴を参照）。未実施の DoD は各 PBI の「未実施 — ユーザー作業」表記に残しています。

### 2026-09-25 Checking Team 残債 PBI 化ラウンド — ✅ 8件完了・アーカイブ済み / ⬜ 未着手 22件 🔧非機能追加

ワークスペース全量レビュー（2026-09-24、報告書は `dev-docs/archived/plans/2026-09-24-2213-review-workspace.md`、総合評価 88/100）の残存指摘を 31 候補に展開し、RICE 採点して 30 PBI を出力。採点・依存グラフ・5 Whys の詳細は [2026-09-25-00-backlog-checking-team-0924.md](2026-09-25-00-backlog-checking-team-0924.md)。種別内訳は fix 6 / refactor 9 / doc 5 / investigate 8 / backlog 2。investigate 8 件は着手時の裁定後に `fix` PBI を起票する。

| NN | PBI | 種別 | RICE | SP | 依存 / トリガー |
|---|---|---|---:|---:|---|
| 02 | [investigate-withlock-cas-deep-equal](2026-09-25-02-investigate-withlock-cas-deep-equal.md) | investigate | 8.4 | 2 | 裁定が 18 の前提 |
| 06 | [refactor-ui-provider-label-ssot](2026-09-25-06-refactor-ui-provider-label-ssot.md) | refactor | 3.0 | 0.5 | 30 と import 競合 |
| 07 | [refactor-format-bytes-ssot](2026-09-25-07-refactor-format-bytes-ssot.md) | refactor | 3.0 | 1 | 30 と同一ファイル競合 |
| 10 | [investigate-preset-prompt-locale](2026-09-25-10-investigate-preset-prompt-locale.md) | investigate | 1.67 | 1.5 | 製品の言語方針が未決 |
| 11 | [refactor-structured-failure-taxonomy](2026-09-25-11-refactor-structured-failure-taxonomy.md) | refactor | 1.6 | 3 | 12・13・15 の前提（起点） |
| 12 | [fix-offline-recovery-single-owner](2026-09-25-12-fix-offline-recovery-single-owner.md) | fix | 1.6 | 3 | 11 の後。13 の前提 |
| 13 | [investigate-obsidian-write-replay-idempotency](2026-09-25-13-investigate-obsidian-write-replay-idempotency.md) | investigate | 2.0 | 1 | 11 → 12 の後（依存で降格） |
| 14 | [refactor-ci-paths-filter](2026-09-25-14-refactor-ci-paths-filter.md) | refactor | 1.5 | 2 | 26 と CI 設定を共用 |
| 15 | [investigate-ai-provider-circuit-breaker](2026-09-25-15-investigate-ai-provider-circuit-breaker.md) | investigate | 1.5 | 3 | 11 の failure taxonomy が前提 |
| 16 | [investigate-dashboard-sqlite-ipc-roundtrip](2026-09-25-16-investigate-dashboard-sqlite-ipc-roundtrip.md) | investigate | 1.33 | 1.5 | 実害未計測。計測結果待ち |
| 17 | [fix-settings-migration-completion-state](2026-09-25-17-fix-settings-migration-completion-state.md) | fix | 1.2 | 2 | 18 の前提。データ損失のため優先実施 |
| 18 | [investigate-settings-key-single-writer](2026-09-25-18-investigate-settings-key-single-writer.md) | investigate | 1.5 | 2 | 02 と 17 の後（依存で降格） |
| 19 | [doc-docs-catalog-accessibility-i18n](2026-09-25-19-doc-docs-catalog-accessibility-i18n.md) | doc | 1.0 | 0.5 | 14 の受益 case |
| 21 | [doc-ssrf-threat-model-residual-risk](2026-09-25-21-doc-ssrf-threat-model-residual-risk.md) | doc | 0.8 | 0.5 | security を弱めない記述に限定 |
| 22 | [investigate-pending-queue-poison-record](2026-09-25-22-investigate-pending-queue-poison-record.md) | investigate | 0.75 | 2 | 01 の retry 判定と共有。実データ待ち |
| 23 | [investigate-deprecated-alias-sunset](2026-09-25-23-investigate-deprecated-alias-sunset.md) | investigate | 0.53 | 1.5 | 14 の path 対象要与 |
| 25 | [fix-encryption-secret-wrapped-storage](2026-09-25-25-fix-encryption-secret-wrapped-storage.md) | fix | 0.5 | 3 | 27 の前提。IDB 障害方針が未決 |
| 26 | [backlog-wasm-binary-reproducibility-watch](2026-09-25-26-backlog-wasm-binary-reproducibility-watch.md) | backlog | 0.4 | 0.5 | トリガー: toolchain / wasm-pack / manifest 変更時 |
| 27 | [investigate-master-password-removal-reencrypt](2026-09-25-27-investigate-master-password-removal-reencrypt.md) | investigate | 0.33 | 3 | 25 の後。ADR supersede が未決 |
| 28 | [investigate-content-hot-path-yield](2026-09-25-28-investigate-content-hot-path-yield.md) | investigate | 0.25 | 2 | 30 と `contentExtractor` で競合 |
| 29 | [backlog-offscreen-gateway-archive-split](2026-09-25-29-backlog-offscreen-gateway-archive-split.md) | backlog | 0.25 | 2 | 01 の後。archive subtype 追加時に発火 |
| 30 | [refactor-utils-namespace-reorg](2026-09-25-30-refactor-utils-namespace-reorg.md) | refactor | 0.08 | 3+ | 専用ブランチ必須。03・05・06・07 の後 |

**PBI 化不要と判定した 1 件**: `setElementHtml` の `<script>` 削除層の縮小は、production 呼び出し 37 箇所 15 ファイルに及ぶ二段防御（`DOMParser` の inert 特性 + 生成 script の除去）で、レビューでも「セキュリティを弱めない」方針が確定済み。コード変更を入れると共通描画基盤の安全性が下がるため PBI を作らず、判定根拠を採点台帳の不採用欄に記録した。

### 2026-09-24 arch-delivery-loop パネル基盤深化ラウンド — ✅ 全8件完了・アーカイブ済み

分析パネルラウンド（01-08 アーカイブ済み）後のアーキテクチャ診断（Phase 0・HTML レポート表示済み）で抽出した9候補を RICE 採点し、上位8件を実装。NN は 2026-09-24 内の通し番号（前ラウンド 01-08 はアーカイブ済みのため 09 起点）。台帳送り2件（defineAnalysisPanel 単一登録シーム RICE 3.6・renderTagGraph 抽出 RICE 0.8）は [2026-09-24-00-backlog-archloop-0924.md](2026-09-24-00-backlog-archloop-0924.md) を参照。

### 2026-09-24 分析機能強化ラウンド — ✅ 全8件完了・アーカイブ済み ✨機能追加

分析機能要求（タグクラスタ時間変化・ワードクラスタ・ドメイン分析）＋提案した新規分析9案の計13候補を RICE 採点し、上位6件＋ユーザー明示要求2件（07・08 は台帳順位から昇格）を PBI 化。台帳送り5案＋不採用1案の採点詳細は [2026-09-24-00-backlog-analysis-features.md](2026-09-24-00-backlog-analysis-features.md)（台帳送り5案を保持して live 維持）。依存: 08 は 04 に依存（完了済み）、05-08 は共有期間フィルタ部品（`src/dashboard/components/periodFilter.ts`・02 で新設済み）を再利用。

### 2026-09-22 VulnHunt 監査修正 — 🔵 監視 1件（11。06-10 は完了・アーカイブ済み）

VulnHunt 監査（`obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/`、confirmed 7件・エクスプロイトテスト 11/11 PASS・sweep 残件 0）の修正戦略を6 PBI 化。VULN-002+003（enabler 関係）と VULN-005+007（同一位相）を統合、Code Quality 4項は監視 PBI の 11 に束ねた。採点の詳細は [2026-09-22-00-backlog-vuln-remediation.md](2026-09-22-00-backlog-vuln-remediation.md)。06-10 は 2026-09-23 の autonomous-task-closer で完了（アーカイブ履歴参照）。

- [2026-09-22-11-backlog-defense-in-depth-hardening.md](2026-09-22-11-backlog-defense-in-depth-hardening.md)（🔵 監視中 — RICE 1.0・監視 0 SP・副作用🟢。ssrfGuard 正規化・senderTrust fail-closed・`archive_update` 一貫性・レガシー KDF sunset の発火条件監視。発火時に分割 PBI 化）

### 2026-09-22 保留候補の PBI 化（トリガー待ち） — ⬜ 未着手 3件 🔧非機能追加 RICE順: 01 → 02 → 03

holistic-0921 の台帳送り2件と、2026-09-22 の差分再レビューで台帳送りにした空 catch を PBI 化。いずれも再検討トリガーが未発火のため、トリガーが発火するまで着手しない。

- [2026-09-22-01-backlog-empty-catch-audit.md](2026-09-22-01-backlog-empty-catch-audit.md)（⬜ 未着手 — RICE 2.0・1 SP・副作用🟢。非テストの空 catch 6箇所の監査と best-effort 経路の可観測化。トリガー: 握りつぶした失敗が原因の不具合報告）
- [2026-09-22-02-backlog-tagcooccurrence-relocation.md](2026-09-22-02-backlog-tagcooccurrence-relocation.md)（⬜ 未着手 — RICE 1.5・3 SP・副作用🟢。tagCooccurrence 計算層の dashboard 配下からの移設。前提: 17/21/22 のレビュー完了（2026-09-24 アーカイブ済み — 前提は消化済みで着手可能）。トリガー: compute の offscreen/パイプライン移設）
- [2026-09-22-03-backlog-local-provider-origin-rule.md](2026-09-22-03-backlog-local-provider-origin-rule.md)（⬜ 未着手 — RICE 1.0・調査1 SP / 実装3 SP・副作用🟢。ローカルプロバイダ向け Origin-strip の汎用化（investigate 込み）。トリガー: 2つ目のローカルプロバイダで CORS 対策が必要になった時）

**WASM移行バッチの全候補判定が完了（2026-09-21）**: 採用=pii-sanitizer（3.9x）・textrank（13.36x）・tag-cooccur（5.53x）。保留=sentence-dedup（実行環境制約）。不採用=md-sanitize（撤去）・prompt-scan（PBI-24 に引き継ぎ）・serde スパイク（下記アーカイブ）。次に移植するのは「計算律速であることを実測で示せたものだけ」。tag-cooccur（17/21/22）は 2026-09-24 にアーカイブ済み（アーカイブ履歴参照）。

**sentence-dedup（2026-09-20 実装・0ed11095）の配線は不採用で確定（2026-09-21）**: 唯一の呼び出し元 `src/utils/contentExtractor/index.ts` がコンテンツスクリプト（`src/content/contentKernel.ts`）専用経路で実行されるため、ページ側 CSP で WASM 初期化を保証できず、配線しても実運用ではほぼ常に TS フォールバックになる。速度利得も 1.13〜1.28x と小さく、メモリ利得（フットプリント 0.22→0.00MB/call・実測）は dedup ステージの offscreen 移設（処理順の意味論が変わるアーキテクチャ変更）と引き換えになるため、現時点では採用しない。クレート・ハイブリッド・CI ゲート（src コピー）は STAGED のまま資産保持し、将来のパイプライン移設時に再評価する。

### 2026-09-15 AMO 公開 — 🟪 審査待ち（2026-09-24 提出・審査中、審査結果対応はユーザー作業）

- 🟪 [2026-09-15-01-backlog-firefox-amo-publish.md](2026-09-15-01-backlog-firefox-amo-publish.md)（**審査待ち**: 2026-09-23 ユーザー指示で AMO 採用決定。sources zip 肥大修正・data_collection_permissions 追加・strict_min_version 140 で addons-linter errors 0。2026-09-24 に AMO 提出済み・審査中。残置は審査結果対応 — 通過後の署名版インストール確認・FAQ (ja/en) 記載、指摘時は対応記録。詳細は PBI の着手記録参照）


### 2026-09-05-32-refactor-wasqlite-sunset（ゲート付き・着手禁止）

- 2026-09-05-32-refactor-wasqlite-sunset.md（⬜ **ゲート付き**: ADR-014 ゲート 2026-12-17 到達＋診断パネル未完了報告ゼロを確認してから着手。wa-sqlite 依存・移行系削除。S。スパイク PBI-A。2026-09-14 再調査で実装ガイドを追加 — 対象リストに `wa-sqlite.d.ts` 漏れ・STATUS 公開部は `sqliteStatus.ts` が正・`migrationBackup.ts` の `extractDomain` re-export に現役依存あり）


### 将来候補の統合台帳（live）

- [2026-09-05-00-backlog-future.md](2026-09-05-00-backlog-future.md) — 旧ラウンド backlog（0831a / 0902 / 0903 / 0904 arch2・perf / 0905 arch3・arch4・arch5・review-fixes）に散在していた見送り・トリガー付き・製品判断待ち候補の統合台帳（2026-09-05 整理・2026-09-23 に 0915〜0921 ラウンド台帳の未採番候補7件を統合）。着手はトリガー別に管理。次ラウンドの architecture review はこれを入力にする
- [2026-09-22-00-backlog-vuln-remediation.md](2026-09-22-00-backlog-vuln-remediation.md) — VulnHunt 監査修正 6 PBI（06-11）の採点台帳（RICE 表・修正戦略・エクスプロイト実測）。ラウンド完遂時に随伴アーカイブ

## 運用ルール

- 新規PBIは `pbi/YYYY-MM-DD-NN-type-slug.md` として作成する
  （`type` は `feat` / `fix` / `refactor` / `doc` / `test` / `investigate`。
  ファイル名の種別がそのまま機能追加/非機能追加の判定基準になる）
- **NN は 1 日付内で通し番号（実行順の鍵）であり、重複させてはならない。**
  複数セッションが並行して PBI を作成する場合も、この INDEX の「実装順（確定）」
  セクションを確認して空き番号を採番すること。衝突が起きた場合は
  実装が進行していない側をリネームする（進行中の側を壊さない）
- 実装計画は `dev-docs/plans/YYYY-MM-DD-pbiNN-<slug>-plan.md` として作成する
- **`plans/` ディレクトリは廃止。** 今後はすべて `dev-docs/plans/` に一本化する
- **完了したPBIは `dev-docs/archived/pbi/` へ、対応する実装計画は
  `dev-docs/archived/plans/` へ `git mv` で移動する**
- 対応する dig-findings ファイル（`dev-docs/dig-findings-*.md`）は
  `dev-docs/archived/` へ `git mv` で移動する
- 移動したらこのINDEXの表から行を削除し、下の「アーカイブ履歴」に1行追記する

---

## アーカイブ履歴

完了済みPBIは [dev-docs/archived/pbi/](../dev-docs/archived/pbi/)、
その実装計画は [dev-docs/archived/plans/](../dev-docs/archived/plans/) にある。

### 2026-09-25 残債ラウンド — ✅ PBI 24 完了（アーカイブ済み）UX 裁定のみ・production code 無変更

裁定により PBI 2026-09-26-03（遷移記録基盤）の `privacyConsent.ts` 競合が解消した。
裁定の内訳と後続 PBI 分割（S-1 dashboard re-consent 入口 / S-2 denial counter reset / S-3 外部備份境界の説明）はアーカイブ済み PBI の裁定結果節を参照。

- [2026-09-25-24-investigate-privacy-reconsent-ux.md](../dev-docs/archived/pbi/2026-09-25-24-investigate-privacy-reconsent-ux.md)（✅ 完了 — 裁定記録のみ（production code 無変更）。裁定4件: ①再同意入口は dashboard の Privacy 画面（decline 後の案内が指す「設定画面」と一致し実在の導線になる。popup の常時バナーは 30 日抑制と衝突するため不採用）②明示操作は 30 日抑制を bypass するが、自動表示の抑制状態は書き換えない ③withdraw 後も履歴保持を許し、同意撤回と履歴削除を分離する ④バックアップからの履歴復元は促さない。`privacy_consent` は restore allowlist に無く、復元は同意済み状態にしない。`reconsentConsent()` は新設せず既存 API を組み合わせる。denial counter reset は `acceptConsent()` 冒頭の1行で、`resetConsentDeniedCount()` は既に存在するため後続 `fix` S-2（0.5 SP）へ切り出し。裁定により **PBI 2026-09-26-03 の `privacyConsent.ts` 競合が解消**（03 は `withdrawPrivacyConsent()` 直後、S-1 は dashboard panel、S-2 は `acceptConsent()` 冒頭で同一行を触らない））

### 2026-09-26 メタ認知分析ラウンド バッチ4 — ✅ PBI 04 完了（提案2 全体・アーカイブ済み）

提案2の最後の部分。記録経路は変えず、02 のセッションと 03 の遷移記録の
2 列から「線」を復元します。これで 2026-09-26 メタ認知分析ラウンドは
4 PBI すべて実装済みです（提案1 は採点時に不採用）。RICE 0.67・3 SP。

- [2026-09-26-04-feat-session-path-tree-search-to-goal.md](../dev-docs/archived/pbi/2026-09-26-04-feat-session-path-tree-search-to-goal.md)（✅ 完了 — コミット `e8b9649e`。`sessionPathAggregate.ts` の純関数 3 つ: `hasNavTrail`（遷移記録の有無で描画を選ぶ）、`buildSessionTree`（親の判定は「同じセッション内で自分より前にあり流入元が自分の URL と一致する記録のうち最も新しいもの」。両側を `normalizeNavUrl` で正規化し、親は必ず前の記録なので循環しない）、`computeSearchToGoal`（検索エンジン始まりのセッションを最終ページのタグで集計、2 セッション未満は除外、タグなしは `(untagged)` として集計から落とさない、平均ページ数は小数1桁・平均分は整数）。遷移記録が有効なら展開部は入れ子の `<ul>`、冒頭の検索語は木の上に1行だけ（先頭ノードの行側は抑制して二重表示を回避）。オフなら従来どおり平坦な一覧。同意の読み込みは `Promise.all` で並列化し、読み込み失敗は false 扱いにしてパネル全体を落とさない。集計対象は表示中のセッション（最大100件）。ガイド（ja/en）に解決ページの定義・指標の限界・有効化手順を記載。新規テスト 28 件で validate 14,012 green / build PASS。**未実施**: Chrome 実機での手動確認、コードレビュー）

### 2026-09-26 メタ認知分析ラウンド バッチ3 — ✅ PBI 03 実装完了（アーカイブ済み・一部 DoD 未実施）

提案2のうち「遷移記録の基盤」。記録するデータ自体が増える変更（新規データ種別2列）のため、
DoD の手動確認とセキュリティレビューは未実施のまま残す。RICE 0.32・5 SP。

- [2026-09-26-03-feat-navigation-trail-recording.md](../dev-docs/archived/pbi/2026-09-26-03-feat-navigation-trail-recording.md)（✅ 実装完了 — コミット `4d2c60c7`。`nav_source_url` / `search_query` の 2 列を SQLite に追加（SCHEMA_SQL・COLUMN_NAMES・MIGRATION_COLUMNS・rowCodec の coerceCell・browsingLogCodec・migrationBackup の LEGACY_MISSING_COLUMNS・opfsRecovery）。機能別同意 `nav_trail_consent`（端末固有・DEFAULT_SETTINGS と restore allowlist の外側）。`navTrailTracker` は `chrome.storage.session` + Mutex でタブ単位の流入元を追跡し、シークレットタブは追跡しない。同意 OFF・撤回時は追跡状態を破棄し、撤回時は nav_trail も自動で無効化。2 列は UPDATE 不可・再生成対象外。`check-privacy.mjs` は「同意バージョン」と照合（`PRIVACY_POLICY_VERSION` は `2026-09-08` のまま据え置き）。`public/PRIVACY.md` と `docs/PRIVACY.md` はバイト一致。i18n 8 キー（ja/en）。新規テスト 53 件で validate 13,984 green / build PASS / release:check privacy・e2e PASS。**未実施**: Chrome 実機での手動確認（検索 → 記事 → セッション表示）、`SECURITY_REVIEW_GUIDE` によるセキュリティレビュー）

### 2026-09-26 メタ認知分析ラウンド バッチ2 — ✅ PBI 02 完了（アーカイブ済み）

提案2のうち「既存データで作れる部分」。01 の `NameCount` を再利用し、記録を
時刻の近いまとまり（セッション）へ分解します。03・04 の表示先になります。RICE 0.75・2 SP。

- [2026-09-26-02-feat-research-session-grouping.md](../dev-docs/archived/pbi/2026-09-26-02-feat-research-session-grouping.md)（✅ 完了 — コミット `0ce3819a`。区切り 5/15/30/60 分（既定 30）で記録をまとめ、`<details>` で開始日時・ページ数・分数・上位タグ（タグ OFF なら上位ドメイン）を提示。区切り変更は手元データの再集計のみで再取得なし、期間変更のみ取り直す。分割は「設定値보다大きいとき」で等しい場合は同一セッション。単独ページは件数として分離。集計は純関数 `researchSessionAggregate.ts`。上限 10000 行・表示 100 セッション。i18n 13 キー（ja/en）。新規テスト 23 件で validate 13,931 green / build PASS。コードレビューは未実施）

### 2026-09-26 メタ認知分析ラウンド バッチ1 — ✅ PBI 01 完了（アーカイブ済み）

提案3（ループ課題・タイムカプセル）と 09-24 台帳の「再訪分析」を統合した PBI。
`fetchAllPeriodRows` と `NameCount` をここに新設し、02 が再利用します。RICE 1.60・3 SP。

- [2026-09-26-01-feat-revisit-loop-time-capsule.md](../dev-docs/archived/pbi/2026-09-26-01-feat-revisit-loop-time-capsule.md)（✅ 完了 — コミット `da98b1c9`。4区分（ループ / 再訪ランキング / 休眠テーマ / 52週前の週）を1パネルで提示し、`## key` + `- YYYY-MM-DD [title](url)` 形式への Markdown コピーを提供。`domainAnalysisPanel` のローカル `fetchAllRows` を `fetchPeriodRows.ts` の `fetchAllPeriodRows` へ移設して keyset ページングを共通化（ページサイズは `QUERY_CAPS.plain` 参照で drift 不能）。集計は純関数 `revisitInsightsAggregate.ts`、閾値は `REVISIT_CONFIG` に集約。i18n 30 キー（ja/en）。新規テスト 33 件（集計 17・lifecycle 9・ページング 7）で validate 13,908 green / build PASS。コードレビューは未実施）

### 2026-09-26 メタ認知分析ラウンド — ⬜ 未着手 3件 ✨機能追加
### 2026-09-25 Checking Team 残債ラウンド — ✅ 7件完了（01・03・04・05・08・09・20 アーカイブ済み）

autonomous-task-closer による回収。01/03/04/05/08/09 は実装コミット・DoD チェックボックス・`npm run validate`（13,875 tests green）を実測確認した上でアーカイブした新規実装不要の DoD 反映漏れ。20 は未着手だったため ADR を作成して実装した。

- [2026-09-25-01-fix-transport-replay-safety.md](../dev-docs/archived/pbi/2026-09-25-01-fix-transport-replay-safety.md)（✅ 完了 — `c12cacde` + レビュー対応 `4b6d75ab`。retry-safe 18 / retry-unsafe 14 の最終裁定、insert 系は fail-closed へ撤回、判定源も一本化。DoD 18/18 `[x]` 確認済み。RICE 20.0）
- [2026-09-25-03-refactor-previewonly-flag-cleanup.md](../dev-docs/archived/pbi/2026-09-25-03-refactor-previewonly-flag-cleanup.md)（✅ 完了 — `6044e984`。`RecordOptions` から `previewOnly` を削除し `RecordingOrchestrator` の `data.previewOnly` 単一判定へ。DoD 18/18 `[x]` 確認済み。RICE 8.0）
- [2026-09-25-04-fix-obsidian-get-retry.md](../dev-docs/archived/pbi/2026-09-25-04-fix-obsidian-get-retry.md)（✅ 完了 — `b0c3d570`。接続確認 GET のみ 500/502/503/504 ＋ network/timeout を対象に最大 3 回の指数バックオフ（`obsidianClient.ts` の retryableStatusCodes）。書き込み経路は対象外。DoD 23/23 `[x]` 確認済み。RICE 4.0）
- [2026-09-25-05-fix-trustchecker-legacy-dead-code.md](../dev-docs/archived/pbi/2026-09-25-05-fix-trustchecker-legacy-dead-code.md)（✅ 完了 — `b9ee19cc`。trust 設定のレガシー storage 経路を Trust DB に一本化。`src/` 内のレガシー trustchecker 参照 0 件を確認。DoD 21/21 `[x]` 確認済み。RICE 3.0）
- [2026-09-25-08-doc-trust-record-policy-correction.md](../dev-docs/archived/pbi/2026-09-25-08-doc-trust-record-policy-correction.md)（✅ 完了 — `1a121c74`。ガイド（日英）に記録可否の列を追加し、blog の誤記述と production が生成しない fixture を是正。DoD 19/19 `[x]` 確認済み。RICE 2.0）
- [2026-09-25-09-fix-popup-untranslated-title-token.md](../dev-docs/archived/pbi/2026-09-25-09-fix-popup-untranslated-title-token.md)（✅ 完了 — `13721302`。`title="Browse History"` と `stroke="#2E7D32"` の raw 属性が 0 件であることを grep 確認、`aria-label` は維持。DoD 17/17 `[x]` 確認済み。RICE 2.0）
- [2026-09-25-20-doc-messaging-layer-decision-record.md](../dev-docs/archived/pbi/2026-09-25-20-doc-messaging-layer-decision-record.md)（✅ 完了 — ADR `2026-09-25-messaging-background-reverse-dependency.md` を新設し「逆依存を許容・現状維持」の判断と再検討トリガー3項目を記録。実コード無変更。ADR README の一覧が 2026-08-12 で止まっていたドリフトも併せて回復（未掲載7件を追記）。整合3テスト 97 green。RICE 1.0）

### 2026-09-24 arch-delivery-loop ラウンド バッチ6-7 — ✅ 2件完了（15・16 アーカイブ済み）RICE順: 15 → 16（直列）

arch-delivery-loop による実装。直列チェーン完結（09-16 全8件）。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-15-refactor-max-query-rows-ssot.md（✅ 完了 — `b9a1e8ef`。computeLimits に MAX_QUERY_ROWS = QUERY_CAPS.plain（参照派生）・limits-drift pin 追加・3パネルのローカル宣言削除。77 tests 対象 green。RICE 6.0）
- 2026-09-24-16-refactor-i18n-msg-helper.md（✅ 完了 — `b9a1e8ef`。getMessageWithSubstitutions を utils/i18n に新設・6パネルのローカル msg 削除・PBI 14 由来の lastFetchCapped デッドフラグを削除。全パネル 707 tests green。RICE 6.0）

### 2026-09-24 arch-delivery-loop ラウンド バッチ4-5 — ✅ 2件完了（13・14 アーカイブ済み）RICE順: 13 → 14（直列）

arch-delivery-loop による実装。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-13-refactor-navigate-to-history-helper.md（✅ 完了 — `8d365e68`。navigateToHistory ヘルパー新設（4ケーステスト付き）・6パネル置換。tagsPanel は挙動保存のため現状維持（記録済み逸脱）。130 tests 対象 green。RICE 7.0）
- 2026-09-24-14-refactor-panel-notices.md（✅ 完了 — `8d365e68`。PanelNotices 新設（empty/error 統一・fetchScoped・resetForReaggregate）・8パネル移行・失敗ポリシー一本化（新 i18n キー3種）。158 tests 対象 green。RICE 6.4）

### 2026-09-24 arch-delivery-loop ラウンド バッチ2-3 — ✅ 2件完了（10・11 アーカイブ済み）RICE順: 10 → 11（直列）

arch-delivery-loop による実装。直列チェーン先頭の2件（同一パネルファイル群のため直列）。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-10-refactor-fetch-period-rows.md（✅ 完了 — `06b5a597`。fetchPeriodRows 新設（{rows,total,capped}・throw 統一・pickDefined でキー省略を一元化）・8ラッパー削除（参照ゼロ）・tagCluster にエラー状態。146 tests 対象 green。RICE 10.7）
- 2026-09-24-11-refactor-period-filter-contract.md（✅ 完了 — `06b5a597`。構築中 emit 廃止・getRange() 単一ソース化・filterReady×3 削除・二重同期×7 解消・labelKeys 注入。141 tests 対象 green。RICE 9.3）

### 2026-09-24 arch-delivery-loop ラウンド バッチ1 — ✅ 2件完了（09・12 アーカイブ済み）RICE順: 09, 12（並列）

arch-delivery-loop による実装。バッチ1 = 09（リテラル SSOT）+ 12（i18n ゲート）の依存なし並列。validate ゲート PASS（13,799 tests）。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-09-refactor-summary-fallback-ssot.md（✅ 完了 — `6521cdb9`。utils/summaryFallback.ts（Layer 0）に SSOT 化・背景4箇所+dashboard の import 化・LAYERS.md 規約追記・lint:layers-docs green。174 tests 対象 green。RICE 20.0）
- 2026-09-24-12-test-i18n-panel-catalog-gates.md（✅ 完了 — `6521cdb9`。実 locale の parity テストを新設、サイドバー i18n キー assert、PANEL_CATALOG 側カウント literal 削除。実 drift（historyDeleteSelectedSuccess_one/_other の ja 欠落）を検出修正。tagClusterTab は既存のため追加不要と検証。RICE 8.0）

### 2026-09-24 分析機能強化ラウンド バッチ6 — ✅ PBI 07 ユーザー確認完了・アーカイブ（ラウンド完遂）

STEP 0 の実データ手動プローブをユーザー確認（実データで抽出品質に問題なし・ストップワード/最小長閾値の調整不要）で完了し、07 をアーカイブ。これで分析機能強化ラウンド全8件が完遂。台帳（analysis-features）は台帳送り5案を保持して live 維持。

- 2026-09-24-07-feat-word-cluster.md（✅ 完了 — `d80a5f8b`・69 tests 対象 green。ユーザー検証 1 項目は 2026-09-24 に解消。RICE 1.33・3 SP）

### 2026-09-24 分析機能強化ラウンド バッチ5 — ✅ 1件完了（08 アーカイブ済み）RICE順: 08

autonomous-task-closer による実装。バッチ5 = 08（タグクラスタ時間変化比較・最複雑候補）単独。なぜなぜ分析は /tmp/whywhy/（pbi-08-tag-cluster-time-slider）。統合検証: type-check PASS / lint 0 errors / test 13,784 green / build PASS。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-08-feat-tag-cluster-time-slider.md（✅ 完了 — `c6bf8e00`。2時点指定（date input×2+明示 Compare）で前半/後半を side-by-side 2×SVG 表示＋diff 4 区画。FNV-1a 安定配色（両テーマ 4.5:1 超をテスト担保）・union ソート順安定配置・loadSeq 世代ガード・行 cap 通知×2・aria-live 完了サマリー（PBI 04 延期分を本 PBI で実装）。アニメーションはユーザー確定どおりスコープ外。71 tests 対象 green。RICE 0.20）

### 2026-09-24 分析機能強化ラウンド バッチ4 — 🔶 PBI 07 実装完了（ユーザー検証 1 項目で live 維持）

autonomous-task-closer による実装。バッチ4 = 07（ワードクラスタ）単独。実装・自動テストは完了（`d80a5f8b`・69 tests 対象 green・統合側で行 cap 通知の BDD ギャップを検出修正）。STEP 0 の実データ手動プローブ（ストップワード/閾値チューニング）はユーザーの実 DB が必要なため未達 — PBI 07 は 🔶 部分実装として pbi/ に live 維持。なぜなぜ分析は /tmp/whywhy/（pbi-07-word-cluster）。統合検証: type-check PASS / lint 0 errors / test 13,747 green / build PASS。

### 2026-09-24 分析機能強化ラウンド バッチ3 — ✅ 2件完了（05-06 アーカイブ済み）RICE順: 05 → 06

autonomous-task-closer による実装。バッチ3 = 05（タグ頻度の期間推移）→ 06（タグ共起ペア表）の直列実装。なぜなぜ分析は /tmp/whywhy/（pbi-05-tag-frequency-timeline・pbi-06-tag-cooccurrence-table）。統合検証: type-check PASS / lint 0 errors / test 13,694 green / build PASS。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-05-feat-tag-frequency-timeline.md（✅ 完了 — `5ae1773e`。手描き SVG 積み上げ推移・日曜開始週（暦日演算で DST ズレ回避）・端数週1バケット・other 分離・数値テーブル。62 tests 対象 green。RICE 2.40）
- 2026-09-24-06-feat-tag-cooccurrence-table.md（✅ 完了 — `5ae1773e`。既存 edges 再利用の top 20 表・ノード select 方式のタグフィルタ・空状態3区分。78 tests 対象 green。RICE 2.40）

### 2026-09-24 分析機能強化ラウンド バッチ2 — ✅ 2件完了（03-04 アーカイブ済み）RICE順: 03 → 04

autonomous-task-closer による実装。バッチ2 = 03（ドメイン分析）→ 04（期間指定タグクラスタ・PBI 08 の計算基盤）の直列実装。なぜなぜ分析は /tmp/whywhy/（pbi-03-domain-analysis・pbi-04-period-tag-cluster）。統合検証: type-check PASS / lint 0 errors / test 13,637 green / build PASS。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-03-feat-domain-analysis.md（✅ 完了 — `b39209af`。ドメイン/URL別 top N・batched pagination（50k cap+truncation 通知）・(unknown) バケット・ドメイン行は searchDomain 遷移。52 tests 新規。RICE 3.00）
- 2026-09-24-04-feat-period-tag-cluster.md（✅ 完了 — `b39209af`。tagClusterPanel に共有 periodFilter 埋め込み・デフォルト全期間で後方互換・loadSeq 世代ガード。既存テスト無変更で green。51 tests 対象 green。RICE 2.40。PBI 08 前提が整備済み）

### 2026-09-24 分析機能強化ラウンド バッチ1 — ✅ 2件完了（01-02 アーカイブ済み）RICE順: 01 → 02

autonomous-task-closer による実装。バッチ1 = 01（ヒートマップ）→ 02（閲覧時間分析＋共有期間フィルタ部品新設）の直列実装（パネル配線ファイル重複のため並列化は見送り）。なぜなぜ分析は /tmp/whywhy/（pbi-01-heatmap・pbi-02-visit-duration）。統合検証: type-check PASS / lint 0 errors / test 13,610 green / build PASS。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-24-01-feat-time-heatmap.md（✅ 完了 — `1455e34a`。曜日7×時間帯24ヒートマップ・直近12ヶ月固定・数値テーブル併記。29 tests 新規。RICE 4.00）
- 2026-09-24-02-feat-visit-duration-analysis.md（✅ 完了 — `1455e34a`。ドメイン/タグ別滞在時間ランキング・未計測率表示。共有部品 `src/dashboard/components/periodFilter.ts` 新設（03-08 が再利用）。56 tests 新規。RICE 3.20。実データの `visit_duration` は現行記録経路で常に null のため未計測率100%表示が既定挙動）

### 2026-09-24 arch-delivery-loop 台帳消化 — ✅ 4件完了（DoD反映漏れをアーカイブ）

実装・コミット済みだが DoD チェックボックス反映とアーカイブが漏れていた4件（2026-09-20-17 は `ddfa6d4f` で既にアーカイブ済みと判明、`pbi/` 側の重複コピーを削除）。再検証してから DoD を `[x]` 化。

- 2026-09-22-04-feat-ai-summary-regenerate.md（✅ 完了 — `5580e994`/v6.9.16。履歴ヘッダーから手動再生成 + 緩和3択select、同一行 UPDATE。`npm run validate` 13,563 テスト緑 + regenerate 関連36テストで再検証。RICE 0.96）
- 2026-09-22-05-feat-extraction-overcut-guards.md（✅ 完了 — `5580e994`/v6.9.16。過剰削減ガードを①候補選択・②Content Cleansing へ横展開。qa.smbc 実サイト手動確認は v6.9.16 実運用実績により実施済み扱い（ユーザー確認 2026-09-24）。RICE 1.75）
- 2026-09-20-21-feat-tag-cooccur-panel-wiring.md（✅ 完了 — コミット 395d0896。tagClusterPanel をハイブリッド配線、STAGED解除。目視確認・PRレビューは本番利用実績により実施済み扱い（ユーザー確認 2026-09-24）。RICE 16.0）
- 2026-09-20-22-chore-tag-cooccur-ci-gate.md（✅ 完了 — コミット 05e65cb5、後続の crates.json SSOT化（26011549 等）で tag-cooccur が cache-paths/parity-args/cmp check に完全統合されていることをテスト26件で確認（ユーザー確認 2026-09-24）。RICE 12.0）

### 2026-09-23 arch-delivery-loop 第3ラウンド（archloop-0923c）— ✅ 5件完了（11-15 アーカイブ済み）RICE順: 11 → 12 → 13 → 14 → 15

Phase 0 診断（HTML レポート: `$TMPDIR/architecture-review-20260923-0907.html`、6候補・前回除外済み項目は再掲なし）→ Phase 1 RICE スコアリングの残存手配線刈りラウンド。RICE 降順・依存なしで1件ずつ直列実装。採点の詳細と未採用候補（Retry-policy は live 台帳へ）は [2026-09-23-00-backlog-archloop-0923c.md](../dev-docs/archived/pbi/2026-09-23-00-backlog-archloop-0923c.md)。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-23-11-refactor-remove-deprecated-hmac-twins.md（✅ 完了 — 生産 importer 0 を確認して双子削除。4 テストは HmacSigner へ 1:1 移行。3c11b96a・RICE 25.0）
- 2026-09-23-12-refactor-bytestats-forwarding-adapter.md（✅ 完了 — `pickRecordDiagnostics` を builder に所有、4 箇所を spread 1 行に。SAVE maskedCount 除外は構造的に維持、`ByteStatsPayload` に `cleansedReason?` を追加。9a81b798・RICE 16.0）
- 2026-09-23-13-refactor-maintain-wire-table.md（✅ 完了 — maintain 7 行を表に移し switch を約 10 行 dispatch に。両方向同期 assert＋decode 必須化で query/mutate と同水準。f42e32b4・RICE 12.8）
- 2026-09-23-14-refactor-popup-tab-seam.md（✅ 完了 — tabUtils に 4 Adapter、素クエリ 2 箇所・独自パース 1 箇所・store 重複読みを寄せる。生産クエリは 1 箇所のみ、null 振る舞いは pin。e415c52d・RICE 6.4）
- 2026-09-23-15-refactor-preset-repository-migration.md（✅ 完了 — presetSettingsAdapter 新設、素接触 0 を grep 確認、read は blob→旧キー fallback。ef3a1068・RICE 4.0）

### 2026-09-23 arch-delivery-loop 第2ラウンド（archloop-0923b）— ✅ 5件完了（06-10 アーカイブ済み）RICE順: 06 → 07 → 08 → 09 → 10

Phase 0 診断（HTML レポート: `$TMPDIR/architecture-review-20260923-0710.html`、7候補・前回除外済み項目は再掲なし）→ Phase 1 RICE スコアリングの録画 path 深層化ラウンド。RICE 降順・依存なしで1件ずつ直列実装。採点の詳細と未採用候補（CleansingRuleView・KeyDerivation は live 台帳へ）は [2026-09-23-00-backlog-archloop-0923b.md](../dev-docs/archived/pbi/2026-09-23-00-backlog-archloop-0923b.md)。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-23-06-refactor-remove-tabutils-isrecordable-shim.md（✅ 完了 — 生産 importer 0 を確認して shim 削除。gate-table テストが 5 ケースを全カバー。7bd047f8・RICE 15.0）
- 2026-09-23-07-refactor-save-phase-module.md（✅ 完了 — `savePhase.save()` 唯一 Seam、retry 投影は手書き集合と完全一致、closure 注入廃止・sqlite 欠如 skip を明示化。5dbceddc・RICE 12.8）
- 2026-09-23-08-refactor-visit-gating-module.md（✅ 完了 — `evaluate(state, now)` 寿命一元化、kernel 533→370 行、scheduler 分離。pre-init・E2E 形状・scroll 分割は不変。9fe5a9ae・RICE 10.7）
- 2026-09-23-09-refactor-extraction-report-module.md（✅ 完了 — `extract(config) → { content, report }`、hot path バイト同一、whitelist path も report 統一。pageContentPipeline の移行は次回対象。8cbcc739・RICE 8.0）
- 2026-09-23-10-refactor-trust-lookup-module.md（✅ 完了 — `lookup`/`decideAlert` 単一 async Seam、sync 双子は生産呼び出し 0 のため廃止、legacy 分岐は test-only 化。88f45e92・RICE 6.0）

### 2026-09-23 arch-delivery-loop ラウンド（archloop-0923）— ✅ 5件完了（01-05 アーカイブ済み）RICE順: 01 → 02 → 03 → 04 → 05

Phase 0 診断（HTML レポート: `$TMPDIR/architecture-review-20260923-0405.html`、7候補）→ Phase 1 RICE スコアリングのコードベース深層化ラウンド。RICE 降順・依存なしで1件ずつ直列実装。採点の詳細と未採用候補（06 ProviderSlotRunner・07 queryPlan 圧縮は live 台帳へ）は [2026-09-23-00-backlog-archloop-0923.md](../dev-docs/archived/pbi/2026-09-23-00-backlog-archloop-0923.md)。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-23-01-refactor-history-diagnostics-deep-module.md（✅ 完了 — 診断表示を `renderEntryDiagnostics` / `renderCleansingBar` の深い Module に統合、View 1169→1012 行、15 fixture characterization で全 30 ブランチバイト等価。Panel 側に複製表は実在せず単一所有のみ。5d7159e9・RICE 24.0）
- 2026-09-23-02-refactor-sqlite-client-deep-seam.md（✅ 完了 — 三重 runner を表駆動単一 runner に統合、`sqliteClient.call(op, payload)` 1 本化、30 named op は互換エイリアス、export/import 2 呼び出し側を移行、decode 所有を wire-table 側へ。駆動行の retry 明示あり。69f7d2c5・RICE 17.1）
- 2026-09-23-03-refactor-settings-form-descriptor-table.md（✅ 完了 — fieldDescriptor.ts SSOT、token 範囲を `validateMaxTokens` に一本化（gemini 8192 等の provider 別上限が UI にも反映）、trustSettings を lazy init 化して DOM なし import を pin。d9b7cab7・RICE 11.2）
- 2026-09-23-04-refactor-wasm-hybrid-policy-adapters.md（✅ 完了 — `runHybrid` 汎用 interface、4 ハイブリッドを政策 Adapter 行に。parity 戦略・フォールバック語義・しきい値・warn 文言は不変。bf765e98・RICE 8.0）
- 2026-09-23-05-refactor-recording-gate-table.md（✅ 完了 — 中立層 recordingGateTable.ts に precedence 1 表、`evaluateGates` 唯一 Seam、5 step は Adapter、popup を中立表に統一、content は row・述語を共有（合流は follow-up）。0533fc21・RICE 7.5）

### 2026-09-23 autonomous-task-closer — VulnHunt 監査修正 — ✅ 5件完了（06-10 アーカイブ済み）RICE順: 06 → 07 → 08 → 09 → 10

2026-09-22 に採点済みだった VulnHunt 監査修正 6 PBI のうち着手可能な 5 件（06-10）を実装。バッチ1 = 06/08/09/10 の4件をファイル非重複で並列実装 → バッチ2 = 07 を直列実装（06 と 07 が `cspValidator.ts` を共有するため）。11 は監視契約として live 残置。なぜなぜ分析は /tmp/whywhy/（vuln-001〜006）。各バッチ統合後の検証: type-check PASS / lint 0 errors / test 13,358 passed（+149）/ build PASS。GitHub PR レビューが残（ユーザー作業）。

- 2026-09-22-06-fix-obsidian-host-credential-pairing.md（✅ 完了 — 上書き host × 保存済みキーのペアリング禁止・host 検証の実質化・skipCspValidation 撤去 + CSP 保存済み origin 認可・TEST_OBSIDIAN バリデータ行・UI ミラー単一実装化。新規リモート host のテスト接続は「保存してからテスト」へ（設計裁定記録済み）。ac23f5d4。RICE 48・順位1）
- 2026-09-22-07-fix-provider-baseurl-authorization.md（✅ 完了 — origin 認可4層（pinned/既知/確認済み/loopback）・Gemini/BuiltInAi ゲート・addBaseUrlDomain 非自己認可化・ALLOWED_URLS シード+fail-closed・確認ダイアログ（デバイスローカル記録・export/import 除外）。8584718a。RICE 24・順位2）
- 2026-09-22-08-fix-archive-restore-resource-caps.md（✅ 完了 — ワーカ側シーリング（20万行/200MiB）を検証・復元両経路で適用、ARC_CAP_001/002・ファイルサイズ再計測。31b1b988。RICE 12・順位3）
- 2026-09-22-09-fix-message-field-validation.md（✅ 完了 — ByteStats 9フィールド範囲検証（wire=拒否・mapper=clamp の2層）・reasons[] 上限・SAVE maskedCount 呼び出し元値破棄。12be74b3。RICE 7.0・順位4）
- 2026-09-22-10-fix-rate-limiter-domain-key.md（✅ 完了 — eTLD+1 独立モジュール（最小マルチラベル TLD 9件）+ キー eTLD+1 化・localhost/IP はポート込み・固定 origin 前提 pin・副共有窓テスト。a6b37c60。RICE 7.0・順位5）

### 2026-09-21 promptSanitizer ハードニング（PBI-19 不採用の引き継ぎ） — ✅ 1件完了（24 アーカイブ済み）

PBI-19（プロンプトスキャンのWASM移植）を STEP 0 プローブで判定 → **不採用**（転送シェア1〜2%で計算律速だが絶対値 sub-ms・パリティリスク最大・上限化は TS で可能。プローブ記録はアーカイブ済み PBI-19 内）。WASM 移植が担う予定だった DoS 耐性と堅牢化の価値を TS ハードニングとして引き継ぎ、実装完了（コミット c999b8ed）。

- 2026-09-21-01-fix-prompt-sanitizer-hardening.md（✅ 実装完了・コミット c999b8ed — ①置換中イテレーションのマッチ取りこぼし（RED実証→範囲収集1パス適用で修正）②マッチ件数 fail-open 上限1,000件 ③制御文字ループの regex 化（bit等価）④**追加発見**: `new RegExp(source, 'gi')` 再構築で `m` フラグが脱落し複数行の `^` アンカーが無効だったバグを修正（pattern.flags 保持）。promptSanitizer 系 139 tests・validate 12,712 green。GitHub PR レビューが残）

### 2026-09-21 arch-delivery-loop 0921b（差分） — ✅ 5件完了（26-30 アーカイブ済み）RICE順: 26 → 27 → 28 → 29 → 30

ラウンド2完了直後の差分診断（前ラウンド新コード + PBI-18 宣言済み follow-up + R4 トリガー再評価）。5候補を RICE 採点して実装。全5件がファイル非重複のため1バッチ並列実装。台帳送りは新規ゼロ（P3/P4 トリガー不発のまま据え置き・R4 は 28 でクローズ）。台帳は [2026-09-21-00-backlog-archloop-0921b.md](../dev-docs/archived/pbi/2026-09-21-00-backlog-archloop-0921b.md)。HTML レポート: `$TMPDIR/architecture-review-0921b.html`。

- [2026-09-21-26-refactor-manifest-adoption-completion.md](../dev-docs/archived/pbi/2026-09-21-26-refactor-manifest-adoption-completion.md)（✅ 完了 — libCrates+paritySuites を manifest に追加し loader サブコマンド（test/test-dirs/cache-paths/parity-args）で test:wasm・ci cache/step/parity を駆動。3列挙とも旧リストと byte 同一を実証。CSP prose・CONTEXT.md 更新。コミット 2601154。RICE 32・順位1）
- [2026-09-21-27-refactor-wasm-success-mock-migration.md](../dev-docs/archived/pbi/2026-09-21-27-refactor-wasm-success-mock-migration.md)（✅ 完了 — pii/tag-cooccur の wasm-success mock を createNodeWasmInit へ移行（module_or_path 残存ゼロを実証）+陳腐 doc 2行。コミット 271c405・14 green。RICE 16・順位2）
- [2026-09-21-28-refactor-privacy-predecision-pending-builder.md](../dev-docs/archived/pbi/2026-09-21-28-refactor-privacy-predecision-pending-builder.md)（✅ 完了 — pre-decision で bypass subset（force||whitelisted）のみ fetch スキップ（素の pre-allow では isPrivate 未確定のため不可と判定し記録）+ buildPendingPage(input, now) 純粋関数抽出（clock 注入・旧 timestamp/expiry 1ms 差異解消）。コミット b6a7e0f・72 green。RICE 10・順位3）
- [2026-09-21-29-refactor-opfs-search-input-union.md](../dev-docs/archived/pbi/2026-09-21-29-refactor-opfs-search-input-union.md)（✅ 完了 — input を判別共用体化し誤用をコンパイルエラー化・スナップショット byte 等価。コミット e8eb2cc・14 green。RICE 6・順位4）
- [2026-09-21-30-refactor-extract-apply-pair-retirement.md](../dev-docs/archived/pbi/2026-09-21-30-refactor-extract-apply-pair-retirement.md)（✅ 完了 — 両 deps interface を extractAndCommit のみに narrow・fallback 分岐と非null assertion 削除・facade 既定引数廃止。config 既定は kernel 内1解決点（裁定記録）。コミット a778856・477 green。RICE 4.8・順位5）

### 2026-09-21 arch-delivery-loop 0921 — ✅ 9件完了（17-25 アーカイブ済み）RICE順: 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25

holistic-0921 + closer 完了後の第2回 arch-delivery-loop。3クラスタ診断（WASM / 永続化 / 録画パイプライン+コンテンツ抽出）→ 12候補 → RICE 採点で9 PBI 化 + 台帳送り3件（P3/P4/R4）。バッチA（17/18/19/20 並列）→ バッチB（21/22/23/25 並列）→ バッチC（24・wasm-pack 再構築で直列）。20 は実装中に fts 既定 50 が background 専有と判明し planner seam 側へ移植（DEFAULT_SEARCH_LIMIT）。台帳は [2026-09-21-00-backlog-archloop-0921.md](../dev-docs/archived/pbi/2026-09-21-00-backlog-archloop-0921.md)（アーカイブ済み。未採番候補 P3/P4 は future.md に統合）。HTML レポート: `$TMPDIR/architecture-review-1789987425.html`。

- [2026-09-21-17-refactor-pipeline-text-selector.md](../dev-docs/archived/pbi/2026-09-21-17-refactor-pipeline-text-selector.md)（✅ 完了 — pipelineText.ts 純粋 selector・format step が truncatedContent 脚を獲得（BDD要件）以外 byte 等価。配置は background/pipeline（utils→background 逆辺の回避を実証）。コミット 9e3bf74・41 green。RICE 32・順位1）
- [2026-09-21-18-refactor-wasm-crate-manifest.md](../dev-docs/archived/pbi/2026-09-21-18-refactor-wasm-crate-manifest.md)（✅ 完了 — wasm/crates.json SSOT + build-wasm.mjs/wasm-crates.mjs/stash|restore|check gate。解決済みビルドプラン15 op が旧 chain と byte 同一を実証。STAGED は publicShip field に。コミット bb37635。RICE 32・順位2）
- [2026-09-21-19-refactor-tagcooccur-fallback-runtime.md](../dev-docs/archived/pbi/2026-09-21-19-refactor-tagcooccur-fallback-runtime.md)（✅ 完了 — withWasmFallback 統一+u32 上限を hybrid policy へ移動。console colon は他3 hybrid 標準に統一（golden pin）。コミット 706eeb6・72 green。RICE 24・順位3）
- [2026-09-21-20-refactor-dashboard-read-policy-seam.md](../dev-docs/archived/pbi/2026-09-21-20-refactor-dashboard-read-policy-seam.md)（✅ 完了 — readOnlyHandler を projection 専用化+background→offscreen import 解消。fts 既定 50 は background 専有と判明したため planSearch に DEFAULT_SEARCH_LIMIT=50 を移植（SQLITE_SEARCH 直送路も同一既定に統一）。コミット d7d4c4c。RICE 24・順位4）
- [2026-09-21-21-refactor-recording-skip-decisions.md](../dev-docs/archived/pbi/2026-09-21-21-refactor-recording-skip-decisions.md)（✅ 完了 — decideSaveSkip/decideL0 を seam に追加。ログ文言 byte 等価。コミット fd868b0・62 green。RICE 20・順位5）
- [2026-09-21-22-refactor-node-wasm-test-loader.md](../dev-docs/archived/pbi/2026-09-21-22-refactor-node-wasm-test-loader.md)（✅ 完了 — src/wasm/testing/initWasmForNode.ts + createNodeWasmInit（vi.mock 用）に10サイト移行（実数は診断の ~8 を修正）。コミット 5a2c4a1。RICE 16・順位6）
- [2026-09-21-23-refactor-opfs-search-skeleton.md](../dev-docs/archived/pbi/2026-09-21-23-refactor-opfs-search-skeleton.md)（✅ 完了 — searchExecution.ts runOpfsSearch 新設・SQL/params スナップショット byte 安定。IDB は3注入が call site を悪化させるため S 着地と判断（記録済み）。コミット cc61e97。RICE 10・順位7）
- [2026-09-21-24-refactor-js-whitespace-set-ssot.md](../dev-docs/archived/pbi/2026-09-21-24-refactor-js-whitespace-set-ssot.md)（✅ 完了 — is_js_ws_code(u32) を js-strings に SSOT 化、tag-cooccur は委譲・pii-sanitizer は全スカラー exhaustive 一致テスト。cargo test 5クレート + TS パリティ 341 green・バイナリ再コミット。コミット 8aef932。RICE 9.6・順位8）
- [2026-09-21-25-refactor-contentkernel-extract-commit.md](../dev-docs/archived/pbi/2026-09-21-25-refactor-contentkernel-extract-commit.md)（✅ 完了 — extractAndCommit 深い呼び出し追加・extractor.ts facade も deep call 優先配線。コミット 2e30490 + 1df8994（extractor 配線）・86+155 green。RICE 6.4・順位9）

### 2026-09-21 大局的コード改善（holistic-0921） — ✅ 15件完了（02-16 アーカイブ済み）

4観点（DRY / SoC / 拡張性 / 堅牢性）の並列サブエージェント調査 + 統合側全指摘の実コード裏取りで抽出した15候補を RICE 採点して実装。バッチ1（02/03/04/05/08 5並列）→ バッチ2（06/07/09/10/12 5並列・07 は統合側が引き取り）→ バッチ3（13→14→15 直列チェーン）→ バッチ4（11/16 2並列）。統合検証: type-check PASS / lint 0 errors / test 12,839 passed / build PASS。台帳は [2026-09-21-00-backlog-holistic-0921.md](../dev-docs/archived/pbi/2026-09-21-00-backlog-holistic-0921.md)（アーカイブ済み。台帳送り3件は 2026-09-22 の保留候補 PBI 01/02/03 として採番済み）。既存進行中 PBI（13/14/16/2026-09-19-08）はユーザー裁定で後日 autonomous-task-closer に委ねる。

- [2026-09-21-02-fix-persite-overrides-lock.md](../dev-docs/archived/pbi/2026-09-21-02-fix-persite-overrides-lock.md)（✅ RICE 19.2・raw set 握り潰しを単一 writer 化+失敗可視化。contentKernel 読み取りが settings 経由と実証し raw set は冗長として削除）
- [2026-09-21-03-refactor-url-guards-ssot.md](../dev-docs/archived/pbi/2026-09-21-03-refactor-url-guards-ssot.md)（✅ RICE 16.0・isSecureUrl→isHttpUrl・HeaderDetector.normalizeUrl→normalizeUrlSafe へ委譲+parity テスト）
- [2026-09-21-04-fix-port-validation-delegate.md](../dev-docs/archived/pbi/2026-09-21-04-fix-port-validation-delegate.md)（✅ RICE 12.0・validatePort を validateObsidianPort 委譲。'80.5'/'80abc' 拒否へ反転・'' は既定ポート扱い）
- [2026-09-21-05-refactor-cleansing-key-derivation.md](../dev-docs/archived/pbi/2026-09-21-05-refactor-cleansing-key-derivation.md)（✅ RICE 10.0・presets/restorable を CLEANSING_RULES 派生に。復元欠落4鍵の実害解消・実際は33鍵）
- [2026-09-21-06-refactor-utils-background-edges.md](../dev-docs/archived/pbi/2026-09-21-06-refactor-utils-background-edges.md)（✅ RICE 8.0・auditLog 遅延 import 化・aiModelKey を background/ai へ移動（shim は統合側で削除））
- [2026-09-21-07-fix-issue-report-reentrancy.md](../dev-docs/archived/pbi/2026-09-21-07-fix-issue-report-reentrancy.md)（✅ RICE 8.0・in-flight guard+open チェック+catch+i18n 鍵流用の可視エラー。統合側が引き取り実装）
- [2026-09-21-08-fix-idle-scheduler-prune.md](../dev-docs/archived/pbi/2026-09-21-08-fix-idle-scheduler-prune.md)（✅ RICE 8.0・発火後 id を try/finally で除去・cancel 意味論不変）
- [2026-09-21-09-fix-hybrid-probe-retry.md](../dev-docs/archived/pbi/2026-09-21-09-fix-hybrid-probe-retry.md)（✅ RICE 6.0・失敗非キャッシュ+バースト単位ログ制御・共有 runtime 向け契約を記録）
- [2026-09-21-10-refactor-provider-constructor-ritual.md](../dev-docs/archived/pbi/2026-09-21-10-refactor-provider-constructor-ritual.md)（✅ RICE 6.0・resolveTimeoutMs/logApiKeySource を基底に集約・Gemini isLocal=false 明示）
- [2026-09-21-11-fix-messaging-typed-senders.md](../dev-docs/archived/pbi/2026-09-21-11-fix-messaging-typed-senders.md)（✅ RICE 6.0・sendFromPopup 統一（wire 無改変）・ContentResponse を messaging へ移動）
- [2026-09-21-12-refactor-export-date-ssot.md](../dev-docs/archived/pbi/2026-09-21-12-refactor-export-date-ssot.md)（✅ RICE 4.8・getLocalDateString/parseJsonTagsArray へ委譲・テストエクスポートのみ UTC→local 意図的変更）
- [2026-09-21-13-refactor-provider-domain-ssot.md](../dev-docs/archived/pbi/2026-09-21-13-refactor-provider-domain-ssot.md)（✅ RICE 4.0・37固定行+4派生 helper で4リスト統合・PROVIDER_TO_DOMAIN を同一テーブルへ折りたたみ）
- [2026-09-21-14-refactor-catalog-ui-branches.md](../dev-docs/archived/pbi/2026-09-21-14-refactor-catalog-ui-branches.md)（✅ RICE 4.0・gemini 特例を catalog フィールド化・outerHTML スナップショットで byte 等価）
- [2026-09-21-15-refactor-provider-factory-registry.md](../dev-docs/archived/pbi/2026-09-21-15-refactor-provider-factory-registry.md)（✅ RICE 3.2・PROVIDER_STRATEGY_FACTORIES map 化+fallback。14 と同一ファイルのため1コミット統合）
- [2026-09-21-16-refactor-page-content-pipeline-decouple.md](../dev-docs/archived/pbi/2026-09-21-16-refactor-page-content-pipeline-decouple.md)（✅ RICE 2.4・CleansingConfig を utils/cleansingConfig.ts へ移動し循環解消）

### 2026-09-20 アーキテクチャレビュー — ✅ 全5件完了（12〜16 アーカイブ済み）RICE順: 12 → 13 → 14 → 15 → 16

`/improve-codebase-architecture` の探索で発見した6候補を RICE 採点して PBI 化(候補5は13に統合)。実行順 = 12(内蔵AI契約統一)→ 13(共有hybrid runtime)→ 14(共有Rust crate)→ 15(SqliteClient解消)→ 16(wire table拡張)。台帳は `2026-09-20-00-backlog-archreview-0920.md`（アーカイブ済み）。副産物: `CONTEXT.md` 新規作成、ADR-017(WASM完全移植戦略)記録。13/14/16 は 2026-09-21 の autonomous-task-closer ラウンドで完了。

- [2026-09-20-12-fix-builtin-ai-adapter-contract-unify.md](../dev-docs/archived/pbi/2026-09-20-12-fix-builtin-ai-adapter-contract-unify.md)（✅ 完了・アーカイブ済 — LocalAIService の要約を BuiltInAiProvider 経由に委譲し、local_only/auto でもカスタムプロンプト適用・usage 記録を履行。provider 側の二重 sanitize を削除しオフデバイス検査を 'builtin-input' プロファイルに1本化。コミット ecb849c3・全体12648 tests green。RICE 48・順位1）
- [2026-09-20-13-refactor-hybrid-runtime-shared-scaffold.md](../dev-docs/archived/pbi/2026-09-20-13-refactor-hybrid-runtime-shared-scaffold.md)（✅ 完了・アーカイブ済 — wasmHybridRuntime.ts 新設で3 hybrid の儀式 ~190行を解体。probe 契約（成功のみキャッシュ・失敗再プローブ・バースト単位ログ）を tagCooccur と統一。契約スイート 355 green。closer コミット 7b474ec。RICE 6.4・順位2）
- [2026-09-20-14-refactor-shared-js-strings-rust-crate.md](../dev-docs/archived/pbi/2026-09-20-14-refactor-shared-js-strings-rust-crate.md)（✅ 完了・アーカイブ済 — wasm/js-strings 共有 crate 新設、意図的差分2点を TokenizeOptions パラメータ化、FxHash 統一は出力不変を実証、バイナリ再コミット+ci.yml 対応。TS パリティ 41/41 無変更。closer コミット dfc72734 マージ d1804d1。RICE 3.2・順位3）
- [2026-09-20-15-refactor-sqliteclient-passthrough-alias.md](../dev-docs/archived/pbi/2026-09-20-15-refactor-sqliteclient-passthrough-alias.md)（✅ 完了・アーカイブ済 — OffscreenGateway 全面 overload の1行委譲クラス SqliteClient を alias 化し、op 追加時の overload 二重所有を解消。コミット caa7ae72・type-check/lint/sqlite+pipeline 1658 tests green。RICE 3.2・順位4）
- [2026-09-20-16-refactor-sqlite-wire-table-extension.md](../dev-docs/archived/pbi/2026-09-20-16-refactor-sqlite-wire-table-extension.md)（✅ 完了・アーカイブ済 — sqliteWireTable.ts 新設で query/mutate 10 op を1行導出化。compile-time sync assert 付き。maintain 系は hop 形状が異質のため既存 path 維持（判断記録済み）。402 green。closer コミット f63602d。RICE 1.2・順位5）

### 2026-09-19 PIIサニタイザWASM移植 — ✅ 全件完了（08 含めアーカイブ済み）

### 2026-09-18 arch-delivery-loop 第5ループ — ✅ 全2件完了（01/02 アーカイブ済み）

Phase 0 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260918-r18.html`）の2候補を RICE 採点して PBI 化。実行順 = 02（依存なし）。C2（getMessage 統一、RICE 2.5）は backlog 送り。台帳は `2026-09-18-00-backlog-archloop-0918.md`（アーカイブ済み）。

- 2026-09-18-02-refactor-history-reason-row-seam.md（✅ 完了・アーカイブ済 — pushReasonRow と resolveCleansingBytes を新設し理由行 push 4複製と `??` 解決の二重所有を解消。AI Summary 行の `:` 区切りを維持して表示 byte-identical。resolveCleansingBytes 4 tests 新設）
- 2026-09-18-01-fix-history-missing-reason.md（✅ 完了・アーカイブ済 — 前日実装分の DoD を検証してクローズ。理由行3分類の表示、既存テスト green、/review APPROVE。ユーザー向け説明は 6.9.5 の CHANGELOG に集約）

### 2026-09-17 arch-delivery-loop 第4ループ — ✅ 全3件完了（17/18/19 アーカイブ済み）

Phase 0 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260917-r17.html`）の3候補を RICE 採点して PBI 化。実行順 = 17 → 18 → 19（依存なし・ファイル非重複）。台帳は `2026-09-17-00-backlog-archloop-0917.md`（アーカイブ済み）。

- 2026-09-17-17-fix-settings-write-delta-contract.md（✅ 完了・アーカイブ済 — SettingsRepository の書き込みを delta 契約に（`set()` は単キー delta、`setAll(partial)` は「partial = delta」契約を JSDoc 明記）。stale full スナップショットが withLock の fresh base を上書きする経路を閉じる。full-snapshot writer 9 箇所（customPromptManager / markdownTemplateManager / domainFilter / trancoNotification / perSiteOverrides / cleansingPresetStore / contentSettings / models-dev-dialog / settingsPipeline）を移行し、setAll+updateDomainFilterCache の IIFE 3 重複を `saveSettingsAndRefreshDomainFilterCache` seam に集約。交差書き込み回帰テスト 4 tests 新設（settingsWriteDelta.test.ts））
- 2026-09-17-18-refactor-dashboard-sqlite-validator-schema.md（✅ 完了・アーカイブ済 — DashboardSqliteValidator の per-subtype if-chain（約 85 行）を宣言的 schema テーブル `DASHBOARD_SQLITE_SUBTYPE_SPECS` に寄せ、stagingName try/catch 6 重複製を `stagingNameGuard` 1 箇所に集約（`STAGING_NAME_SUBTYPES` はテーブルから派生し drift 不能）。archive_query 上限 500 を `MAX_ARCHIVE_QUERY_LIMIT` として limits.ts SSOT に収録。既存テスト無修正でパス + 網羅性テスト 3 tests 新設）
- 2026-09-17-19-refactor-native-dialogs-accessible-seam.md（✅ 完了・アーカイブ済 — ネイティブ confirm()/alert() 実測 11 箇所（Phase 0 の 8 箇所に cspSettings の window.confirm 追補）を `showConfirmDialog`/`showAlertDialog` seam に統一。showConfirmDialog を dashboard/utils から utils/ui に昇格し showAlertDialog を追加、utils 層の alert() 直呼びを除去し importNoSignature 表示を UI 層に移設。production のネイティブダイアログ 0 件を確認、テスト 10 ファイルを新契約に追従）

### 2026-09-17 コードレビュー追指摘の PBI 化 — ✅ 全4件完了（アーカイブ済み）

arch-review-0917（10件・全件完了）の実装後の大局的レビューで発見した残課題（新設 SSOT の未採用経路）を PBI 化。NN は先行ラウンドの 01-10 から**継続採番**（日付内一意性と実行順の鍵を両立）。台帳は `2026-09-17-00-backlog-arch-review-0917b.md`（アーカイブ済み）。全件アーカイブ済み（アーカイブ履歴参照）。

### 2026-09-17 アーキテクチャレビュー指摘の PBI 化 — ✅ 全10件完了（アーカイブ済み）

大局的アーキテクチャレビュー（DRY / SoC / 拡張性 / 堅牢性）で抽出した11候補を RICE 採点し10件を PBI 化し、4バッチ（並列サブエージェント+ファイル排他）で全件実装。実行順 = 01 → 10（03→04 と 01→10 は順序依存で入れ替え）。台帳は `2026-09-17-00-backlog-arch-review-0917.md`（アーカイブ済み。MAX_PROVIDERS / utils 物理再配置の2候補は future.md に統合）。

最終検証: type-check / lint 0 errors / test 12,165 passed (763 files) / build PASS / lint:adr-links PASS。残る起票候補は台帳の「MAX_PROVIDERS（実害なし）」「utils 物理再配置（lint 強制後に再判断）」のみ。

### 2026-09-14/15 Firefox 対応 — ✅ 全3件完了（アーカイブ済み）

Firefox 対応（09 storage-port / 10 E2E-CI / 11 リリース準備）はすべて完了。CI の `firefox-storage` ジョブ（probe + worker smoke）が常時回帰検知。実機 QA で発見した4不具合（ダッシュボード拒否・保存不能・プリセット競合・同意リセット）はすべて修正済み。AMO 公開は将来対応（`2026-09-15-01`・着手禁止）。台帳は `2026-09-14-00-backlog-firefox-support.md`（アーカイブ済み）。

v6.9.1 の送信者検証リファクタで Firefox の全 SQLite 操作が拒否される回帰が入り、v6.9.2 で修正した（[[2026-09-16-01-fix-archive-e2e-flaky]]）。

### 2026-09-21 autonomous-task-closer — ✅ 4件完了（08/13/14/16 アーカイブ済み）

前ラウンド（holistic-0921）でユーザー裁定により closer に委託されていた4件を閉じた。バッチ1 = 4件並列（08/13/16 は同一ディレクトリ+ファイル排他、14 は wasm-pack バイナリ再構築のため worktree 隔離 → closer/pbi14-js-strings ブランチをマージ d1804d1）。バッチ統合で型エラー4件（exactOptionalPropertyTypes×3・privacyInfo null 経路×1）を検出し統合側で修正。最終検証: type-check PASS / lint 0 errors / test 12,914 passed / build PASS。5 Whys 記録は /tmp/whywhy/（recording-decision-pure / hybrid-runtime-scaffold / js-strings-crate / sqlite-wire-table）。

- [2026-09-19-08-refactor-recording-decision-unify.md](../dev-docs/archived/pbi/2026-09-19-08-refactor-recording-decision-unify.md)（✅ 完了 — recordingDecision.ts 純粋関数 seam・競合マトリクス byte 等価。9c182ed）
- [2026-09-20-13-refactor-hybrid-runtime-shared-scaffold.md](../dev-docs/archived/pbi/2026-09-20-13-refactor-hybrid-runtime-shared-scaffold.md)（✅ 完了 — wasmHybridRuntime.ts 共有 runtime。7b474ec）
- [2026-09-20-14-refactor-shared-js-strings-rust-crate.md](../dev-docs/archived/pbi/2026-09-20-14-refactor-shared-js-strings-rust-crate.md)（✅ 完了 — wasm/js-strings crate・FxHash 統一出力不変・バイナリ再コミット。dfc72734）
- [2026-09-20-16-refactor-sqlite-wire-table-extension.md](../dev-docs/archived/pbi/2026-09-20-16-refactor-sqlite-wire-table-extension.md)（✅ 完了 — sqliteWireTable.ts query/mutate 10 op・段階適用の判断記録。f63602d）

保留（ユーザーゲートで closer 対象外）: wasqlite sunset（ゲート 2026-12-17）・AMO 公開・tag-cooccur 17/21/22（実機確認 + GitHub PR approve 待ち）

### 2026-09-21 PBI-20 serde スパイクの非反転クローズ — ✅ 1件クローズ（20 アーカイブ済み）

スパイク試作（使い捨てクレート serde-spike、リポジトリ外隔離）で serde 往復コストを実測した結果、**WASM 経路は V8 ネイティブ JSON の4〜5倍遅い**（untyped 0.21x・typed compact 0.27x・bincode 0.32x・JsValue 経由 0.20x、round-trip 等価性は OK）。serde-wasm-bindgen の往復コスト（JsValue↔serde リフレクション+UTF-8 コピー）が支配的で、JSON.parse/stringify は V8 の最適化済みネイティブ経路のため勝ち目なし。**移植しないで確定クローズ**。エクスポート経路の改善は署名対象の設計変更（eval-2 で特定の HMAC pretty 再シリアライズ排除）へ委ねる。試作クレートは破棄、判定記録・実測表はアーカイブ済み PBI-20 内に保持。

- 2026-09-20-20-spike-export-serde-wasm.md（✅ 完了（クローズ）— 判定型スパイクとして「移植しない」を確定記録）

### 2026-09-21 PBI-19 プロンプトスキャンWASM移植の不採用 — ✅ 1件クローズ（19 アーカイブ済み）

STEP 0 プローブ（`bench/prompt-sanitize-transfer-probe.ts`）で転送シェア 1〜2%（計算律速）と構造判定しつつ、絶対値が sub-ms（60KB で TS 2.4ms）で速度リターンが小さく、パリティリスク（exec ループ中の replaceAll による変異中イテレーション+文脈依存判定）が全候補中最大と判定。移植を不採用とし、主価値（上限化・DoS 耐性）は後継 PBI-24（TS ハードニング）に引き継いだ。あわせて置換中イテレーションのマッチ取りこぼし懸念を PBI-24 で検証する方針を記録。プローブ記録は `bench/prompt-sanitize-transfer-probe-result.json`。

- 2026-09-20-19-feat-prompt-scan-wasm.md（✅ 完了（クローズ）— 移植不採用の判定記録つき）

### 2026-09-21 md-sanitize 実測不採用による撤去 — ✅ 2件クローズ（18・23 アーカイブ済み）

md-sanitize WASM（PBI-18）は実測で全サイズ TS 負け（single 0.31x〜0.77x・batch 0.57x〜0.64x、メモリ帯域律速 — V8 文字列ビルトインがネイティブで勝つ領域）のため dark-launch 配線としていたが、転送最適化の全候補（PBI-23: framed bytes / serde bytes / 共有メモリ staging、最良 0.86x）も非反転と確定。さらに dark-launch 閾値（合計 2MB）を超える大規模エクスポート（EXPORT_ROW_LIMIT 10000×0.5KB ≈ 5MB）が遅い WASM 経路に流れる潜在リグレッションを確認したため、クレート・ラッパー・配布バイナリ・ハイブリッド・配線・CI ゲート一式を撤去し exportLogsService を TS 直呼びに復帰した（validate 12,709 green = 追加前と同一）。判断根拠・実測表はアーカイブ済み PBI 18/23 に記録、撤去済みコードは git 履歴参照。タグクラスタパネル（tag-cooccur・5.53x）は対象外で影響なし。学習: **文字列入出力が支配的な処理（転送/帯域律速）は移植不適 — 計算律速のみが対象**。

- 2026-09-20-18-feat-markdown-sanitize-wasm.md（✅ 完了（クローズ）— 移植・パリティ・dark-launch 配線まで実施後、実測不採用で撤去。受け入れ基準 6/6 は履行、BDD の高速化シナリオは不達を記録）
- 2026-09-20-23-perf-md-sanitize-transfer-optimization.md（✅ 完了（クローズ）— 転送候補5アーム実測で非反転。floor 計測による構造特定を記録）

### 2026-09-20 autonomous-task-closer による一括クローズ（12・15＋先行5件＋実行済Plan） — ✅ 8件

- 2026-09-20-12-fix-builtin-ai-adapter-contract-unify.md（✅ 完了 — LocalAIService を BuiltInAiProvider 経由に委譲し local_only/auto でも契約履行。provider 側二重 sanitize 削除で 'builtin-input' プロファイルに1本化。コミット ecb849c3）
- 2026-09-20-15-refactor-sqliteclient-passthrough-alias.md（✅ 完了 — SqliteClient を OffscreenGateway alias に畳む。コミット caa7ae72）
- 2026-09-19-09-fix-ci-domain-filter-task-flow.md（✅ 完了 — PR #150/#152 でマージ済み・CHANGELOG v6.9.12 記載・リリース CI green）
- 2026-09-19-10-fix-wasm-multibyte-whitespace-separators.md（✅ 完了 — コミット 42095820・cargo test/JSパリティ green・バイナリ再コミット済み）
- 2026-09-19-11-fix-coverage-timing-test.md（✅ 完了 — コミット d35f5715・Coverage ジョブ安定化・リリース済み）
- 2026-09-18-20-fix-history-progress-bar-consistency.md・2026-09-18-21-fix-history-missing-rows-consistency.md（✅ 完了 — CHANGELOG v6.9.9 記載・ADR 2026-09-18-history-diagnostic-rows-always-visible 記録済み・全テスト green）
- 実行済み実装計画 2026-09-19-navigation-registry-mount-await.md を dev-docs/archived/plans/ へ移動（コードは async navigate 化済みを確認）

### 2026-09-19 ワークスペース全量レビューの PBI 化（前波 01〜13・第2波 14〜20・第3波 21〜23） — ✅ 20/23 完了（アーカイブ済み）

ワークスペース全量レビュー（総合82/100 A、High 1＋Medium 12）の指摘を RICE 採点で PBI 化。前波 13件（01〜13）は autonomous-task-closer により全件実装、第2波 7件（14〜20）はローカルレビュー（NEEDS CHANGES）の findings 対応、第3波 3件（21〜23）は2回目のローカルレビュー findings 対応。台帳は `2026-09-19-00-backlog-review-fixes.md`（前波＋第2波）と `2026-09-19-00-backlog-review-findings-r3.md`（第3波。いずれもアーカイブ済み）。

DoD の「ドキュメント更新済み」は文書要件がある場合のみ適用（03: AGENTS.md 使い分け表、04: clearElement 参照、05: API_ENDPOINTS.md プロトコルバージョン規約、19: 本INDEX、他はコードコメントが正本で文書要件なし）。

- 01〜07・09・10・13〜23（✅ 完了・アーカイブ済 — 20件。実装詳細は各ファイルの受け入れ基準と DoD 補足を参照。ハイライト: 01 上限＋隔離document、02 失敗経路テスト追加、05 absent 格下げ＋カウンタ、06 非loopback http ブロック、08 以外の @deprecated に sunset 日適用、14/20 クレンジング全経路のサイズ契約、16 ガード2件を validate/CI に組み込み、17/18 診断ログ＋テスト、22 Test Connection がフォーム値を評価）
- 2026-09-19-08-refactor-recording-decision-unify.md（✅ 完了・アーカイブ済 — 残りの純粋関数化＋組み合わせテスト網羅を closer ラウンドで完了。verdict を recordingDecision.ts 純粋関数に委譲し競合マトリクス8件を抽出前 pin → 無変更 green。closer コミット 9c182ed）

最終検証（第3波後）: type-check PASS / lint 0 errors / 両ガード OK / test 12,301 passed（783 files）。userinfo バイパス修正（validateObsidianHost の @% 拒否、TDD Red/Green）を含む。

- 2026-09-19-11-refactor-large-view-split.md（✅ 対応済みを確認して完了 — sqliteHistory 系は View／Model／Query／Controller／State に既に分割済み。query 組み立ては Model 側にあり、View は描画のみ。さらなる分割は過剰と判断して閉じた）
- 2026-09-19-12-refactor-statuspanel-delegation.md（✅ 対応済みを確認して完了 — render 8関数が statusRenderers.ts に移譲済み、statusPanel.ts は調停＋DOM反映のみ。変更なしで閉じた）

### 2026-09-18 arch-delivery-loop（archloop-0918） — ✅ 全3件完了（17〜19 アーカイブ済み・v6.9.7）

Phase 0 の HTML レポート（`$TMPDIR/architecture-review-20260918-1309.html`）で抽出した3候補を RICE 採点して PBI 化。実行順 = 17 → 18 → 19（ファイル非重複・1バッチ）。台帳は `2026-09-18-00-backlog-archloop-0918-17to19.md`（アーカイブ済み。同日第5ループ台帳と同名のため接尾辞で区別）。Phase 3（make clean test）→ Phase 3.5（graphify update）→ Phase 4（v6.9.7 版上げ）まで閉じた。

- 2026-09-18-17-refactor-delete-allowed-urls-shadow.md（✅ 完了・アーカイブ済 — allowedUrls.ts 分身と barrel の4再export・死コピー専用テスト3ブロックを削除。FILTER_LIST_SOURCES との乖離解消）
- 2026-09-18-18-refactor-simplify-get-msg-with-cache.md（✅ 完了・アーカイブ済 — getMsgWithCache の8分岐 if-chain を `key in cache` 1ルックアップ化）
- 2026-09-18-19-refactor-finish-logger-barrel-migration.md（✅ 完了・アーカイブ済 — 呼び出し側約133箇所を types/core/api へ直接 import 移行、storage 系 dynamic import 3箇所を静的化、barrel 削除 + eslint 特例除去 + LAYERS.md 更新）

最終検証: make clean test EXIT 0（validate:json / lint 0 errors / type-check / test 12,249 passed・781 files / build / test:e2e）×2回、check-version-consistency 6.9.7 一致、graphify update 済。

### 2026-09-18 大局的コード改善 第3ラウンド（holistic-0918c） — ✅ 全3件完了（14〜16 アーカイブ済み）

popup・dashboard panel・i18n・層境界の大局的レビューで抽出した3候補を RICE 採点して PBI 化。実行順 = 14 → 15 → 16（ファイル非重複・1バッチ）。台帳は `2026-09-18-00-backlog-holistic-0918c.md`（アーカイブ済み。台帳送りの console → logger 統一は future.md に統合）。console → logger 統一（RICE 2.1）は台帳送り（再検討トリガー: 可観測性方針の明確化）。統合検証で3件のテスト mock 未追従を検出・即修正（exportImport 系2件・privacySettingsPanel の i18n mock を実セマンティクス委譲に更新）。PBI 14 の初回コミットに PBI 16 の git mv が混入したため soft reset して分割し直した（リネームは内容無変更の pure move）。

- 2026-09-18-14-refactor-adopt-get-message-or-seam.md（✅ 完了・アーカイブ済 — `|| fallback` 形 約40サイト・10ファイルを getMessageOr に置換。fallback 無し素呼び出し・getMsgWithCache は対象外）
- 2026-09-18-15-refactor-consolidate-dashboard-t-wrappers.md（✅ 完了・アーカイブ済 — tOrKey を i18n seam に新設（位置・名前付き両対応）し4ラッパを別名 import に統合。呼び出しサイト129箇所は無変更、単体テスト3件新設）
- 2026-09-18-16-refactor-resolve-dashboard-popup-imports.md（✅ 完了・アーカイブ済 — escapeHtml 2ファイルを utils 直参照化、onboardingWizard を utils/ui へ移動。dashboard 配下の popup import 0 件）

最終検証: type-check / lint 0 errors（警告133・前回比 ±0）/ test 12,271 passed（781 files、+3 tOrKey テスト）/ build PASS / lint:adr-links・layers-docs PASS。

### 2026-09-18 大局的コード改善 第2ラウンド（holistic-0918b） — ✅ 全3件完了（11〜13 アーカイブ済み）

前ラウンド未踏領域（sync・alarm・queue・backup・dashboard view）の大局的レビューで抽出した3候補を RICE 採点して PBI 化。実行順 = 11 → 12 → 13（ファイル非重複・1バッチ）。台帳は `2026-09-18-00-backlog-holistic-0918b.md`（アーカイブ済み。台帳送りの formatBytes 双子は future.md に統合）。formatBytes 双子（RICE 1.6）は台帳送り（再検討トリガー: UI 出力統一の要望）。統合検証は1回で全ゲート green（失敗0）。

- 2026-09-18-11-refactor-remove-dead-review-summary-alarm.md（✅ 完了・アーカイブ済 — production import ゼロを実測の上 reviewSummaryAlarm.ts と専用テスト・service-worker.test.ts の防御 mock・形骸アサーションを削除。getNextMondayAt/getNextMonthFirstDayAt は alarmRegistry の1コピーに集約）
- 2026-09-18-12-refactor-adopt-error-message-ssot.md（✅ 完了・アーカイブ済 — errorMessage SSOT への迂回残存 約20サイト・18ファイルを置換。亜種・ラップ変形・name 抽出は対象外として grep で機械確認）
- 2026-09-18-13-refactor-restorable-settings-spec-table.md（✅ 完了・アーカイブ済 — 4並列テーブルを key → { type?, range? } の単一 spec テーブルに統合し allowlist を派生。数値クレンジングの非数値素通しを type 省略で保持、網羅性テスト4件新設）

最終検証: type-check / lint 0 errors（警告133・前回比-1）/ test 12,268 passed（780 files、内訳変動 -8 死テスト -1 形骸 +4 新設）/ build PASS / lint:adr-links・layers-docs PASS。

### 2026-09-18 大局的コード改善（holistic-0918） — ✅ 全6件完了（05〜10 アーカイブ済み）

大局的レビュー（DRY / SoC / 拡張性 / 堅牢性・実コード裏取り）で抽出した6候補を RICE 採点して PBI 化。実行順 = 05 → 06 → 07 → 08 → 09 → 10（06→10 は同一ファイルのため直列1コミットに集約、08→09 は同点時のリスク優先）。台帳は `2026-09-18-00-backlog-holistic-0918.md`（アーカイブ済み）。統合検証で2件の失敗を検出・即修正（dashboardSqliteService の console 期待を新 logger seam に追従、6.9.6 bump 漏れの docs/version.json と package-lock を追従）。

- 2026-09-18-05-refactor-validators-shared-checks.md（✅ 完了・アーカイブ済 — protocolVersion・http(s) URL・content上限の3検査を helper に集約。parity 3 tests 新設）
- 2026-09-18-06-fix-confirmtoken-silent-catch.md（✅ 完了・アーカイブ済 — confirmToken 系 catch と gateway の console 直呼びを logger seam に統一。可視化 2+3 tests 新設）
- 2026-09-18-07-refactor-visit-admission-twins.md（✅ 完了・アーカイブ済 — backoffOnce と loadExtractorBestEffort に集約。parity 2 tests 新設）
- 2026-09-18-08-refactor-sqlite-purge-twins.md（✅ 完了・アーカイブ済 — runPlannedPurge/runById/runPlannedQuery に集約し呼び出し arity を維持。parity 3 tests 新設）
- 2026-09-18-09-refactor-ai-extract-guards.md（✅ 完了・アーカイブ済 — failInvalidSchema と buildTestDebugBase を基底に新設し両 provider から委譲。parity 2 tests 新設）
- 2026-09-18-10-refactor-dashboard-transport-wiring.md（✅ 完了・アーカイブ済 — TransportPort 注入点を追加し既定は現行送信を維持。注入 port 3 tests 新設）

最終検証: type-check / lint 0 errors（警告134・増加なし）/ test 12,273 passed（780 files）/ build PASS / lint:adr-links・layers-docs PASS。

### 2026-09-18 archloop-0915b 残り将来候補の PBI 化 — 2件完了（03・04）

`2026-09-15-00-backlog-archloop-0915b.md` の将来候補のうち、reviewSummary 双子統合と SessionStore durability interface 化の2件を PBI 化・実装。合成ルート深掘り（RICE 7.0）は別途未採番（台帳はアーカイブ済み・当該候補は future.md に統合）。

- 2026-09-18-03-refactor-review-summary-period-unify.md（✅ 完了・アーカイブ済 — reviewSummaryGenerator.ts の週次/月次生成ロジック重複を `generatePeriodSummary(period, mutex)` に統合。`buildWeekPeriod`/`buildMonthPeriod` strategy 関数を新設、weeklyMutex/monthlyMutex は別インスタンスのまま維持。既存34 tests 無修正でパス = byte-identical 動作の証明）
- 2026-09-18-04-refactor-session-store-interface.md（✅ 完了・アーカイブ済 — `SessionStorePort` インターフェースを新設し `get`/`set`/`remove` の契約（get失敗時は例外を投げずnull）を型コメントで明示。TabCache・RateLimiter・compositionManifest.ts の依存を具象クラスからポート型経由に変更。RecordingCacheStore とは目的が異なるため統合せず理由をdoc commentに記録。フェイク実装での動作証明テストを追加、既存94 tests 無修正でパス）

### 2026-09-17 アーキテクチャレビュー指摘の PBI 化 — 1件完了（10）

- 2026-09-17-10-refactor-ai-test-connection-template.md（✅ 完了・アーカイブ済 — `executeHttpTestFlow(hooks)` を新設（`executeHttpSummaryFlow` と対称）し Gemini/OpenAI 互換の testConnection 重複（約90%）を統合。providerCatalog の contentCharsKey を実消費に昇格して設定キー SSOT 化。legacy フォールバックは unknown 拒否契約維持のため直構築専用と温存。parity 13 + SSOT pin 4 tests 追加・AI 配下 233 tests green）

### 2026-09-17 アーキテクチャレビュー指摘の PBI 化 — 2件完了（06・09）

- 2026-09-17-06-refactor-settings-repository-discipline.md（✅ 完了・アーカイブ済 — 本番11箇所の `new SettingsRepository()` を singleton/注入シームに統一（observer は port level 発火のため挙動不変）。generalSettingsPanel の孤立ポートも統合。no-restricted-syntax で再発防止（許可: utils/storage 配下・テスト・composition root）・111 tests green）
- 2026-09-17-09-refactor-backoff-http-failure-ssot.md（✅ 完了・アーカイブ済 — `backoffDelayMs` と `describeHttpFailure` を Layer 0 新設し3系統/3呼び出し元を委譲。byte-identical parity テスト付き。両モジュールを Layer 0 として境界ルールに登録）

バッチ3統合時に previewFlow テストの mock が singleton export を欠落（PBI 06 由来の3 failures）→ mock 修正で解消。統合検証: type-check / lint 0 errors / test 12,148 passed。

### 2026-09-17 アーキテクチャレビュー指摘の PBI 化 — 3件完了（04・05・08）

- 2026-09-17-04-refactor-markdown-entry-ssot.md（✅ 完了・アーカイブ済 — `buildEntryMarkdown(input, style, opts)` を SSOT 新設し4ファイル5生成箇所を統合。非テストの `sanitizeForMarkdownLinkText` 参照は markdownFormatter.ts に集約。golden parity 6 tests で byte-identical を pin・156 tests green）
- 2026-09-17-05-refactor-utils-layer-boundary-lint.md（✅ 完了・アーカイブ済 — `local/utils-layer-boundary` ルール新設（Layer 0 純粋性・Layer 1→2 禁止・RuleTester 20 tests）。eslint-plugin-boundaries 不採用（新規依存ゼロ）。LAYERS.md の実態乖離6件を訂正（hmacKeyStore→Layer 1 等）+ defaults→aiSummaryCleaner を暫定許可として明記）
- 2026-09-17-08-investigate-module-singleton-policy.md（✅ 完了・アーカイブ済 — ADR 新設（`2026-09-17-module-singleton-policy.md`）。新規 SW 依存は manifest 原則・既存6件現状維持。実測で現 manifest の onReady は 0 件（PBI 2026-09-03-05 で撤去済み）・5箇所の singleton 宣言に ADR 参照コメント）

バッチ2統合時に `require-sanitized-markdown` が SSOT の新構造で 7 errors を検出 → テンプレート補間変数をルール規約（`sanitized*` プレフィックス）に準拠させ解消（parity 不変）。統合検証: type-check / lint 0 errors / test 12,140 passed / build PASS。

### 2026-09-17 コードレビュー追指摘の PBI 化（0917c）— ✅ 全2件完了（アーカイブ済み）

ユーザー起票の台帳 `2026-09-17-00-backlog-arch-review-0917c.md`（アーカイブ済み。6候補のうち4件は既存ラウンドで処理済み/前提誤りと判定済み、残る2件を採番 NN 15-16）に基づき実装。

- 2026-09-17-15-fix-queue-storage-adapter-swallow.md（✅ 完了・アーカイブ済 — 最後の砦の退避キューの save/load 失敗が握りつぶされメタデータが黙ってロストする問題を解消。adapter は reject/throw し失敗処理をキューへ移管: enqueue は boolean を返し元の失敗をマスクしない、flush/mutate は構造化ログ+スナップショット保護、saveMetadataStep は二重障害を ERROR 報告。queueStorageFailure.test.ts 7 tests 新設）
- 2026-09-17-16-fix-manual-fetcher-listener-leak.md（✅ 完了・アーカイブ済 — `fetchFromTab` のタイムアウト経路で `tabs.onUpdated.removeListener` が呼ばれないリスナー残留を解消（cleanup 関数に集約）。fake timers によるタイムアウト系テスト追加・11 tests green）

備考: manifest に `unlimitedStorage` permission はないため quota 超過の発生条件は実在（PBI 15 の Reach 裏取り）。統合検証: type-check / lint 0 errors / test 12,193 passed (766 files) / build PASS。`QueuePort`/`NoOpQueuePort` の enqueue・mutate 戻り型を boolean 化（offlineNetworkQueue、await 専用呼び出しのため非破壊）。

### 2026-09-17 コードレビュー追指摘の PBI 化 — 4件完了（11〜14）

- 2026-09-17-11-fix-ai-provider-error-labels.md（✅ 完了・アーカイブ済 — `fetchErrorLabel` 廃止（openai 互換系ネットワーク障害の誤ラベル実害解消）+ `parseAndMapFetchError` 第2テーブルを `describeHttpFailure` の parse variant に統合。byte-identical parity 7 tests・AI 配下 249 tests green。全呼び出し経路を実測（executeHttpTestFlow catch のみが対象、要約フローは汎用文言で対象外））
- 2026-09-17-12-refactor-backoff-delay-adoption.md（✅ 完了・アーカイブ済 — 手書き指数バックオフ5箇所を `backoffDelayMs` に委譲。attempt 基準差（0/1-origin）は呼び出し側で吸収、golden parity 6 tests・広域 544 tests green。`backoff.ts` の 0-origin 契約を doc 明記）
- 2026-09-17-13-refactor-markdown-formatter-cleanup.md（✅ 完了・アーカイブ済 — 死んだ `formatEntriesToGenericMarkdown` 削除 + `formatEntryToHeadingMarkdown` / `formatEntriesToObsidianList` へ改名（旧名は @deprecated alias 残置）。出力 byte-identical・golden 無変更 green）
- 2026-09-17-14-refactor-layer-list-single-source.md（✅ 完了・アーカイブ済 — 案B 採用: `lint:layers-docs` 双方向照合スクリプト新設（48 entries 同期・fixture で正/逆/所属誤りの3系検知を検証）+ `defaults→aiSummaryCleaner` 暫定許可の ADR 起票（49 ADRs PASS）+ LAYERS.md 形式ドリフト修正（ublockMatcher））

バッチ統合時に PBI 13 改名由来の vi.mock 未追従（copyMarkdownButton.test ×4、recordOrchestrator.test ×1）を検出 → mock へ新名キー追加で解消。統合検証: type-check / lint 0 errors / test 12,183 passed (765 files) / build PASS / lint:adr-links / lint:layers-docs PASS。

### 2026-09-17 アーキテクチャレビュー指摘の PBI 化 — 4件完了（01・02・03・07）

- 2026-09-17-01-fix-ai-provider-test-label.md（✅ 完了・アーカイブ済 — testConnection のハードコード `'OpenAI'` を `this.providerName` に修正（lm-studio/ollama の誤誘導解消）。lm-studio/openai の 401 回帰テスト 2 件追加・45 tests green）
- 2026-09-17-02-fix-gist-sync-settings-reader-seam.md（✅ 完了・アーカイブ済 — 3箇所の `new SettingsRepository()` を注入シームに統一。`GistSettingsStore`（reader+set）へ最小拡張し、tripwire テストで実 chrome.storage 非接触を pin。4 tests 新設・既存 24 tests green）
- 2026-09-17-03-refactor-obsidian-sync-dead-code.md（✅ 完了・アーカイブ済 — 本番未参照の ObsidianSyncService（134行+テスト）を削除。SyncTarget/SyncBatchRunner を GistSyncTarget 専用と明記。markdownJoinSafety から ObsidianSync ケース除去・20 tests green）
- 2026-09-17-07-investigate-builtin-ai-dual-adapter.md（✅ 完了・アーカイブ済 — ADR 新設（`2026-09-17-builtin-ai-dual-adapter.md`）。二重表現は privacy-mode ルーティング軸と provider-slot 選択軸の責務分離と裁定し統合不採用。再検討トリガー3件を記録）

バッチ1は4サブエージェント並列で実装（担当ファイル排他）。統合検証: type-check / lint 0 errors / test 12,109 passed / lint:adr-links PASS（既存4破損参照も同ラウンドで修復）。

### 2026-09-17 hashUrl の locality 改善 — 1件完了（05）

`hashUrl` を `crypto/` から `utils/urlHash.ts` へ移し、暗号モジュールの責務を暗号操作だけに絞った。

着手条件としていた「logger → crypto の依存が層構造を変えるのでは」という懸念は、実測で否定された（crypto は logger を import しておらず、logger は既に `piiSanitizer` 等に依存している）。`piiSanitizer.ts` がプライバシー保護目的のマスキングとして `utils/` 直下に置かれている先例に沿い、独立モジュールとした。

動作は一切変えていない。ログに出るハッシュ値が変われば過去ログとの突合ができなくなるため、固定値でのテストを追加して固定した。

### 2026-09-16 crypto の HMAC 統合 — 1件完了（04）

`computeHMAC`（文字列鍵）と `generateHmacSignature`（CryptoKey 鍵）の2系統を `HmacSigner` に統合し、呼び出し側から鍵の取得方法の知識を消した。

両者はアルゴリズムが同一で差は鍵の受け取り方と出力形式だけだったが、**出力形式を揃えると必ず片方の既存署名が壊れる**（設定・ログのエクスポートは標準 base64 でユーザーのディスク上に、同意と通知IDは URL-safe で保存されている）。そこでエンコーディングを signer の属性とし、用途ごとに既存形式を維持した。既存関数とバイト単位で一致することをテストで実証済み。

副産物として、`computeHMAC` 経路で呼び出し側任せだった定数時間比較が `verify` に内包され、忘れようがなくなった。

`hashUrl` の移動は層構造への影響が独立した論点のため 2026-09-16-05 に分離。

### 2026-09-16 crypto codec の統合 — 1件完了（16 の codec 部分）

`atob` / `btoa` 直書きを **28箇所 → 実質2箇所**（seam 本体 + 意図的な legacy 互換）に削減。

PBI は「最低6箇所・機械的置換が主作業」としていたが、実測では28箇所あり、3種類は単純置換できなかった。UTF-8 テキスト用と URL-safe base64 は seam に関数を追加して対応。bloomFilter が持っていたチャンク最適化は seam 側へ移し、全呼び出し元が恩恵を受けるようにした（2MB で 106ms → 39ms）。

`kdfNegotiator` の1箇所は **置換すると既存の暗号化済み API キーが復号不能になる**ため意図的に残した（`TextEncoder().encode(atob(...))` は 0x80 以上のバイトが UTF-8 で2バイトに膨らみ、`base64ToBytes` と結果が異なる）。

HMAC 統合と `hashUrl` 移動は性質が異なるため 2026-09-16-04 に分離。

### 2026-09-15 arch-delivery-loop 0915 / 0915b — 12件完了（02〜15）

第1回・第2回診断から PBI 化した13件のうち12件が完了。残る16（crypto codec）のみ未着手。

02 送信者検証 seam / 03 queryPlanner 循環解消 / 04 archive wireTable 派生化 / 05 CleansingPresetStore 抽出 / 06 診断 SECTIONS テーブル化 / 07 transport timeout 集約 / 08 consent module 深掘り / 09 ArchiveSessionStore / 10 backend レジストリ / 11 history presentation 純粋関数化 / 12 KEK チェーン注入可能化 / 13 KdfNegotiator / 14 VisitPayload / 15 alarm registry 統合

いずれも v6.9.1 でリリース済み。なお 02（送信者検証 seam の一本化）は Firefox で全 SQLite 操作が拒否される回帰を生み、v6.9.2 で修正した（[[2026-09-16-01-fix-archive-e2e-flaky]] 参照）。

### 2026-09-16 archive 系 e2e の恒常的失敗 — 3件完了（01・02・03）

v6.9.2 のリリース確認中に発見した CI `test` ジョブの failure を解消し、**archive 系 e2e を全件グリーンに戻した**（着手時: failed 1 + flaky 5）。原因は独立した3件だった。

- confirm token が `chrome.storage.session` 保存のため MV3 の SW 終了で揮発する → 送信側が mismatch 時に1回だけ再発行して再送（01）
- offscreen 喪失が `categorizeError()` の分類から漏れ、Chrome の原文がそのままユーザーに出ていた → 実際の文言2パターンを判定に追加し `retriable: true` へ（01）
- offscreen のリスナー登録が動的 import の後だったため、生成直後のメッセージが拒否されていた → 同期登録に変更しファクトリ待機をハンドラ内へ（02）

02 は当初「アーカイブ中に offscreen が破棄される」問題として起票したが、**実測でその前提が誤りと判明**した（破棄されておらず、リスナー未登録だっただけ）。推測で立てた対処案（冪等キー / keepalive / 操作分割）はいずれも不要だった。

03 は 01 から派生した設計課題（confirm token の2段階を payload 署名の1段階へ）。セキュリティ方針を確認したうえで **置き換えは実施しないと決定**し、代わりに防御範囲をコードコメントと `SECURITY_REVIEW_GUIDE.md` に記録した。外部からの到達はトークンより手前の3層（`externally_connectable` 未宣言 / `sender.id` 照合 / `extension-only` 登録）で阻止されており、トークンが攻撃者に対して追加の障壁を持たないことが判明したため。再検討する条件も PBI に明記してある。

**v6.9.2 / v6.9.3 としてリリース済み。** 実機で起動直後の操作・SW 終了後の再接続・アーカイブの一連の流れを確認済み。

### 2026-09-12 テキスト検索回帰の多層防御テスト — 3件（pbi-create-bdd・BDD分割）

round 14 のテキスト検索回帰（normalizeStorageQuery text 欠落 + OPFS routing 誤配送）の恒久防止。なぜなぜ分析 60 連鎖で 5 根本原因を特定（seam 移行漏れ・allowlist 漏れ・as-is テスト・日本語 corpus 欠落・smoke test 欠落）。BDDシナリオ別に縦割り。

- 2026-09-12-42-test-search-regression-symptom.md（✅ 完了・アーカイブ済 — `searchDistinctResults.test.ts` 新設（7 tests: 3 トピック distinct・field preservation contract 13 フィールド全生存・satisfies 型ガード）+ `tagCorpusParity` に日本語 corpus 4 tests 追加（CJK trigram/LIKE 境界・ASCII case-fold within CJK rows）。offscreen 1102 tests green）
- 2026-09-12-43-test-search-hop-contracts.md（✅ 完了・アーカイブ済 — `searchHopContracts.test.ts` 新設（6 tests: buildSearchParams query→text 写像・gateway kind:search → SQLITE_QUERY text 保持・planQuery text 保持）+ rank 実行保証テスト（FTS JOIN + ORDER BY rank を better-sqlite3 実エンジンで実行）。searchHopContracts 6 + realEngineLikeSearch 7 tests green）
- 2026-09-12-44-test-search-parity-corpus-e2e.md（✅ 完了・アーカイブ済 — `tagCorpusParity` に日本語 corpus 4 tests 追加（4 文字 FTS・2 文字 LIKE・case-fold within CJK）・`buildTagFilterCondition` の inline cleaner を `sanitizeFtsTerm` 経由に統一（sanitizer parity 確立）・`dashboard-search-ui.spec.ts` 新設（Playwright UI 検索 2 tests）・TEST_RULE に「検索パス変更時の smoke test 必須化」セクション追加（4 種 smoke test の対象ファイル一覧付き）。tagCorpusParity 12 tests + Playwright 2 tests green）

実行順 = 42 → 43 → 44（RICE 降順・依存なし）。工数合計 4pt。

### 2026-09-12 architecture deepening round 14 — 4件（0912f）

round 14 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-2010-r14.html`）の deepening 候補 4 件を RICE 採点 → PBI 化。実行順 = 38 → 41（RICE 降順）。台帳は `2026-09-12-00-backlog-0912f.md`。健全性確認: queryPlanner / messageHandler / exportEnvelope / supportsArchive は候補なし。

- 2026-09-12-38-fix-idb-like-qualified-sql.md（✅ 完了・アーカイブ済 — IdbVfsBackend.query を FTS=`{qualified:true}` / LIKE=`{qualified:false}` の branch 毎射影に修正（round 12 PBI 27 の 1 投影共用による `no such column: b.is_deleted` 回帰解消）。vestigial `extraWhereSqlFts` フィールド削除 + 関連参照更新。real-engine regression test 新設（better-sqlite3 で LIKE SQL を実行・mutation proof 付き）。realEngineLikeSearch 6 tests 新設・offscreen 1074 tests green）
- 2026-09-12-39-refactor-select-tag-filter.md（✅ 完了・アーカイブ済 — `selectTagFilter(tag, path, engineFts5Available)` 3-way selector を queryPlan に新設し 5 導出点を委譲（plain=(engine,'id')・fts=(engine,'b.id')・like=(false,—)）。opfsWorker から handleSearchFts/Like へ fts5Available を threading（hardcode true の direct-call 脆弱性解消）。selectTagFilter 7 tests 新設・offscreen 1074 tests green）
- 2026-09-12-40-fix-tag-parity-corpus.md（✅ 完了・アーカイブ済 — `rowMatchesTagLike` 新設（SQL LIKE 準拠: case-insensitive・%/_ wildcard 展開・カンマ literal）で fallback の tag branch を `matchesExtraWhere` 経由に統一。**ポリシー決定を doc comment に文書化**（旧 prose「mirrors」を executable corpus 契約に変換）。fallback ソートの rank→created_at coerce 統一 + 2 つの intentional divergence pin を parity テストに更新。tagCorpusParity 9 tests 新設・offscreen 1090 tests green）
- 2026-09-12-41-refactor-status-panel-split.md（✅ 完了・アーカイブ済 — `statusRenderers.ts` 新設（Layer-0: `{t, esc}` 注入の純粋 string renderer 8 関数）で statusPanel の 6 section string building を委譲。実バグ fix: trust deny path の `new URL(url)` throw → extractDomain・toast timer token（連続 deny 競合解消）。stale closure URL は設計変更（chrome.tabs 再クエリは非同期複雑性が wiring を壊すため将来課題に文書化）。全 704 ファイル 11,590 tests green）

### 2026-09-12 architecture deepening round 13 — 5件（0912e）

round 13 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-1700-r13.html`）の deepening 候補 5 件を RICE 採点 → PBI 化。実行順 = 33 → 37（RICE 降順、ハードな依存なし）。台帳は `2026-09-12-00-backlog-0912e.md`。健全性確認: queryPlanner 6 plan 関数は god module 化していない。

- 2026-09-12-33-fix-cache-flag-restore-once.md（✅ 完了・アーカイブ済 — `createCacheInitializedFlag` を restore-once 化（`RestoreOnce` 継承・初回のみ session get）+ Proxy 廃止（明示的 `set()` で echo 書込排除・lifecycleHandlers の唯一の writer を移行）。`CACHE_INITIALIZED_KEY` を export（module-private でテストがキー "undefined" に書き込む問題も解消）。swStatePersistence flag テスト更新 + restoreOnce 3 tests）
- 2026-09-12-34-fix-reason-label-canonical.md（✅ 完了・アーカイブ済 — recordingHandlers / recordSession を `resolveReasonLabel(reason, getMessage)` adapter に統一（canonical `privacyStatus_*` first）。cache-control/set-cookie が raw slug 表示になる実バグ解消。recordOrchestrator テスト期待値を canonical に更新。popup/background/content 3,637 tests green）
- 2026-09-12-35-fix-filter-params-vector.md（✅ 完了・アーカイブ済 — `FilterCondition` を params vector 専用に変更（ids を spread 格納）し text+ids 検索の nested bind 実バグ解消。`buildWhereClause` を buildFilterConditions の WHERE-prefix 射影 adapter に置換（2 モジュール語彙分裂解消）・qualifyCondition の dead 行削除。Ssot テストを production 出力 direct assert に修正 + search+ids flatten round-trip 新設。offscreen 1085 tests green）
- 2026-09-12-36-fix-purge-zero-old-records.md（✅ 完了・アーカイブ済 — `purgeOldRecords` を 3 backend + dbMaintenance で `!= null && > 0` スキップガードに統一（purgeContent と同一契約）。round 12 PBI 26 の `0` 正規化が old-records 経路で dbMaintenance デフォルト発火に化けていた追半分を解消。interface を optional 化・offscreen 1068 tests green）
- 2026-09-12-37-refactor-preview-view-interface-prune.md（✅ 完了・アーカイブ済 — PreviewView interface + implementation から show/close/setCleansingInfo/resetBodyWidth の 4 dead members を削除（presenter が modal ライフサイクル + width を単一所有）。テスト 4 件削除 + dead メンバー不存在 pin に変更。previewView 25 tests green・全 701 ファイル 11,568 tests green）

### 2026-09-12 architecture deepening round 12 — 8件（0912d）

round 12 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-1640-r12.html`）の deepening 候補 8 件を RICE 採点 → PBI 化。実行順 = 25 → 32（RICE 降順、ハードな依存なし）。台帳は `2026-09-12-00-backlog-0912d.md`。

- 2026-09-12-25-fix-message-handler-restore-cost.md（✅ 完了・アーカイブ済 — `RestoreOnce` seam 新設（restoredOnce/resetRestoreOnce）。`createAutoSavedBadgeTabs` を restore-once 化し fan-out を起動後 1 回に限定。`handleTabRemoved` が resetRestoreOnce + removeAndFlush を実行。restoreOnce 3 tests 新設・tab 3 ファイル 41 tests green）
- 2026-09-12-26-fix-plan-purge-zero-contract.md（✅ 完了・アーカイブ済 — planPurge が `0` を「次元スキップ」（undefined）に正規化し、purgeOldRecords 全件削除 vs purgeContent no-op の逆動作を解消（backend の >0 ガードと契約一致・backend 変更なし）。planPurge テスト更新・offscreen 1055 tests green）
- 2026-09-12-27-refactor-filter-condition-ssot.md（✅ 完了・アーカイブ済 — `buildFilterConditions` 新設（構造化条件の単一語彙）+ `qualifyCondition` で FTS 限定子を param 化（旧 regex replace 削除）。`ExtraWhere.includeDeletedFilter` で FTS/LIKE search のハードコード `is_deleted = 0` を flag 制御に → `excludeDeleted: false` が全 backend で honoring。filterConditionSsot 12 tests 新設・offscreen 1067 tests green）
- 2026-09-12-28-fix-fallback-export-truncation.md（✅ 完了・アーカイブ済 — `FallbackStorage.exportAllRecords()` 新設（未削除全件 direct scan・capped query 迂回）。>10k レコードで fallback のみ export が部分的になる問題を解消（envelope SSOT 維持）。offscreen 1067 tests green）
- 2026-09-12-29-fix-small-bug-bundle.md（✅ 完了・アーカイブ済 — statusToggleBtn に wireOnce 適用（二重配線解消）・removeAll を batch + 単一 flush に（N 回書込解消）・contentKernel の gate! 非null assert を createVisitGate フォールバックに（pre-init crash 解消）・tagClusterLoading の labels を show 毎に再解決（stale i18n 解消）。popup/content/dashboard/background 3,569 tests green）
- 2026-09-12-30-refactor-single-flight.md（✅ 完了・アーカイブ済 — `SingleFlight<K>.run(key, fn, policy: 'join'|'drop')` 新設（utils/singleFlight.ts）で notification（join by URL）と contextMenu（drop by tabId）を委譲。initiator は raw promise・drop は即 resolve。singleFlight 5 tests 新設・utils+background+content 2,771 tests green）
- 2026-09-12-31-refactor-notification-codec-reason-label.md（✅ 完了・アーカイブ済 — `reasonLabel.ts` 新設（canonical `privacyStatus_*` → legacy `privatePageReason_*` → raw の順解決 + replaceAll）で 3 label site を委譲。multi-hyphen latent bug 解消。**主張訂正**: wire codec は既に urlNotificationHandlers.ts に SSOT 済みで「再派生」は誤り。content+background+popup 3,636 tests green）
- 2026-09-12-32-refactor-supports-archive-narrowing.md（✅ 完了・アーカイブ済 — `handleArchive` を `supportsArchive` type guard 経由に統一（per-method probe 削除・ArchiveStaging 型獲得）。ClassBasedBackend fake に archiveStatus 追加。archiveWireDispatch + archiveFallbackRejection 25 tests green・offscreen 1067 tests green）

### 2026-09-12 architecture deepening round 11 — 8件（0912c）

round 11 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-1545-r11.html`）の deepening 候補 8 件を RICE 採点 → PBI 化。実行順 = 17 → 24（RICE 降順、ハードな依存なし）。台帳は `2026-09-12-00-backlog-0912c.md`。

- 2026-09-12-17-fix-audit-paging-seam.md（✅ 完了・アーカイブ済 — `planAuditLog` seam 新設（AUDIT_CAP_* を実配線）・dashboard hop の事前 clamp を pass-through 化・audit TSV に `total > rows.length` ガード追加。**主張訂正**: silent-hang は誤り（外側 catch が応答保証）→ 実害は offset 政策不在の UX 劣化 + TSV 部分配布。planAuditLog 5 tests 新設・audit 168 / offscreen 1093 tests green）
- 2026-09-12-18-fix-visit-report-commit.md（✅ 完了・アーカイブ済 — flag の commit 権を success/terminal 拒否のみに限定（attempting マーカーで再入防止・in-flight guard 追加）。transport throw は flag false で 1 秒後 1 回の bounded retry。commit rule 5 tests 新設 + E2E hook テストを非同期 commit に対応。content 457 tests green）
- 2026-09-12-19-refactor-plan-purge-boundary.md（✅ 完了・アーカイブ済 — `planPurge` seam 新設（有限・非負整数チェック・undefined→デフォルト・異常値 fail-closed）を両 wire 経路に適用。planPurge 15 tests 新設 + coverage pin 4 件更新。offscreen 1055 tests green）
- 2026-09-12-20-fix-small-bug-bundle.md（✅ 完了・アーカイブ済 — context menu を tabId keyed に（URL-blind drop 解消）・pendingChromeStorageQueue の recovered 計測を in-lock 化（負値解消）・checkDomainWithRetry の空応答でも backoff（3 連射解消）・statusPanel console.log 削除・`wireOnce` 共有 seam（domUtils）・`withTransaction` を中立 sqliteTransaction.ts へ抽出（host→worker 越境解消・isHandlerContext 分岐消滅）。loader/visitAdmission テストを新契約に更新）
- 2026-09-12-21-fix-entry-byte-delta.md（✅ 完了・アーカイブ済 — `entryByteDelta.ts` 新設（describeDelta + formatBytes 単位表）で 3 分支の削減計算を委譲。page_bytes=0 の Infinity%/NaN% と `||` による 0 バイト欠落を解消。delta 6 tests 新設・dashboard 2215 tests green）
- 2026-09-12-22-refactor-export-serialize-seam.md（✅ 完了・アーカイブ済 — `Queryable.serialize()` 昇格 + `exportEnvelope.ts` SSOT（EXPORT_COLUMNS whitelist + envelope builder + drift guard）。worker の手書き mapper（`as` 6 箇所）削除、recordsRepo を 3 行委譲に（60 行迂回分岐削除）。coverage pin 6 件更新・offscreen 1055 tests green）
- 2026-09-12-23-refactor-record-session-attempt-context.md（✅ 完了・アーカイブ済 — `openAttempt()` prelude seam 新設（guard → arm button → clear status の単一化・degenerate DOM で idle 自己復帰）。normal/force の 2 重手書き ~60 行を統合。popup 870 tests green・type-check green）
- 2026-09-12-24-refactor-tab-state-seam.md（✅ 完了・アーカイブ済 — `createAutoSavedBadgeTabs(tabExistence?)` に prune 追加（restore 時に stale tabId を刈り込み永続化）・TabCache remove を flushImmediately + `removeAndFlush` で耐久化。durability 3 tests 新設・background 2306 tests green）

### 2026-09-13 UIユーザビリティテスト設計 + issue報告導線（0913a）— 8件完了（45〜52）

- 2026-09-13-45-feat-issue-report-link.md（✅ 完了・アーカイブ済 — 診断パネルへ「不具合を報告」ボタン + プレビューダイアログを実装。`buildIssueReportBody()`でapiKey/baseUrl/dailyPath/ログ本文をサニタイズしGitHub issueへ`chrome.tabs.create({ url })`で新規タブを開く。単体テスト11件green）
- 2026-09-13-46-feat-issue-template-privacy-doc.md（✅ 完了・アーカイブ済 — `.github/ISSUE_TEMPLATE/bug_report.md` 新設 + `public/PRIVACY.md`・`docs/PRIVACY.md` 両方の Third-Party Services セクションにissue報告機能（ユーザー操作時のみ診断情報送信）の記述を追記）
- 2026-09-13-47-test-dashboard-usability-e2e.md（✅ 完了・アーカイブ済 — sidebar 16パネル到達性（マウス/キーボード）・ドメインフィルタ追加→保存→リロード永続化・検索結果件数一致と空状態・タグクラウドノード数一致・Markdownエクスポートの5 E2Eファイル新設。`npx playwright test --project=extension testDir/e2e/usability/dashboard-*.spec.ts` で7 tests green）
- 2026-09-13-48-test-error-recovery-usability-e2e.md（✅ 完了・アーカイブ済 — `dashboard-error-recovery.spec.ts` 新設（AI未設定・Obsidian未接続・ネットワーク断の3パターンでエラーメッセージの原因＋次アクション記述を検証。GeminiのAPIキー未設定メッセージの不備も修正済み）。単独実行で3 tests green を確認済み（初回はworktree並列実行によるリソース競合で未検証のまま完了報告されていたため、事後に再検証した））
- 2026-09-13-49-test-popup-usability-e2e.md（✅ 完了・アーカイブ済 — `testDir/e2e/usability/popup-record-flow.spec.ts`・`popup-onboarding-flow.spec.ts` 新設。record→preview→confirm/cancelの一連タスク完了をcleansing-preview fixtureで検証、onboardingウィザードは選択肢到達性・minimal即完了・Obsidian/SQLite選択後のSkip退避経路・スキップ時の状態一貫性を検証）
- 2026-09-13-50-test-a11y-i18n-usability-e2e.md（✅ 完了・アーカイブ済 — 残タスク（「記録開始」「検索」のキーボードのみ操作検証）を2026-09-14に実装。検索は `a11y-usability.spec.ts` に seed→focus+Enter→`keyboard.type` で追加、記録開始は `popup-a11y-keyboard.spec.ts` 新設（headless スキップガード付き・DISPLAY=1 の headed 実行で実走確認済み）。`test:e2e:usability` 単独実行で 40 passed / 3 skipped（skip は popup 系 headless ガード仕様））
- 2026-09-13-51-test-issue-report-e2e.md（✅ 完了・アーカイブ済 — `dashboard-issue-report.spec.ts` 新設（4 tests: プレビュー本文のAPIキー非混入・chrome.tabs.create の issue URL 検証・Cancel時の非オープン・サイドバー導線）。専用fixtureでGemini APIキーをseedして漏洩なきことを実証。usability 4 tests green）
- 2026-09-13-52-feat-friction-metrics-ci.md（✅ 完了・アーカイブ済 — `frictionMeter.ts` 新設（`page.click`/`page.fill`ラップでステップ数計測）+ `usability-budget.json`（タスク別しきい値）+ `task-friction-metrics.spec.ts`（ドメインフィルタ追加・検索・Markdownエクスポート・issue報告プレビューの4タスク計測）。`playwright.config.ts` に `usability` プロジェクト追加・`package.json` に `test:e2e:usability(:ci)` 追加・`.github/workflows/tests.yml` に usability ジョブ追加）

### 2026-09-14 Firefox 対応（順位1・2 完了 — 09 storage-port / 10 E2E-CI）

- 2026-09-14-09-feat-firefox-storage-port.md（✅ 完了・アーカイブ済 — `supportsOffscreen()` 分岐ではなく `import.meta.env.FIREFOX` ビルド時分岐による StorageHost seam（未使用 transport は各ビルドから物理除去）+ gecko.id・権限分岐・`build:firefox`。実機検証で発覚した追加修正2件（拡張ページの送信者識別を URL オリジン方式に・worker の wasm を安定パスの公開アセット経由に）も同ブランチ（`0914c`）に含む。unit 12,028 + 拡張 e2e（記録・検索）+ firefox worker smoke 全 green）
- 2026-09-14-10-test-firefox-e2e-ci.md（✅ 完了・アーカイブ済 — CI に `firefox-storage` ジョブ追加（`build:firefox` → VFS プローブ + worker smoke を実 dist 成果物で実行）。拡張込み（moz-extension origin）の Playwright 自動化は実験で技術的に不可と確定（リリース系 Firefox は未署名 sideload を拒否・Dev Edition は駆動不可）→ 拡張レベルの検証は PBI 11 の手動チェックリスト、将来の Selenium 経路は別判断。実験記録は PBI 本文参照）

### 2026-09-14 adversarial-code-review 指摘のPBI化 — 4件（ラウンド15レビュー由来・autonomous-task-closer）

アーキテクチャ深化ラウンド15（PBI 01〜04）へのadversarial-code-reviewで、裏取りを経て確定した保守担当者視点の指摘4件。ハッカー視点の指摘は全件却下。台帳は `2026-09-14-00-backlog-review-findings.md`（アーカイブ済）。実行順 = 05 → 06 → 07 → 08（RICE降順、ただし 07 → 08 は同一型を触るため順序依存）。05・06・07・50 はサブエージェント並列（バッチ1）、08 は 07 着地後に単独実装（バッチ2）。

- 2026-09-14-05-refactor-issue-report-attach-trigger-guard.md（✅ 完了・アーカイブ済 — `createIssueReportModalController` 関数スコープに `WeakSet<HTMLButtonElement>`（`wiredTriggers`）を追加し、`attachTrigger` の同一ボタン再呼び出しで `addEventListener` をスキップ。名前と実装が乖離していた既存 `reentrancy guard` テストを「同一モーダルに controller を2つ生成」シナリオとして修正 + 同一ボタン二重配線検出（`collectSnapshot` 呼び出し回数で pin）+ `attachTrigger(null)` no-op テスト新設。wire 6 tests green）
- 2026-09-14-06-refactor-consent-state-changed-payload.md（✅ 完了・アーカイブ済 — 案A採用。`ConsentStateChangedMessage` に「値を運ばない意図・SSOT は chrome.storage・受信側は読み直す責務」の英語 doc comment、`notifyConsentStateChanged` に意図コメント、`popup.ts` のリスナー型注釈を `Partial<ExtensionMessage>` に締め、accept/decline 同一形状を pin する契約テスト新設。`messaging-types-uniformity.test.ts` は無変更でパス）
- 2026-09-14-07-test-opfs-done-legacy-path-contradiction.md（✅ 完了・アーカイブ済 — `MigrationOpfsStatus`/`MigrationIdbStatus` に `legacyStillPresent`（`done && legacyPath != null`・undefined は未確認のため非判定）を追加、`MigrationHintKind` に `'legacyStillPresent'` 追加、`renderMigrationSection` に説明文描画、i18n キー `diagMigrationLegacyStillPresent` を ja/en 両方に追加。`allDone` は不変。deriveMigrationStatus 14 tests + migration 描画 8 tests green）
- 2026-09-14-08-refactor-migration-section-display-state.md（✅ 完了・アーカイブ済 — `MigrationDisplayState` 判別ユニオン（`'done' | 'notApplicable' | 'checking' | 'pending'`・IDB は `Exclude<…, 'checking'>`）を新設し `deriveMigrationStatus` 側で優先順位を一意解決。`renderMigrationSection` の `opfsValue`/`idbValue` は `Record<MigrationDisplayState, string>` マッピングのみに。IDB に checking が無い理由（対応する計測フィールド不在）を型コメントで明示。`diagnosticsPanel.migration.test.ts` 8件を無変更でパス = 視覚的差分ゼロ証明 + displayState 全パターン5 tests 新設）

### 2026-09-14 アーキテクチャ深化ラウンド15 — 4件（/improve-codebase-architecture）

- 2026-09-14-01-refactor-storage-query-dispatch.md（✅ 完了・アーカイブ済 — OpfsWorkerBackend・IdbVfsBackend・storageFallbackの3箇所に独立して埋め込まれていたtext有無によるsearch/listing分岐判断を`queryPlanner.ts`の`planQueryMode()`に一元化。直近2件の回帰（`4a1f6093`のOPFS誤配送、`43385d95`のtext欠落）と同型の回帰テストを新設。offscreen 1107 tests green）
- 2026-09-14-02-refactor-popup-consent-event-subscription.md（✅ 完了・アーカイブ済 — `privacyConsentController.ts` の module-scoped 単発コールバック `onConsentCallback`/`setConsentCallback` を削除。`popup.ts` が既存の `CONSENT_STATE_CHANGED` ブロードキャストを `chrome.runtime.onMessage` で購読しオンボーディング表示判定を再実行する方式に変更。初期化順序依存バグ（`a81d8c1c`, `707f647f`）の再発源を解消。`resetRecordButton` の load/finish 呼び出し保証は既存のまま回帰確認。popup関連ユニットテスト65件 + popup配下867件 green。**事後訂正（2026-09-14・autonomous-task-closer）**: `runtime.sendMessage` は送信者自身のコンテキストには配送されないため、同一 popup セッション内の再判定が発火しない実バグが残存（単体テストは配送をシミュレートするため検出不可、onboarding e2e 4件の失敗で判明）。`privacyConsentController` が同一ドキュメント `consent-state-changed` イベントを dispatch し popup が購読する併用方式で修復済み）
- 2026-09-14-03-refactor-diagnostics-panel-status-derivation.md（✅ 完了・アーカイブ済 — `renderMigrationSection` からOPFS/IDB移行ステータス判定を `deriveMigrationStatus` ピュア関数として分離。`renderMigrationSection` は戻り値をDOMにマッピングするだけに縮小。視覚的差分ゼロ。`deriveMigrationStatus.test.ts` にjsdom不要の単体テスト10件新設。type-check / dashboard 2239 tests green）
- 2026-09-14-04-refactor-issue-report-modal-controller.md（✅ 完了・アーカイブ済 — `createIssueReportModalController` を `{ attachTrigger(btn) }` を返すオブジェクトとして新設。module-scopeの`pendingUrl`・`modalWiredTo`をcontroller内部の状態に置換。`dashboard.ts`でcontrollerを1度だけ生成し診断パネル・サイドバー双方で使い回す構成に変更。`issueReportLink.wire.test.ts`に再入防止シナリオを追加・全15件green）

### 2026-09-12 architecture deepening round 10（0912b）— 8件完了（arch-delivery-loop・0911a ブランチ）

round 10 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-1455-r10.html`）→ RICE 採点 → 実装。実行順 = 09 → 16。実バグ 2 件（preview nav stale-closure / fallback alias 分岐）を解消。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-12-0912b.md`。台帳は `2026-09-12-00-backlog-0912b.md`。

- 2026-09-12-09-refactor-tab-badge-resolver.md（✅ 完了・アーカイブ済 — `tabBadgeResolver.ts` 新設（ordered table + fail-open ラッパー同居）。両 handler は I/O のみに。gate 遅延評価を維持。table test 7 件新設）
- 2026-09-12-10-fix-preview-navigation-stale-closure.md（✅ 完了・アーカイブ済 — buildNavigation を idempotent 化（束縛 handler 保持 + 再配線）・refreshLabels 分離。re-show 回帰テスト新設・previewView 29 tests green）
- 2026-09-12-11-refactor-offline-payload-roundtrip.md（✅ 完了・アーカイブ済 — `OfflineJobPayload` 型 + extract/build を builder module に追加。processor の inline 型を削除。round-trip テスト新設・pipeline 302 tests green）
- 2026-09-12-12-refactor-sender-trust-tiers.md（✅ 完了・アーカイブ済 — `tab-page-only` tier + isTabPageSender を senderTrust に追加。router の inline ブロックを削除し単一呼び出しに。error 文言維持 + matrix 5 件新設・trust+router 88 tests green）
- 2026-09-12-13-refactor-fallback-alias-trust.md（✅ 完了・アーカイブ済 — `is_starred` を queryNormalize に吸収。fallback の qAny ブロック削除 + search() shim 削除（test 移行）。seam test 4 件新設・offscreen 1031 tests green）
- 2026-09-12-14-refactor-preview-payload-builder.md（✅ 完了・アーカイブ済 — `buildRecordPayload` を 3 send で共有 + `SpinnerScope` 新設（try/finally 均衡）。期待失敗を return に正規化。previewFlow 7 tests 新設・popup 870 tests green）
- 2026-09-12-15-refactor-domain-input-policy.md（✅ 完了・アーカイブ済 — `domainInputPolicy.ts` 新設で検証を単一化。`saveDomainLists()` seam 抽出で click+observer ブリッジを直接呼び出しに。parity 3 件 + save 描画テスト新設・dashboard 2209 tests green）
- 2026-09-12-16-refactor-read-limit-single-owner.md（✅ 完了・アーカイブ済 — `QUERY_CAPS` を limits.ts に移動（queryPlan は再 export）。`selectReadCap` + `applySearchPolicy` を planner に新設し search の inline 選択を置換。orphan 100000 を配線 + コメント drift 修正。cap table test 新設・offscreen 1034 tests green）

### 2026-09-12 architecture deepening round 9（0912a）— 8件完了（arch-delivery-loop・0911a ブランチ）

round 9 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-0811-r9.html`）→ RICE 採点 → 実装。実行順 = 01 → 08。実バグ 5 件（dead envelope / archive 復元ハンドオフ / subdomain 判定不一致 / offline リトライ統計欠落 / path whitelist 死エントリ）+ SW ルール違反（setTimeout）解消。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-12-0912a.md`。台帳は `2026-09-12-00-backlog-0912a.md`。

- 2026-09-12-01-refactor-pending-record-gateway.md（✅ 完了・アーカイブ済 — `src/messaging/pendingRecordGateway.ts` 新設（MANUAL_RECORD envelope + 20s timeout + 結果正規化の単一 seam）。privatePageDialog の dead `type:'record'` envelope 実バグ解消・save-path ハンドラの TOCTOU（await 後の currentPendingSave 再読）も入口スナップショットで解消。契約テスト 6 件新設）
- 2026-09-12-02-fix-archive-restore-session-handoff.md（✅ 完了・アーカイブ済 — `archiveOpen` 成功後に `sessionStaging` を設定し open+render を setBusy スコープ内に移動。復元後セッション一覧が空のままになる実バグ解消 + fire-and-forget 解消。回帰 pin テスト新設）
- 2026-09-12-03-fix-domain-snapshot-subdomain.md（✅ 完了・アーカイブ済 — DomainPolicySnapshot に matchSubdomains 追加・evaluateDomainPolicy を 3-arg に統一・両 port が flag を写像。popup statusChecker の表示判定も 3-arg 化。content port vs isDomainAllowed の parity contract test 5 行 matrix 新設）
- 2026-09-12-04-refactor-record-request-builder.md（✅ 完了・アーカイブ済 — `recordRequestBuilder.ts` 新設（SOURCE_POLICY テーブル + canonical diagnostic fields）で 5 call site を統合。offline リトライの `as` cast による統計欠落を解消（stepExecutor がジョブに統計を同梱・processor が builder で復元・catch に log 付き）。5000 slice と sites.google.com を named constant 化）
- 2026-09-12-05-refactor-whitelist-write-gateway.md（✅ 完了・アーカイブ済 — `whitelistWriter.ts` 新設（parseAndValidate → dedup → blob 書込 → cache refresh）で 5 call site を統合。**path whitelist エントリが全 consumer でマッチ不可能な死エントリだった実バグを解消**（hostname に正規化・SPEC §13.5 更新））
- 2026-09-12-06-refactor-opfs-read-hardening.md（✅ 完了・アーカイブ済 — `clampOffset` 新設・worker handleQuery を spec 素通しに（旧 spread は OPFS だけが unbounded limit を通す逆方向発散だった）・searchHandler の死んだ第 3 既定値 50 を削除。負 offset の backend 発散を封じる parametric テスト新設）
- 2026-09-12-07-refactor-badge-policy.md（✅ 完了・アーカイブ済 — `badgePolicy.ts` 新設（state テーブル + setBadge seam）で 4 call site を統合。agent の「global clobber」主張を Chrome per-tab 優先 semantics で訂正し、実際のバグ（tab 派生状態の global 書込が他タブに漏出）を per-tab 化で解消。SW 内 setTimeout 廃止・sender.tab! crash 解消）
- 2026-09-12-08-fix-small-bug-bundle.md（✅ 完了・アーカイブ済 — TabCache hang 解消・offline dequeue/peek を VULN-056 lock 内に・cleansing feedback の dataset.wired guard・i18n messagesCache を getUILanguage キー化・ublock 両形式混在時の logWarn（挙動不変）。sender.tab! は PBI 07 で吸収）

### 2026-09-11 architecture deepening round（0911f）— 5件完了（arch-delivery-loop・0911a ブランチ）

round 9 診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260912-0811-r9.html` の前回版）→ RICE 採点 → 実装。実行順 = 04 → 05 → 06 → 07 → 08。台帳は `2026-09-11-00-backlog-0911f.md`。

- 2026-09-11-04-refactor-recording-orchestrator-narrow.md（✅ 完了・アーカイブ済 — RecordMode・record(mode) 分岐・dead retryObsidian を削除し 3 エントリに。表面 pin テスト新設）
- 2026-09-11-05-refactor-sqlite-query-planner.md（✅ 完了・アーカイブ済 — queryPlanner.ts 新設（planQuery/planSearch/applyReadPolicy）し handler+repo の政策分断を解消）
- 2026-09-11-06-refactor-storage-archive-seam.md（✅ 完了・アーカイブ済 — archiveStaging.ts 新設（ArchiveStaging + supportsArchive）・dispatch fail-closed 統一）
- 2026-09-11-07-refactor-sqlite-dispatch-collapse.md（✅ 完了・アーカイブ済 — フル集約は不採択、validation seam verifyRequestToken + projection seam buildListParams/buildSearchParams を抽出）
- 2026-09-11-08-refactor-popup-permission-ladder.md（✅ 完了・アーカイブ済 — seam 正当化再確認の結果見送り。dead TabContentFetcher 再 export のみ除去）

### 2026-09-11 architecture review round 8 — 3件完了（autonomous-task-closer）

診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260911-2338-r8.html`）→ RICE 採点 → 実装。実行順 = 01 → 02 → 03。主軸: round 7 台帳の「e2e gap 2 spec」— トリガー（e2e 実行可能環境）が本環境で**発火**。台帳は `2026-09-11-00-backlog-0911e.md`（2026-09-14 にアーカイブ済 — 記載のトリガー未発火 10 項目は `2026-09-05-00-backlog-future.md` に統合済みで、live な追跡先はそちら）。

- 2026-09-11-01-test-e2e-history-panel-ui.md（✅ 完了・アーカイブ済 — seedRows 25 行で tag filter / pagination / star の 4 振る舞いを pin。PBI 記載の `--project=chromium` は誤記で `extension` に修正。全セレクタを実 DOM に対照。headless では全 @extension spec と同様 skip。testDir tsc 新規 0 errors）
- 2026-09-11-02-test-e2e-cleansing-preview.md（✅ 完了・アーカイブ済 — modal open / mask 遷移 / confirm→SAVE_RECORD の 3 振る舞いを pin。**fixture の headless ガード欠落を検出・修正**（extension.fixture と同一の tryLaunch + fixme — 無ければ headless で hard-fail）。プロジェクト名も `extension` に修正）
- 2026-09-11-03-fix-check-e2e-platform-gate.md（✅ 完了・アーカイブ済 — xvfb probe を linux 限定に、darwin/win32 は playwright 直接実行。明示 skip 配線（index.mjs）は不変。`onLinux`/`isLinux` 重複を統一。`node --check` + 分岐実測で検証）

### 2026-09-11 architecture review round 7 — 7件完了（arch-delivery-loop・0911a ブランチ）

診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260911-2338-r7.html`）→ RICE 採点 → 実装。実行順 = 01 → 02 → 03 → 04 → 05 → 06 → 07（全項目ファイル非重複）。台帳トリガー全件未発火（維持）。主軸: round 6 台帳の「i18n 未使用キー手動パス」の機械化（3 段階 verifier 完成・104 件削除）+ 未踏領域 4 件の監査。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-11-0911d.md`。台帳送りは `2026-09-11-00-backlog-0911d.md`。

- 2026-09-11-01-fix-models-dev-dialog-esc.md（✅ 完了・アーカイブ済 — 二重 Esc（focusTrap closeCallback + document keydown）を解消し keydown leak を除去 + hide() を idempotent 化。**追加発見**: 静的 HTML twin が TS 実装未達の a11y 仕様（aria-live ×2 / aria-busy / aria-required）を持っていたため、TS 実装を twin 水準に合わせてから twin 2 件削除（orphan WXT entrypoint 含む・build 確認済み）。a11y テストを shipped DOM 対応に全面書き換え）
- 2026-09-11-02-test-i18n-dead-key-removal.md（✅ 完了・アーカイブ済 — 3 段階 verifier（リテラル → substring tests 込み → 動的 prefix・ruleLabels ファミリー 30 件 kept）により **104 key を ja/en から削除**。kept 177 件は変数経由・manifest 解決・動的構築。check-i18n PASS・7466 UI tests green）
- 2026-09-11-03-fix-privacy-page-hardening.md（✅ 完了・アーカイブ済 — fetch 先を chrome.runtime.getURL に移行（現状動作する相対パスの dist 配置依存を解消・検証済みのため hardening 扱い）+ latent 無限ループ 2 行削除 + 見出し id escape + `initPrivacyPage()` export 形態化（import 副作用解消）。サブエージェントの「fetch が壊れている」主張は直接検証で訂正）
- 2026-09-11-04-fix-popup-navigation.md（✅ 完了・アーカイブ済 — navigation の dead 分岐（settingsScreen/backBtn は HTML に存在しない）削除 + historyBtn wiring を menuBtn guard 外へ + popup.ts の import 時 auto-run を削除して entrypoint bootstrap に単一化 + `setHtmlLangDir` 削除（i18n-dom に統一）。popup 全 855 tests green）
- 2026-09-11-05-fix-cleanse-flag-cache.md（✅ 完了・アーカイブ済 — module-level flag cache + onChanged 無効化 + テスト seam（`__resetCleansingFlagCacheForTesting`）+ cache/onChanged テスト 2 件。content 全 445 tests green）
- 2026-09-11-06-doc-architecture-map-seams.md（✅ 完了・アーカイブ済 — Service Worker component tree を現行 seam 語彙（createBackgroundServices / MessageRouter 19 handler / AIService family / RecordingOrchestrator）に更新）
- 2026-09-11-07-test-release-checks-gates.md（✅ 完了・アーカイブ済（しきい値調整あり） — check-manifest の期待権限を wxt.config.ts 派生に（旧 2 権限では drift 不可）+ check-e2e skip の明示化（`--skip-e2e`/`SKIP_E2E=1`）+ check-tests coverage 欠落 fail + `it|test(` のみカウント + `--category` space 形式対応。**coverage ゲートの 90/90 はプロジェクト自身の vitest.config（80/80）と矛盾し素通しでしか通らなかったため 80/80 に揃え**、coverage を実測再生成（lines 93.6% / branches 87.2%）。`release:check --skip-e2e` 全 PASS）

### 2026-09-11 architecture review round 6 — 9件完了（arch-delivery-loop・0911a ブランチ）

診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260911-2338.html`）→ RICE 採点 → 実装。実行順 = 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09。台帳トリガー全件未発火（10 項目再確認）。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-11-0911c.md`。台帳送りは `2026-09-11-00-backlog-0911c.md`。

- 2026-09-11-01-fix-deadline-timer-null-safety.md（✅ 完了・アーカイブ済 — thresholds getter を `| null` に（gate と対称化）・isE2E を non-null 化・:70 の `!` を明示 throw に。contentKernel の thresholds 読み取りにフォールバック）
- 2026-09-11-02-fix-query-normalize-ids-bound.md（✅ 完了・アーカイブ済 — ids に `MAX_QUERY_IDS=200` 上限 + 整数化フィルタ（limits.ts 定義・wire から巨大 IN 節を防御））
- 2026-09-11-03-fix-preview-presenter-settle.md（✅ 完了・アーカイブ済 — settle() 単一 seam（handleAction 欠損 path の promise 永久ハングを reject に・observer 切断・trap release を 1 箇所に）+ initializeModalEvents を idempotent detach→attach に（cleanup の実 removeEventListener・DOM 再構築に堅牢）+ previewView から dead handler 配列と trap 所有を削除（presenter 単一 owner）+ focusTrap tripwire。新規 settle テスト 4 件）
- 2026-09-11-04-test-i18n-unused-keys.md（✅ 完了・アーカイブ済（スコープ調整あり） — check-i18n に未使用キー検出（warn インベントリ・静的スキャンの over-approximation を文書化）を追加。検出器が 2 つの真の発見: 参照済みだがロケール欠落のキー **50 件**を ja/en に補完（archiveModalTitle はモーダル見出しがキー名表示の実バグ）+ `getMessage('locale')` 潜在バグ（壊れた `||` 優先順位で偶然動作）を navigator.language 直参照に修正。310 件の未使用候補は手動 per-key パスに回す（台帳化））
- 2026-09-11-05-refactor-list-sources-ssot.md（✅ 完了・アーカイブ済 — `listSources.ts` SSOT 新設（FILTER_LIST_SOURCES 5 ソース + TRANCO_METADATA_SOURCE を文書化分離）+ urlWhitelist ゲート/cspDomains 権限/buildAllowedUrls origins を派生に（**OISD gate/grant 不一致を解消**）+ conformance テスト 6 件新設）
- 2026-09-11-06-refactor-pending-region-frictions.md（✅ 完了・アーカイブ済 — PendingRegionActions 2 重定義統合・model.subscribe を生成時から load() へ（作成のみ panel が購読を保持しない）・destroy で解放）
- 2026-09-11-07-fix-content-throttle.md（✅ 完了・アーカイブ済 — rAF-debounce（trailing dead branch・scroll depth 過小報告）を leading+保証付き trailing に再実装（performance.now + lastCall=-Infinity・最新 args）+ `{fn, dispose}` 返却 + module 単一 beforeunload flush。contentKernel は stopPeriodicCheck で dispose。旧実装 pin 3 件を新契約に更新 + fake timer 漏れ修正。新規 throttle テスト 5 件）
- 2026-09-11-08-refactor-limits-guard-extension.md（✅ 完了・アーカイブ済 — drift ガードに `10MB family` パターンを追加（**ガード自身が 3 件の未吸収を発見して吸収**: MAX_FILTER_LIST_SIZE / MAX_BODY_SIZE / DEFAULT_IMPORT_SIZE_CAP_BYTES / MAX_ENVELOPE_BASE64_LENGTH / MAX_AI_HTTP_RESPONSE_BYTES / STORAGE_QUOTA_BYTES — 値不変）+ envelope 10MB/64MB 層分離を文書化 + defines assertion を 15 定数に拡張）
- 2026-09-11-09-refactor-small-fixes-bundle.md（✅ 完了・アーカイブ済（一部調整） — main.ts recordBtn 二重配線削除（onclick sole-writer 契約を文字どおり成立）+ archivePanel `ArchiveSessionRowLike` 重複統合。cleanse flag cache は wire-or-delete 台帳項目と統合着手のため本バンドルから除外）

### 2026-09-11 architecture review round 5 — 10件完了（arch-delivery-loop・0911b ブランチ）

診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260911-2149.html`）→ RICE 採点 → 実装。実行順 = 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09（02 依存）→ 10。台帳トリガー「上限 drift」が発火（08）。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-11-0911b.md`。台帳送りは `2026-09-11-00-backlog-0911b.md`。

- 2026-09-11-01-fix-query-normalize-ids.md（✅ 完了・アーカイブ済 — queryNormalize の ids を配列ガード + 有限数フィルタに正規化（wire からの型外れ値クラスタ解消）。非配列/全不正はフィルタ適用なし）
- 2026-09-11-02-feat-pending-pages-sqlite-panel.md（✅ 完了・アーカイブ済 —【PBI-P】SQLite 履歴パネルに pending pages セクション新設（renderPendingRegion・panel-local 状態・onChanged ライブ更新・destroy 解除・20s timeout の MANUAL_RECORD）。Export all as Markdown は Export Logs パネルへ移設（新 id + handler target 更新）。`pendingMoreCount`/`recordRequestTimedOut` キー新設。テスト 7 件新設）
- 2026-09-11-03-refactor-status-extras-ssot.md（✅ 完了・アーカイブ済 — STATUS extras を `SqliteStatusExtras` 単一 field list に統一（StatusResult 継承・decodeStatusExtras を mapped decoder テーブル化・gateway pick を pickStatusExtras 派生に・dashboard 戻り値型 SqliteStatusResult）+ OffscreenResponse union の欠落 6 変数補完）
- 2026-09-11-04-fix-popup-status-cluster.md（✅ 完了・アーカイブ済 — recordBtn 二重所有の復活を解消（statusPanel からの書き込み全削除・sole-writer 契約回復・LOCKED は badge で伝達）+ btnRequestAllUrls wired ガード + gateway spinner 非所有化 + executeScript 重複統合 + `statusTrustLocked` i18n）
- 2026-09-11-05-test-e2e-version-pin.md（✅ 完了・アーカイブ済 — e2e ハーネスの '6.7.114' pin 3 箇所を package.json 派生の EXTENSION_VERSION に置換）
- 2026-09-11-06-refactor-tag-condition-unify.md（✅ 完了・アーカイブ済 — タグ条件を search path へ貫通（buildFtsSearchStatements/buildLikeSearchStatements に tagFilter・FTS は b.id 修飾）+ fallback の手書しフィルタ列を matchesExtraWhere 委譲に（ids 述語が効く）。parametric で text+tag / ids の backend 間一致を pin）
- 2026-09-11-07-refactor-cleansing-reason-unify.md（✅ 完了・アーカイブ済 — counts→reason 派生を resolveCleanseReason に委譲（空カウントは 'none' に統一・'both' との相反解消）+ preview の count 詳細を badge モジュール経由 i18n 化（`cleansingDetailHard/Keyword` キー新設・配列 substitution 形式））
- 2026-09-11-08-refactor-limits-absorption.md（✅ 完了・アーカイブ済 — 上限定数 14 箇所を limits.ts へ取り込み（log-forward 3・MAX_QUERY_LIMIT 二重・8MB chunk・MAX_TOKENS_PER_CALL・PII・envelope・error-body・import text・payloadGuard 3・import row/summary cap）+ drift ガード `limits-drift.test.ts` 新設（ガード自身が追加 4 cap を発見して吸収）+ ADR status note）
- 2026-09-11-09-refactor-remove-legacy-panel.md（✅ 完了・アーカイブ済 —【PBI 16】legacy panel-history 撤去: catalog/factory/HTML セクション/tagEditModal + prod 9 モジュール + legacy テスト 12 ファイル削除（〜−1,600 LOC）。historyFilters を shouldFallbackToTextSearch 1 関数に slim。panelCatalog 18 パネルに更新 + grep ガード `legacy-panel-removal-guard.test.ts` 新設。製品判断 3 件は PBI に記録済み）
- 2026-09-11-10-doc-sync-docs.md（✅ 完了・アーカイブ済 — ERROR_CODES 8+ コード収録 + パス修正、ARCHITECTURE_MAP に Shared Modules Quick Index 新設 + storage 行修正、DESIGN_SPEC §5.4 に STATUS extras 反映、ADR limit-policy status note、cleansingBadge @layer ヘッダ）

### 2026-09-09 architecture review round 3 — 6件完了（arch-delivery-loop・0909a ブランチ）

診断（HTML レポート: `/tmp/architecture-review-20260909.html`）→ RICE 採点 → 実装。バッチ1（並列: 01+02 / 03 / 04 / 06・ファイル非重複）→ バッチ2（05・02 着地後）。台帳据え置き 5 項目は `2026-09-05-00-backlog-future.md` の「2026-09-09 round 3 で台帳入り」節。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-09-0909a.md`。

- 2026-09-09-01-fix-limits-ssot.md（✅ 完了・アーカイブ済 — 上限定数を `src/messaging/limits.ts` に統合（validator/handler/dashboard 事前チェックが同一ソース参照）。実効値維持（validator が先走りのため MAX_IMPORT_ROWS=1000 / MAX_APPEND_IDS=100）、意図的分歧（audit 1000 vs 100000）は名前付き変種化、`importLogsService` の 100_000 は別概念 `IMPORT_TOTAL_ROW_CAP` として命名。drift ガードテスト新設。検証: type-check / lint / 285 tests green）
- 2026-09-09-02-refactor-update-whitelist-ssot.md（✅ 完了・アーカイブ済 — `handleUpdate` の手写し 31 項を `UPDATABLE_FIELDS` import 化、dashboard 10 項を `DASHBOARD_MUTABLE_SUBSET` に命名し subset テストで固定、payload エイリアス 7 件を `normalizeStorageQuery` 純関数に統合、gateway フラット化 wire 契約を JSDoc 明示、`sqlite-security-integrity.test.ts` を SSOT import pin + ランタイム whitelist 検証に移行。検証: type-check / lint / 421 tests green）
- 2026-09-09-03-refactor-row-codec.md（✅ 完了・アーカイブ済 — `rowCodec.ts` 新設（mapNamed/mapPositional 統合・rank 注入点 1 箇所）、`buildPlainListStatements` の columns 必須化、IdbVfsBackend 3 mapper と worker 2 mapper を統合。**本番バグ検出・修正: insertBatch の OPFS worker 経路が最終 1 文のみ計数し `inserted/skipped` が wire で欠落（実機 SQLite で実測）**。33 vs 13 列分歧は dashboard 表示劣化を避け spec として維持・決着記録。検証: type-check / lint / 3250 tests green）
- 2026-09-09-04-refactor-export-validator-ssot.md（✅ 完了・アーカイブ済 — `requiredKeys` 手写し 21 キーを `DEFAULT_SETTINGS` keys − `API_KEY_FIELDS` 派生に置換（旧リストの ~130 キー漏れを是正）、`apiKeyKeys` を SSOT 参照化、blob 保存 12 行 ×2 を `saveJsonToFile` に統合。移行同値テスト 8 件新設。検証: type-check / lint / utils 4348 tests green）
- 2026-09-09-05-refactor-archive-op-codec.md（✅ 完了・アーカイブ済 — `archiveWireTable.ts` を codec 携行の `ArchiveOpDescriptor` に拡張し、dashboard `callArchive` / SW `runArchive` / offscreen `ARCHIVE_DISPATCH` / worker `proxyArchive` / `StorageBackend` 型 / deps `as` キャストを全て行派生に統一（新 op = 1 行 + worker handler）。`as any` 0 件、コンパイル時双方向 assert 維持。公開 14 関数名・noRetry 契約・応答フィールドは不変。検証: type-check / lint / 5969 tests green + E2E archive 系 green）
- 2026-09-09-06-refactor-strip-engine.md（✅ 完了・アーカイブ済 — `SelectorRuleDef` テーブル + `stripBySelectors` エンジン新設、パターン系 23 関数をテーブル行化（news/ec/qa/video 4 コピー解消）、bespoke 11 関数は維持。stripCore 522→166 行 / stripExtended 1,049→493 行（−912 行 / −58%）。旧関数は 1 行 delegate として残置し既存テスト無改変でエンジンを検証。重複パターン棚卸し記録（テーブル内 5・cross-table 67、全て残置が正）。検証: type-check / lint / 895 tests green）

### 2026-09-11 architecture review round 4 — 9件完了（arch-delivery-loop・0911a ブランチ）

診断（HTML レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20260911-1959.html`）→ RICE 採点 → 実装。実行順 = 01 → 02 → 03 → 07（バッチ1・ファイル非重複）→ 04 → 05（バッチ2・statusPanel 共有で直列）→ 06 → 08（バッチ3・offscreen クラスタ）→ 既存 PBI 2026-09-07-15。台帳送り 10 項目 + 小型バグ 8 件は `2026-09-11-00-backlog-0911a.md`。なぜなぜ分析は `/tmp/kilo/whywhy/2026-09-11-0911a.md`。

- 2026-09-11-01-fix-archive-token-scope.md（✅ 完了・アーカイブ済 — archive token の scope binding を残り 4 subtype（open/update/save/close）に拡張し staging 間リプレイの穴を解消。drift ガードテスト（token-required かつ未バインド subtype の検出）新設。prepare/cleanup は破壊的パラメータ無しで不バインドを明記。検証: scope/token/gateway テスト 38 green）
- 2026-09-11-02-fix-archive-panel-locale-ternary.md（✅ 完了・アーカイブ済 — archivePanel 復元プレビューの dead ternary（両分岐が英語固定 'Preview ready.'）を i18n キー `archiveRestorePreviewReady` に置換。check-i18n PASS）
- 2026-09-11-03-fix-popup-pending-pages-record.md（✅ 完了・アーカイブ済 — popup pending pages の実バグ 3 件を修正: dead `type:'record'` message（Save が無記録でページ削除）→ MANUAL_RECORD envelope 化、whitelist 散在キー直書き（settings blob 非対応で恒久的に無効）→ SettingsRepository seam 化、getPendingPages N+1 → ループ外 1 回。旧テストは壊れた挙動を pin していたため新契約に更新）
- 2026-09-11-04-refactor-popup-content-fetch-gateway.md（✅ 完了・アーカイブ済 — popup GET_CONTENT 3 送信 seam を `ContentFetchGateway`（timeout + permission ladder、transport 注入）に統合。tabContentFetcher.ts 削除。statusPanel の生 callback 2 箇所置換、messageTransport の到達不能 lastError ポーリング削除、btnRequestPermission の listener 積み重ねに wired ガード。dead 経路を pin していたテスト 3 件は promise 契約に意図修正）
- 2026-09-11-05-refactor-cleansing-badge.md（✅ 完了・アーカイブ済 — hard/keyword/both の badge 表示政策 4 重実装（statusPanel ×2・previewPresenter・systemHandlers）を `src/utils/cleansingBadge.ts`（Layer 0・getMessage 注入）1 テーブルに統合。真理値表テスト新設）
- 2026-09-11-06-refactor-sqlite-status-ssot.md（✅ 完了・アーカイブ済 — legacy パス定数 4 ファイル 3 流儀を `sqliteMessages.ts` SSOT に統合（drift ガードテスト付き）、STATUS enrichment を `sqliteStatus.ts`（allSettled フィールド隔離 + `indexedDB.databases` feature-detect）に集約。**追加で実バグ修正: offscreenGateway.status() が `idbMigrationV2Done`/`opfsLegacyDbPath`/`idbLegacyDbName` を drop し dashboard 経路で IDB マイグレーション状態が常に欠落**。dual API は役割差のため維持（スコープ調整を PBI 実装メモに記録））
- 2026-09-11-07-fix-dashboard-import-batch.md（✅ 完了・アーカイブ済 — dashboard import を行毎 N+1 round-trip（MAX_IMPORT_ROWS 往復）から `insertBatch` 1 往復に統合。`recordsRepo.insertBatch` が `skipped` を wire まで保持（旧 `{count}` 潰れ）し dashboard の自前 reconstruct を削除。lastInsertError のみ保持で 99 成功 1 失敗が成功報告になる問題も解消）
- 2026-09-11-08-refactor-storage-backend-capability.md（✅ 完了・アーカイブ済 — StorageBackend の archive 不可 stub 28+6 重複を `ARCHIVE_UNSUPPORTED_ERROR` 定数 + `archiveUnsupported()` 共有 stub 1 箇所に統合。テストは定数参照で pin。capability クエリと facets 分割は呼び出し経路が無いため不導入（1 adapter = 仮の seam 原則・PBI 実装メモに記録））
- 2026-09-07-15-fix-history-tag-filter-sql-migration.md（✅ 完了・アーカイブ済 — 保留 3 論点を自律決定して実装: セマンティクス=部分一致維持（FTS trigram は `#` prefix 無し phrase、<3 文字は `tags LIKE`）、性能=better-sqlite3 50k 行実測で LIKE 全走査 median 3.2ms（10s timeout に対し 3 桁余裕・許容）、backend 分岐=統合（PBI-34 divergence 削除・pinning test 無し確認済み）。`TAG_FILTER_FETCH_LIMIT`/`filterRowsByTag`/client slice 削除、`queryPlan.tagFilter` SSOT 化、parametric tag parity テスト新設）

### 2026-09-07 architecture review round — 7 件完了（16 は 2026-09-11 round 5 の 09 として完了）

（`2026-09-05-00-backlog-future.md` の「次ラウンド再評価」項目 + 型債務返済で発見したドリフトを RICE 採点し PBI 化。2026-09-07。AI slot-runner 統合と fallback 再入ギャップは RICE 低・トリガー未発生で PBI 化せず台帳据え置き）

### 2026-09-07 architecture review round 2 — 6件完了（arch-delivery-loop・0907a ブランチ）

診断（HTML レポート: `/tmp/architecture-review-20260907-2151.html`）→ RICE 採点 → 実装。バッチ1（並列: 20 / 21 / 25・ファイル非重複で worktree 並列）→ バッチ2（並列: 22 / 23 / 24）。台帳送り 5 項目は `2026-09-05-00-backlog-future.md` の「2026-09-07 round 2 で台帳入り」節。なぜなぜ分析は `/tmp/kilo/whywhy/` 配下に記録。

- 2026-09-07-20-refactor-copy-markdown-button-factory.md（✅ 完了・アーカイブ済 — copy-markdown ボタン 4 ステップを `createCopyMarkdownButton` factory に統合（labels は解決済み文字列注入で chrome-free 維持）。`copyTextToClipboard` 本番直呼び 2 箇所 → factory 1 箇所。新規テスト 5 件、既存テスト無修正。検証: type-check / lint / utils+dashboard+popup green。commit `79eaae51`）
- 2026-09-07-21-refactor-archive-guard-seam-unification.md（✅ 完了・アーカイブ済 — cutoff ペア検証を `assertCutoffPair` / `CutoffMismatchError` 1 箇所に（validator は安定文言へのマッピング、worker は fail-closed 維持）、`StagingName` branded type 導入（issueName 戻り値 + `decodeStagingName` 境界デコード）、SW handler の空文字チェック 9 箇所と `void isValidStagingName;` 削除（validator 先行を MessageRouter.validators.test でピン留め）、yasumaroVersion 検査を validator へ寄せ文言維持。検証: 88 ファイル 1278 テスト green。commit `c9d45c1b`）
- 2026-09-07-22-refactor-archive-wire-table-driven.md（✅ 完了・アーカイブ済 — archive wire 層を `ARCHIVE_WIRE_TABLE`（14 op、コンパイル時双方向 asserts 付き）で統合。重複ブロック 3 箇所（gateway 重複 overload+case、StorageBackend 重複 interface、types 重複 payload）削除、dbMaintenance 転送 14 関数削除（handlers は Backend 直結）、handlers dispatch を `ARCHIVE_DISPATCH` に、service は `callArchive` で共通化（公開 14 関数名維持）。8 ファイルで 449 deletions / 308 insertions。副産物: `archive_preview` 型の `cutoffDate` 欠落修正。テーブルは `src/messaging/`（中立位置）に配置。検証: 全テスト 11,929 / build green（opfsWorker チャンク残存確認）。commits `be0e3289` `67ecc3b4`）
- 2026-09-07-23-refactor-sqlite-history-view-ownership.md（✅ 完了・アーカイブ済 — sqliteHistoryPanel の描画所有権を View に一本化。Panel 610→198 行（`getElementById` 0 件）、View に `SQLITE_HISTORY_IDS`（唯一所有者）+ `render()` 単一入口 + build/wire ペア。差分/フル 2 経路は維持（旧 renderState は毎回 searchInput.focus() するためフル 1 パス化はフォーカス強奪の a11y 回帰 → 不採用と判断記録）。Model 21 メソッドは不変（台帳で再評価）。検証: dashboard 148 ファイル 2498 テスト / build green。commit `2ebcd52b`）
- 2026-09-07-24-refactor-popup-status-store.md（✅ 完了・アーカイブ済 — `statusStore.loadActiveTabStatus()` が tabs.query + checkPageStatus を単一所有。statusPanel / recordSession の直呼び解消、`resetRecordButton` にスナップショット省略引数（完了パスは fresh fetch 維持）。`normalizeUrlSafe` を urlUtils に新設し statusChecker プライベート実装削除（headerDetector / PrivacyCache 統合は台帳候補）。補足: 診断の「popup 表示のたびに 2 回 fetch」は実測では誤り（open 時は 1 回）で、価値は seam 1 箇所化 + スナップショット共有足場。検証: popup + urlUtils 856 テスト / 全テスト 11,893 green。commit `aeba5bb8`）
- 2026-09-07-25-refactor-panel-catalog-single-source.md（✅ 完了・アーカイブ済 — `panelCatalog.ts`（import ゼロの純粋メタデータ 19 パネル、panel-history は hidden legacy として含む）+ `panelFactories.ts`（`Exclude` 型レベル網羅）を新設。main.ts 直登録 10 件 → `registerCatalog` 1 行、`sectionPanelMap` 削除 → 派生、迂回クリック → `getRegistry().navigate()`（sidebar active 同期を onDidNavigate 購読で補償）。同期検証テスト 16 件。検証: dashboard+popup 184 ファイル 3345 テスト green。commit `5fc70fac`）

### 2026-09-07 architecture review round — 5件完了（autonomous-task-closer）

着手順 = RICE 降順。バッチ1（13/14/18・独立ファイル群でサブエージェント worktree 並列）→ バッチ2（17 → 19・`inMemoryTransport.ts` 競合で直列）。なぜなぜ分析は `/tmp/kilo/whywhy/` 配下に記録。

- 2026-09-07-13-fix-dashboard-i18n-strings-round2.md（✅ 完了・アーカイブ済 — dashboard 直書き英語 11 箇所を i18n 化。`consented` キーを placeholders `{date}` 付きで新設（日付なしは `consentedNoDate` に分岐）し日本語ロケールでの英語常時表示バグを解消、`cleansingFeedbackView` thead 5 語も同時 i18n 化（innerHTML → th+textContent）。新規キー 14、en/ja 同数、check-i18n PASS。検証: type-check / dashboard 147 ファイル / build green。commit `5a35c542`）
- 2026-09-07-14-refactor-extractor-facade-collapse.md（✅ 完了・アーカイブ済 — test-support 規約を `src/**/__tests__/helpers/` に確定・TESTING_GUIDE に明文化し `FakeScheduler`/`InMemoryDomainPolicyPort` を移設、`createVisitGate` を ContentKernel に一本化、GET_CONTENT リスナーを deps 注入の `getContentHandler.ts` に切り出し（新規単体テスト 114 行）、entrypoint を名前付き駆動に寄せ、throttle 3 段と privacyDialog re-export を縮約。`.bak` は gitignore 対象で物理削除。振る舞い不変・既存テスト import 変更のみ。検証: type-check / content 744 tests / lint / build（content-extractor.js 維持）green。commits `37700c19` `35676521` `eda005d2`。bench c5 の FakeScheduler import は着地後に検証で検出・修正）
- 2026-09-07-17-refactor-inmemory-delete-drift-doc.md（✅ 完了・アーカイブ済 — InMemoryTransport の DELETE ソフト/ハード乖離を JSDoc・インラインコメントで明示、削除テスト名を乖離認識型に変更、ガードテスト 3 件（getRecords 残存 / 削除済み UPDATE / 重複検出）で乖離を仕様固定、`dev-docs/TEST_DOUBLES_DIVERGENCE.md` 新設（観点別影響表・is_deleted の正しい用途・将来の追加手順）。検証: type-check / 17 tests / build green。commit `55ee5a58`）
- 2026-09-07-18-refactor-messaging-ublock-type-drift.md（✅ 完了・アーカイブ済 — `PayloadForType` を `'payload' extends keyof U` 分岐で optional payload 対応（no-payload は `never` 維持）、uniformity テストの `as` 退避を本来のアサートに復元、`isServiceWorkerRequest` 整合テスト追加、ublockParser 側 `UblockRules` を `ParsedUblockRuleset` に rename し `ublockMatcher.test` の `as unknown as` ブリッジを明示変換に置換。項目 2・3 はドリフトなしでクローズ記録。型・テストのみで実行時挙動不変。検証: type-check / type-check:test / validate 全体 green。commit `6b6fabe8`）
- 2026-09-07-19-refactor-remove-opfs-spike.md（✅ 完了・アーカイブ済 — OPFS feasibility spike を完全削除（格下げ案不採用・根拠を PBI 実装メモに記録）。union・`SQLITE_MESSAGE_TYPES`・`OffscreenOpfsSpikeResponse`・RPC `opfsSpike`・validators・offscreen ハンドラ・background gateway/deps/protocol/readOnlyHandler・`sqliteOperationSecurity.ts` 3 リスト・InMemoryTransport case・dashboard サービス/UI/ロケール・E2E を 35 ファイルで撤去（+84/−306）、`opfsSpike.ts` を git rm。opfsWorker/WASM と CSP は無修正、`opfsSpike-*.js` チャンク消滅を dist 確認、ADR-014 に撤去 Note、CHANGELOG 追記。grep ガードで再発防止。検証: type-check / lint / 全テスト 11869 / build green。commit `01c0da26`）

### 2026-09-07 テスト型債務返済シリーズ（08〜12・全完了）

- 2026-09-07-08〜11-test-type-debt-*.md（✅ 完了・アーカイブ済 — テストコードの型債務 2,601 errors / 309 files を全量返済。background / dashboard / utils+messaging+\_\_tests\_\_ / popup+offscreen+content+testDir の4バッチを独立サブエージェントで並列返済。型注釈・`vi.mocked()`・非null化ヘルパー・`?.`/`!`/`as` キャストで解消、`@ts-ignore` 新設なし、`src/` 実装は最小変更のみ（`piiSanitizer.MAX_OUTPUT_SIZE` の export 等）、全 vitest グリーン維持。実装バグ 0 件・テスト/実装ドリフト複数を 12 の完了メモに記録）
- 2026-09-07-12-test-type-gate-promotion.md（✅ 完了・アーカイブ済 — ベースラインラッパー（`check-type-baseline.mjs`・`type-check-baseline.json`・`:raw`・`:baseline`）を撤去し `type-check:test` を素の `tsc --project testDir/tsconfig.json --noEmit` に昇格。ネガティブテスト（型エラー1行 → exit 2）実施。以降テストコードの型エラーは CI で落ちる。permission deny の api-key 系2ファイルはユーザーが一時退避して返済。検証: validate / test:type-safe exit 0）

### 2026-09-07 アーカイブE2E自動化のフォローアップ（着手完了）

- 2026-09-07-05-test-archive-session-reconnect-e2e.md（✅ 完了・アーカイブ済 — Y5' セッション再接続E2E（archive-recommended-verification.spec.ts に追記）。reload 前後で `archive_status` の open/stagingName/dirty 保持・`archive_query` 継続動作・**初回タブクリック時の mount プローブによるセッション一覧再表示**・dirty フラグの reload 越え保持を検証。手動チェックリストは Y5（file://）のみ残置。検証: validate / 全E2E 35 green）

- 2026-09-07-06-test-archive-shared-migration-fixture.md（✅ 完了・アーカイブ済 — アーカイブE2E共通fixture化。`openOptionsPage` 統合（3 spec の重複解消）・`migrationSettled`（deferred マイグレーション待ち+封印）・`seedRows`/`runPhaseA`/`isoDateOffset` を dashboardSqliteHelpers へ統合。seedRows の冪等性（UNIQUE制約）を JSDoc 明文化。ベースラインゲートが helper への新規型エラー 4 件を即検出（PBI-04 のゲートが機能した実証）。検証: validate / 全E2E 34 green / -g 個別実行で順序非依存）

- 2026-09-07-04-fix-type-check-test-gate.md（✅ 完了・アーカイブ済 — type-check:test ゲート修理。`vitest/globals` types + rootDir で globals 未解決 15,532 errors を解消後、**326 ファイル・3,173 件の未型チェックテストの実在型エラー**が顕在化。安全なコードモド（vi 型名前空間 325 件・不要 expect-error 265 件）で 2,601 件まで削減し、残りは**ファイル別ベースラインゲート**（新規エラー・件数増で fail）で守る。逸脱メモに実態差とスコープ分割を記録。検証: validate / test:type-safe exit 0、ネガティブテスト実施）

### 2026-09-07 アーカイブ 手動テストのE2E自動化（着手完了）

- 2026-09-07-01-test-archive-manual-to-e2e-required.md（✅ 完了・アーカイブ済 — R1〜R3をE2E化（archive_required-verification.spec.ts・TZ 3種×固定epoch seed+文字列cutoff）、R4は既存vitest single-flightで担保。SQLiteリーダー=`better-sqlite3@12.11.1`（CI Node24 ABI137／ローカル Node26 ABI147 のprebuild実測）。`archiveDbReader.ts`共通ヘルパ＋チャンク結合ユニット11件、アーカイブスキーマFTS非存在assert（文字列+実SQLite実行）。**Red で本番バグを検出・修正: SW archiveHandler に archive_export の case が無く download フローが全壊**。検証: validate / E2E 34 green）
- 2026-09-07-02-test-archive-manual-to-e2e-recommended.md（✅ 完了・アーカイブ済 — Y3/Y4/Y6/G3/G4/G5をE2E化（archive-recommended-verification.spec.ts・実録画との並行 G5 含む）、Y2 は `archiveFallbackRejection.test.ts` 新設（14メソッド×2backend）、G8/R4は既存vitest明文化。**本番バグ2件検出・修正: archive_prepare_incoming / archive_cleanup の応答二重ラップ**（ファイル復元フローが本番で壊れていた）。テスト専用subtype/フラグは追加せず。検証: validate / E2E 34 green）
- 2026-09-07-03-test-archive-manual-partial-automation.md（✅ 完了・アーカイブ済 — R5を実エンジンfreelist減少のE2E 1ケースで上乗せ（太い行300件seed→clear_allでfreelist確保→Phase B で freelistAfter<freelistBefore・vacuumOk:true を実測）。R6/G6は既存vitestカバレッジをPBIメモに一覧化、G6に複数孤児×両kindのケース追加。検証: validate / E2E 34 green）

### 2026-09-06 アーカイブ 退避作成（着手完了）

- 2026-09-06-02-feat-record-archive.md（✅ 完了・アーカイブ済 — フェーズA: 日付指定アーカイブ作成。第4subtypeグループ（archive_preview/create/cleanup/export）を確定、opfsWorker archiveCreateHandlers（バッチINSERT 5000/COMMIT・validateArchiveEngine 検証・max_id_at_archive 記録・single-flight・quotaプレフライト）、ダッシュボード Archive パネル（プレビュー集計・チャンクDL・staging掃除）、i18n 22キー。検証: type-check / lint 0 errors / 11783 tests / build / E2E 104 green。実装メモに逸脱（archive_export 追加・E2Eは静的検証＋jsdomユニット）を記録）

### 2026-09-06 アーカイブ 編集モーダル（着手完了）

- 2026-09-06-07-feat-archive-edit-modal.md（✅ 完了・アーカイブ済 — window.prompt を role=dialog＋aria-modal＋Tab循環＋Esc＋起動要素フォーカス復帰のアクセシブルなモーダルに置き換え（focusTrapManager再利用）。保存時バリデーション（空文字/500字超・role=alert）。i18n 6キー。検証: type-check / lint 0 errors / 11837 tests / build green）

### 2026-09-06 アーカイブ 文言修正（着手完了）

- 2026-09-06-06-fix-archive-backup-wording.md（✅ 完了・アーカイブ済 — Archiveパネル説明を「退避します…削除できます」→「バックアップします…削除も可能です」に修正（ja/en）。**文言のみ・実装ロジック変更なし**（フェーズAは既に本体不変のコピー — 分析はPBI内参照）。i18n保洁テスト2件追加、SETUP_GUIDE/FAQ/READMEの用語統一）

### 2026-09-06 アーカイブ 一時オープン（着手完了）

- 2026-09-06-05-feat-archive-temp-open.md（✅ 完了・アーカイブ済 — **スパイクF-2合格**（実sqlite-wasm 2エンジン共存、`spike-f2-two-engines.test.ts`・記録は plans/ 参照）。archive_open/query/update/save/close/status の6subtype（34型）、worker archiveSessionHandlers（専用engine参照・allowlist検証+migrate・LIKE エスケープ・UPDATABLE_FIELDS whitelist＋isHttpUrl・dirty二重防御・STATUS再接続プローブ）、Archive パネルセッション（検索/一覧/タイトル編集/保存/閉じる・未保存確認）、i18n 15キー。検証: type-check / lint 0 errors / 11830 tests / build / E2E 104 green）

### 2026-09-06 アーカイブ 本体削除・フェーズB（着手完了）

- 2026-09-06-04-feat-archive-purge-staging.md（✅ 完了・アーカイブ済 — archive_delete_by_staging subtype（トークン＋scopeHash・noRetry）、worker archivePurgeHandlers（3条件DELETE述語＋max_id後着行保護・VACUUMトランザクション外＋freelist検証・quotaプレフライト・single-flight・レジストリ/meta突合せ fail-closed）、archiveStaging レジストリにphase-A scope追加（updateStagingRecord）、Archive パネルにフェーズBボタン（confirm dialog・レガシー開示・vacuumOk注記）、i18n 12キー。検証: type-check / lint 0 errors / 11807 tests / build / E2E 104 green）

### 2026-09-06 アーカイブ 復元（着手完了）

- 2026-09-06-03-feat-archive-restore.md（✅ 完了・アーカイブ済 — archive_prepare_incoming/restore_preview/restore の3subtype、worker archiveRestoreHandlers（行単位 changes() 集計・skippedInvalid 分類・バッチ 5000/COMMIT・BEGIN IMMEDIATE・single-flight・staging解放）、Archive パネル復元セクション（ファイル入力→staging書込→プレビュー→復元結果）、i18n 15キー。QueryCache は既存の再訪問時クリア機構で充足。検証: type-check / lint 0 errors / 11793 tests / build / E2E 104 green）

### 2026-09-06 アーカイブ 退避作成（着手完了）

- 2026-09-06-01-feat-archive-foundation.md（✅ 完了・アーカイブ済 — `archiveValidation`（allowlist構造検証＋table_xinfo＋meta突合せ）/ `archiveStaging`（レジストリ・sweep）/ `archiveGuards`（utils・cutoff/isHttpUrl/上限）SSOT化、transport noRetry、トークンscopeHash束縛、**既存全体復元へのアーカイブ拒否ガード**、downloadBlob遅延解放、ERROR_CODES登録。検証: type-check / lint 0 errors / 11748 tests / build green。実装メモにPBI記載からの逸脱（utils配置等）を記録）

### 2026-09-06 autonomous-task-closer — バッチ1（3件）

- 2026-09-06-04-feat-content-storage-toggle-in-settings.md（✅ 完了・アーカイブ済 — 設定画面の「コンテンツ保持設定」に本文保存トグル追加。GENERAL_SETTINGS_SCHEMA 登録＋ラウンドトリップテスト＋E2E。検証: type-check / lint 0 errors / 11702 tests / build green）
- 2026-09-06-05-feat-priority-model-display.md（✅ 完了・アーカイブ済 — Priority (Failover Order) に実モデル名（明示 → ストレージ設定 → カタログデフォルト）を表示。`resolveModelDisplayName` 新設、自動解決値は `dataset.resolved` で保存時に省略。13 tests 新規）
- 2026-09-06-06-feat-domain-subdomain-matching.md（✅ 完了・アーカイブ済 — ドメインフィルタにサブドメイン自動マッチング（デフォルトOFF）追加。`matchesDomainPattern`/`evaluateCachedAllow`/ライブ・キャッシュ両パスにトグル伝播。ラッパーの引数握り潰し問題をテストで検出・修正）

### 2026-09-05 Architecture Round 3（arch3 診断） — 7 件完了

backlog: [2026-09-05-00-backlog-arch3.md](../dev-docs/archived/pbi/2026-09-05-00-backlog-arch3.md)。着手順 = RICE 降順（ファイル番号 NN）。依存なし。

- 2026-09-05-01-refactor-recording-outcome.md（✅ 完了・アーカイブ済 — outcome 政策を RecordingOutcome に集約。catch 分岐＋pending＋通知のペアリングを1 seam に。pipeline 58 tests green）
- 2026-09-05-02-refactor-provider-skeleton-template.md（✅ 完了・アーカイブ済 — HTTP 2 社の generateSummary 骨格を基底テンプレート化（hooks のみ残す）。BuiltIn/testConnection は対象外。循環回避のため transport は dynamic import。ai 214 tests green）
- 2026-09-05-03-refactor-logger-wave4.md（✅ 完了・アーカイブ済 — core 配線の注入化（initLogger/resetLoggerWiring）＋eslint 反転。chrome なし駆動テスト追加。logger 35 tests green、lint 0 errors）
- 2026-09-05-04-refactor-cache-liveview-deletion.md（✅ 完了・アーカイブ済 — getCacheState live-view（~60行）削除。9 テストファイルを typed seam＋振る舞いアサーション＋fake timers に移行。background 全 1297 tests green）
- 2026-09-05-05-refactor-alarm-registry.md（✅ 完了・アーカイブ済 — 5 系統を AlarmRegistry テーブルに集約（flush/immediate 本体共有・失敗統一ログ・daily-purge の await 漏れ解消）。alarm 193 tests green）
- 2026-09-05-06-refactor-popup-record-session.md（✅ 完了・アーカイブ済 — 記録 choreography を RecordSession 状態機械に集約（ForceRecordFlow 削除・5コールバック束解消・二重起動ガード）。statusPanel のデッド hook と onclick 書き換えを削除。popup 833 tests green）
- 2026-09-05-07-refactor-envelope-guard.md（✅ 完了・アーカイブ済 — envelope accept/reject を政策テーブル＋順序付きパイプラインに集約。router の trust/strict 順序は不変。matrix 8 tests + wrapper 198 tests green）

### 2026-09-04 フレーキーテスト安定化（1 件） — 完了

- 2026-09-04-18-test-flaky-stabilization.md（🧪 2pt — 負荷下フレーキー 5 ファイルの機構診断に基づく安定化。clock 注入（aiUsageTracker）・StepExecutor delay 注入（RecordingPipeline、リトライテスト 11 秒→1ms 未満）・cap 不変式アサーション化（tagCooccurrenceCap）・mutex リセット + mock 衛生（idb-migration）・vitest forks cap 8。**検証: `npm test` 3 連続 0 failed（11,449 passed）+ make clean test EXIT=0**）

### 2026-09-04 Architecture Round 2（0904b 診断） — 7 件完了

実装済み（2026-09-04、branch 0904b、`make clean test` EXIT=0・graphify update 済）。アーカイブ: `dev-docs/archived/pbi/2026-09-04-1[1-7]-*.md`。将来的な遡及候補（helpers deep-scan wire-or-delete / tokenizer 署名化 / trendReport 分離）は `2026-09-04-00-backlog-arch2.md` に記録。

### 2026-09-04 ベンチ履歴トレンド表示（1 件） — 完了

- 2026-09-04-10-feat-bench-trend-report.md（✨ 2pt — 蓄積済み `micro-<日付>.json` から指標トレンドを HTML レポートに表示。trend.mjs 集約 + sparkline セクション + CLI 配線、外部参照ゼロ維持。テスト 89 harness green・bench:check PASS）

### 2026-09-04 パフォーマンス最適化 8 件（ベンチ基盤先行） — 8 件完了

backlog: [2026-09-04-00-backlog-perf.md](../dev-docs/archived/pbi/2026-09-04-00-backlog-perf.md)。着手順 = ファイル番号（NN）。**01 が残り 7 件の依存元**（実測ベンチ基盤）。
全 8 件完了（2026-09-04、branch 0904b）。`bench:check` PASS（gated カウンタ全改善: c5 schedule_calls -99% / c6 query_calls -93% / c1 encode -75% / c2.L p99 -49% / c3 M p95 -55%）。08 のみ方式 B 実装後にベンチで逆効果（+53〜178%）が判明し revert・計測ベースでクローズ。02 の単発タイマー化に伴う untrusted scroll 報告経路は deferred 評価（1 秒）で復活済み。アーカイブ: `dev-docs/archived/pbi/2026-09-04-0[1-8]-*.md`、HTML レポート設計は `2026-09-04-09-spec-bench-html-report.md`（実装済み・同梱）。

### 2026-09-04 0902a レビュー由来（重複・dead-code 7件→3PBI） — 3件完了

- 2026-09-04-01-fix-api-key-list-ssot.md（RICE 60 — `apiKeyFields.ts` SSOT新設。storagePort/settingsMigrationの二重定義を解消、drift検出テスト追加。type-check / lint / 関連46 tests / build green）
- 2026-09-04-02-fix-domain-filter-duplication.md（RICE 2.4 — `evaluateCachedAllow`共有ヘルパー抽出、`parseAndValidate`に`isValidDomainPattern`統合（新`domainValidator.ts`で循環回避）、dashboard保存時検証を単一seamに。113 tests green）
- 2026-09-04-03-cleanup-review-dead-exports.md（chore — RequiresPrivacy/Markdown、Slice系4型、domainFilter singleton、RedactingStoragePortを削除。redact関数は維持、DESIGN_SPECIFICATIONS同期。64 tests green）


### 未 PBI 化のトリガー
- **なし。** PBI 06 の効果確認は 2026-09-01 に実施済み（未達 → 06b/06c を実装し達成）。残債は `../dev-docs/archived/pbi/2026-08-31-00-backlog.md` の「06d 候補」に記録（将来候補統合台帳にも収録）

### archived PBI の DoD 乖離監査（2026-09-01）
`autonomous-task-closer` で archived PBI のチェックボックスと実コードを照合。実害ありは PBI-22（対応済み）のみ。表記のみの乖離を各 archived PBI の実装メモに追記済み。特記:
- `2026-08-29-12-fix-crypto-policy-ssot` — 中核実装済み、2 項目未達 → `2026-09-01-05` に切り出し実装・アーカイブ済み
- `2026-08-24-03-refactor-sqlite-consolidation` — 部分実装（`storageMaintenance.ts` の動的 import 未解消、実害低）。追加 PBI 化は見送り
- `2026-08-30-05-feat-cleansing-offscreen-delegation` — PoC 品質（flag OFF で本番未使用）。追加 PBI 化は見送り

---

### 2026-09-05 Architecture Round 4（arch4 診断） — 7 件完了（全行アーカイブ済み）

backlog: [2026-09-05-00-backlog-arch4.md](../dev-docs/archived/pbi/2026-09-05-00-backlog-arch4.md)。着手順 = RICE 降順（ファイル番号 NN）。依存なし。

- 2026-09-05-01-refactor-provider-backedge.md（✅ 完了・アーカイブ済 — 中立テーブル＋述語を低層に新設し逆辺2本を切断。catalog は spread で drift 不能に。template は静的 import に復帰。utils 2453＋ai 218 tests green）
- 2026-09-05-02-refactor-pending-merge-lock.md（✅ 完了・アーカイブ済 — merge＋truncate を pendingPatchPolicy に抽出し mutate 経由に。retryCount は backoff 継承に。interleave 新規テスト付き。queue green）
- 2026-09-05-03-refactor-popup-feedback.md（✅ 完了・アーカイブ済 — pass-through 2 件＋専用テストを削除しセッション private 化。fetcher/flow の spinner 注入も除去。popup 827 tests green）
- 2026-09-05-04-refactor-visit-reporter.md（✅ 完了・アーカイブ済 — 共有ビルダー buildVisitStats に一本化＋label 参照を注入化。force retry 最小形は意図的と確定。matrix 8 tests。content 414 green）
- 2026-09-05-05-refactor-sanitizer-seam.md（✅ 完了・アーカイブ済 — 5 政策サイトを checkPromptSafety テーブルに集約（MEDIUM 明示 pass、文面同一、リテラル比較で既存モック無修正）。matrix テスト付き。274 tests green）
- 2026-09-05-06-refactor-visit-admission.md（✅ 完了・アーカイブ済 — 純粋政策関数＋retry＋判定フローを visitAdmission に集約。loader 3分岐→単一フロー、port 2 impl 共有化、shim 削除。content 426 green）
- 2026-09-05-07-refactor-pending-queue.md（✅ 完了・アーカイブ済 — 5 Whys で facade 狭窄を棄却（多層防御は意図的）。真の欠陥 clearExpiredPages のロック外 set を withOptimisticLock 化＋競合回帰テスト。pending 45 green）

### 2026-09-05 Checking Team レビュー由来（review-fixes 残候補） — 15件完了（autonomous-task-closer）

backlog: [2026-09-05-00-backlog-review-fixes.md](../dev-docs/archived/pbi/2026-09-05-00-backlog-review-fixes.md)（#12–26 を PBI 化 → 全件実装・アーカイブ。NN 17–31）。着手順 = backlog RICE 順。バッチ1（小規模 10 件: 17/18/19/20/24/25/26/27/30/31・controller-direct＋サブエージェント併用）→ バッチ2（21 層逆転・28 barrel 移行）→ バッチ3（23 版移行ウィンドウ・22 再同期）→ バッチ4（29 スパイク）。

- 2026-09-05-17-fix-ratelimiter-write-debounce.md（RICE 1400 — 認証失敗バースト時の session+local 二重書き込みをデバウンス合体、ロックアウトは即時フラッシュ維持。commit `58209313`）
- 2026-09-05-18-refactor-domain-matching-unify.md（RICE 1400 — `matchesPattern` 3 コピー（domainUtils/urlSkipper/domainFilterCache deprecated）を単一共有パスに集約。3 コピーは意味論同一と確認。commit `cd9db5ef`）
- 2026-09-05-19-refactor-errorutils-split.md（RICE 800 — スコープ補正の実態: 非推奨 shim `errorMessages.ts` 削除。shim テストのユニーク 2 アサーション（技術情報非漏洩・機密マスキング）を errorClassification.test に移植。commit `6091f697`）
- 2026-09-05-20-fix-popup-status-label.md（RICE 800 — ステータスサマリーアイコンに可視テキストラベル追加（data-i18n・en/ja・check-i18n PASS）。欠落キー `statusPublicPage` も補修。commit `65dd4114`）
- 2026-09-05-21-refactor-layer-inversion-neutral.md（RICE 700 — 唯一の background→popup 層逆転（consent モジュール import 4 箇所）を `src/utils/storage/` 中立層移動で解消。テスト vi.mock 6 件更新。commit `8471535d`）
- 2026-09-05-22-fix-legacy-dual-write-resync.md（RICE 600 — LEGACY_DUAL_WRITE 再有効化時の SQLite→レガシー再同期を実装。トリガーは MANUAL-ONLY と決定（PBI 実装メモ・ADR・CHANGELOG 記録）。commit `a49bdb7f`）
- 2026-09-05-23-fix-protocol-version-window.md（RICE 600 — envelopePolicy 政策テーブル内に N-1 マイナー版受理ウィンドウ（deprecation log + flag）を導入。trust/size 検証は不変。リリースノート記載済み。commit `1e4e7a98`）
- 2026-09-05-24-fix-dashboard-i18n-strings.md（RICE 500 — dashboard の英語ハードコード 4 箇所を i18n 化（en/ja・check-i18n PASS）。commit `0327b37f`）
- 2026-09-05-25-fix-popup-focus-trap.md（RICE 320 — 未配線 3 系統ダイアログに focusTrapManager を配線（新規 18 tests）。commit `fcd13631`）
- 2026-09-05-26-fix-pending-queue-bounds.md（RICE 320 — pending キューに絶対上限（drop-oldest）＋TTL クランプ追加。lock 規律不変。commit `f3d75606`）
- 2026-09-05-27-fix-download-path-guard.md（RICE 360 — 4 つの download 呼び出しの filename に `sanitizePathSegment` を適用（本番消費者ゼロだった util を活性化）。commit `7676a3e8`）
- 2026-09-05-28-refactor-utils-dump-cleanup.md（RICE 200 — storage barrel のテスト参照を直接 import へ移行（115 files・net −1,468 行）。barrel は tranco dynamic import の意図的設計につき維持・残置理由を記録。commit `577acdc6`）
- 2026-09-05-29-backlog-sqlite-backend-consolidation.md（RICE 83・スパイク — 4 層スタックの現状マップと整理案（推奨: レガシーサンセット Option A）を `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md` に提出。副次発見: opfs-async-main デッドパス・InMemoryTransport ソフトデリート乖離・fallback 再入ギャップ）
- 2026-09-05-30-fix-validate-fast.md（RICE 18 — `validate:fast` = validate:json + lint + type-check + `vitest run --changed`。CONTRIBUTING に使い分け追記。commit `cf74ec41`）
- 2026-09-05-31-fix-wasqlite-license.md（RICE 1.8 — スコープ補正: 上流 license フィールド欠落は SBOM 空表記のみが実害。`scripts/generate-sbom.mjs` で人間検証済み license 補正テーブルを適用。commit `00cc7c07`）

検証: `npm run validate` 相当（type-check clean / lint 0 errors / test 11,658 passed / build OK）。

### 2026-09-05 Architecture Round 5（arch5 診断） — 6件完了

backlog: [2026-09-05-00-backlog-arch5.md](../dev-docs/archived/pbi/2026-09-05-00-backlog-arch5.md)。実行順 = Phase 1–2（review-fixes）着地後、ラウンド内 RICE 降順。全タスク SDD（サブエージェント実装＋タスクレビュー）で実施し最終全体レビュー READY TO MERGE。

- 2026-09-05-11-refactor-dashboard-sqlite-sender-unification.md（RICE 28.8 / Strong — DASHBOARD_SQLITE sender 4 箇所・retry 4 層を `DashboardGateway`（`src/messaging/` へ移設）1 module に統合。retry は opt-in option で吸収、getSqliteStatus は変換層化、diagnostics の迂回解消（SQLite + TEST 系送信）、`decodeOpfsSpikeReport` 厳密版を validators に移設、sender 所在 grep ガード新設。impl `f8552fdc` + fix `66776e8e`、1 fix cycle）
- 2026-09-05-12-refactor-content-seam-micro-batch.md（RICE 12.0 / Worth — `watchDynamicContent` 1 signature 化（kernel 側 2 面削除）・`cleansingExecuted` フィールド + kernel 注入 sender 経由の通知移動（utils chrome-free 化・recount-only 誤送信回避）・visitAdmission header/errorDetail・dead seam 削除。commit `9e99a7a`）
- 2026-09-05-13-refactor-extract-orchestration-collapse.md（RICE 8.75 / Strong — candidate/body 二重経路 ~80 行を共有 internal step `runCleanseAndExtract` に折り畳み、cleansedReason 判定 ×3→×1。entry 2 種と ByteMeter 計測順序は維持（bench c1/c4 連続性実測確認）。commit `b6300f55`）
- 2026-09-05-14-refactor-history-panel-lifecycle-narrowing.md（RICE 5.0 / Worth — lifecycle 配管 8 method を `onNavigateIn`/`onNavigateOut` に狭窄（interface 27→21）・`invalidateCache` 政策集約・契約テスト新設。double-init の pendingInit leak を意図的修正として文書化。impl `56909d90` + fix `3d7978ea`、1 fix cycle）
- 2026-09-05-15-refactor-provider-testconnection-hoist.md（RICE 4.5 / Worth — `_getAllowedUrls` 逐語同一 2 コピー（旧 PBI 2026-08-07-01 指摘）と応答 cap 3 定義を base に引き上げ（`MAX_AI_HTTP_RESPONSE_BYTES` + `getAllowedUrlsForRequests()`）。impl `b6b09ca1` + docs `8c52f230`）
- 2026-09-05-16-refactor-bench-trend-report-split.md（RICE 3.3 / Worth — htmlReport から trendReport モジュール分離・escapeHtml を format.mjs へ移動。commit `3d32b6da`）

最終全体レビュー（99702d16..3d32b6da）: READY TO MERGE。クロスタスク討議 1 件（クレンジング badge 通知が body フォールバック経路でも発火するのは旧非対称の修正として意図的・CHANGELOG 記載）＋ carried Minor 10 件すべて ACCEPT AS-IS。

### 2026-09-05 Checking Team レビュー由来（review-fixes）第2弾 — 6件完了

- 2026-09-05-01-fix-remove-all-urls-permission.md（RICE 7200 — `optional_host_permissions` から `<all_urls>` を削除し個別ドメイン列挙のみに。manifest.test.ts に不在アサーション新設。commit `58a894c1`）
- 2026-09-05-05-fix-retention-defaults.md（RICE 3600 — `SQLITE_RETENTION_DAYS` デフォルト 365 日（無制限放置の解消）＋両境界無制限時の警告表示（i18n en/ja）。commit `856fa3ab`）
- 2026-09-05-06-fix-fts-rebuild-condition.md（RICE 3200 — FTS 再構築条件を `ftsCount === 0` → `ftsCount < baseCount` に緩和し部分インデックスを自動修復。commit `5d67e218`）
- 2026-09-05-07-fix-migration-string-match.md（RICE 2800 — 冪等判定を `pragma_table_info` 存在確認ベースに変更し、許容パターンを `IDEMPOTENT_DDL_ERROR_PATTERNS` 定数としてテスト固定。commit `5d67e218`（06 と同一コミット））
- 2026-09-05-09-fix-popup-width-constraint.md（RICE 2000 — popup 幅を min 360/max 420 の許容範囲方式に緩和し、翻訳ラベルを持つボタン/toggle の nowrap を解除。commit `f99a333d`）
- 2026-09-05-10-fix-recording-default-state.md（RICE 2000 — 初回 OFF（同意ゲート）をピン留め、記録可能タブで `●` バッジ常時表示、オンボーディングに記録範囲説明を追加（i18n en/ja）。commit `99702d16`）

第1弾（02/03/04/08）と合わせ review-fixes 01–10 は全件完了。backlog #11（retry 成否返却）も PBI 化なしで完了（commit `80660334`）。

### 2026-09-05 Checking Team レビュー由来（review-fixes）第1弾 — 4件完了

- 2026-09-05-02-fix-crypto-token-fallback.md（RICE 6400 — `generateToken` を fail-closed 化（secure RNG なしで throw）し `Math.random` フォールバックを物理削除。confirmTokenManager-failclosed 3 tests。commit `eebc9c66`）
- 2026-09-05-03-fix-message-validator-limits.md（RICE 3600 — `VALIDATOR_LIMITS` 定数テーブルで ValidVisit content 1MB・ManualRecord title 500/content 1MB・SQLite search 1000/import rows 1000・2MB/restore_db 10MB/append ids 1000 を超過拒否。validators-limits 7 tests。commit `6ecd5a30`（04 と同一コミット））
- 2026-09-05-04-fix-url-scheme-validation.md（RICE 3600 — MANUAL/PREVIEW/SAVE_RECORD の payload.url に http/https 以外のスキーム（javascript:/data:/ftp 等）と不正形式を ValidationError で拒否。commit `6ecd5a30`（03 と同一コミット））
- 2026-09-05-08-fix-api-key-decryption-wipe.md（RICE 2400・レビュー唯一の High — 復号失敗フィールドを空文字化せず元の暗号文を保持し `unrecoverable` リストで通知、後続書き込みでも暗号文を保全。settingsMigration-unrecoverable 3 tests。commit `bf85fac4`）

付随して backlog の **#11（retry 系エントリが常に成功を返す）も PBI 化なしで完了**（`retryObsidianWrite` が obsidianDuration の有無で成否を返す。retryObsidianWrite-result 3 tests。commit `80660334`）。4 新規テストスイート計 24 tests green（vitest）。

### 2026-09-03 0902a ブランチレビュー由来の CRITICAL 修正 — 5件完了

- 2026-09-03-01-fix-ssrf-allowlist-bypass.md（RICE 4.8 — `isAllowedProviderBaseUrl` を CIDR 範囲で堅牢化。0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 の範囲ブロック追加、整数/hex IPv4 デコード、IPv6 ブロック (::1/::ffff:/fc00/fe80)。BDD テスト 38 件。type-check / lint / build green）
- 2026-09-03-02-fix-trust-policy-orphan-singleton.md（RICE 4.8 — TrustPolicy の orphan fallback を撤廃し `getTrustDbAdmin().getPolicy()` に委譲。TrustDecision は `this.admin.getPolicy()` を毎回 lookup し stale cache を排除。BDD テスト 13 件。type-check / lint / build green）
- 2026-09-03-03-fix-dashboard-confirm-token-fail-closed.md（RICE 10.8 — dashboardGateway の confirm-token を fail-closed 化。token 取得失敗時に IPC を送らず `SqliteResult` エラーで返す。BDD テスト 16 件。type-check / lint / build green）
- 2026-09-03-04-fix-domain-filter-mode-inversion.md（RICE 5.4 — DomainFilter の `isAllowedCached` / `CacheAdapter` が mode を無視し blacklist を whitelist として反転していたバグを修正。`isDomainInList` ヘルパ抽出、mode thread、cache に mode 追加。BDD テスト 44 件。type-check / lint / build green）
- 2026-09-03-05-cleanup-orphan-exports-dead-mocks-shim-importers.md（RICE 0.9 — orphan exports 削除 (withLockViaPort, PROVIDER_REGISTRY, isDomainTrusted convenience)、dead vi.mock 除去 2 件、7 prod importer を optimisticLock → storageTransaction に移行、`optimisticLock.ts` 物理削除。type-check / lint / build green）


### 2026-09-04 dashboard テスト confirm-token ハンドシェイク対応 — 1件完了

- 2026-09-04-01-test-dashboard-confirm-handshake.md（RICE 8.0 — PBI 03-v1 の fail-closed 化で破壊的操作が2段階送信になったことに dashboard 系テスト 56件が未対応だった問題を解消。shared ヘルパ `__tests__/helpers/dashboardSqliteMock.ts`（subtype ルーティング）を新設し 4 ファイルを移行。付随して lockContract.test.ts の削除済み optimisticLock import も修正（commit d567547c）。119 tests green）

### 2026-09-03 Architecture Deepening Round 2026-09-03b — 7件完了（Trust / Retry / Pipeline / Composition / Provider / SQLite）

- 2026-09-03-01-refactor-trust-seam-consolidation.md（RICE 12.0 — globalThis registry 廃止。TrustDbKernel の `__trustDbKernel` 登録と TrustPolicy の `__TrustPolicyClass` を削除。`getTrustPolicy()` を `getTrustDbAdmin().getPolicy()` 委譲に、TrustDecision は `admin.getPolicy()` 毎回 lookup で stale 排除。Admin/Kernel に `isInitialized()` 追加で fail-closed 維持。158 tests green）
- 2026-09-03-02-fix-retry-policy-ai-false-positive.md（RICE 9.6 — `isNetworkError` から `lower.includes('ai ')` を削除。ADR 2026-08-27 列挙語（network/fetch/timeout/offline/econnrefused/enotfound）+ connection/unavailable のみに限定。境界テスト 5 件追加。type-check / lint / build green）
- 2026-09-03-03-refactor-pipeline-consolidation.md（RICE 6.0 — PipelineKernel(60行 thin loop)を RecordingOrchestrator.executeInternal に inline 化し削除。sole state owner 化でセマンティクス集約。89 tests green）
- 2026-09-03-04-refactor-staged-context-branding.md（RICE 4.8 — StagedContext<S>/ContextStage 等 dead branding を削除。createInitialContext/assertStage 撤去、RetryContext を RecordingContext に。type-check / lint / build green）
- 2026-09-03-05-refactor-composition-root-typed.md（RICE 4.0 — setSqliteHealthCheck/getSqliteHealthCheck の module-global ペアを削除。ensureStorageQuota の fallback chain を単純化、manifest onReady wiring 撤去。storageMaintenance テスト追加。type-check / lint / build green）
- 2026-09-03-06-refactor-provider-catalog-split.md（RICE 2.7 — isAllowedProviderBaseUrl(124行)を providerSecurityPolicy.ts に分離。catalog は re-export で後方互換。61 tests green）
- 2026-09-03-07-refactor-sqlite-gateway-single-seam.md（RICE 2.0 — sendDashboard の重複 Promise.race を sendDashboardRaw に統一。dashboardGateway テスト 16件 green）

### 2026-09-03 Architecture Deepening 0903 — 7件完了

- 2026-09-03-01-refactor-storage-concurrency-primitive.md（RICE 720 — `StorageTransaction` deep module（`withLock`/`withAtomic` 2メソッド）に統合。`optimisticLock`/`keySerializer` を shim 化、`SettingsRepository` の `isChromePort` 分岐を撤去、`InMemoryStoragePort` の explicit `_version` 対応と contract test 18件追加。type-check/lint/test/build green）
- 2026-09-03-02-refactor-provider-catalog-unification.md（RICE 213 — `ProviderCatalog` を deep module 化。`providerRegistry` を shim 化、`RemoteAIService` の switch を委譲に、`aiProviderCatalogView` の `KEY_TO_INPUT_ID` を `storageKeyToInputId` 関数に。type-check/lint/test/build green）
- 2026-09-03-03-refactor-recording-orchestrator-modes.md（RICE 186 — `retryPolicy` 抽出と `retrySteps` コンパイル完了、typed Context は `contextBuilder.ts`（211行）に抽出、`StepDeps` の `?? sqliteClient` fallback 削除、`pickDefined` spread を builder に置換。288 tests green）
- 2026-09-03-04-refactor-trustdb-seam-split.md（RICE 168 — `TrustDbAdmin`（mutation）と `TrustPolicy`（readonly）の 2 seam に分割。`trustDb.ts` shim を物理削除（04b commit: 64609768）。`STORAGE_KEY` を `StorageKeys.TRUST_DB` に集約、`settingsReader` を `SettingsRepository` 経由に、全 prod caller を `getTrustDbAdmin`/`getTrustPolicy` に移行（16 files）。227 tests green）
- 2026-09-03-05-refactor-recording-cache-split.md（RICE 80 — `SettingsCache`/`UrlCache`/`PrivacyCache` 3モジュールに TTL 分離。`RedactingStoragePort` で `redactSettingsApiKeys` を委譲。`RecordingCacheInstance` を 3 cache compose の true facade に。42 tests green）
- 2026-09-03-06-refactor-domain-filter-unification.md（RICE 58 — `DomainFilter` を single seam に統合。`wildcardToRegex` 一本化、`domainFilterCache` の blacklist 空配列 TODO 解消、`CacheAdapter` 第2 adapter で seam を実在化、TTL は construction param に。37+ tests green）
- 2026-09-03-07-refactor-sqlite-gateway-fidelity.md（RICE 12 — `OffscreenGateway`（131行）と `DashboardGateway`（67行）に hop 分割。`InMemoryTransport` の `ORDER BY` を `localeCompare` に修正、`sanitizeFtsTerm`/`QUERY_CAPS`/`matchesExtraWhere` を共有化。`sqliteClient.ts` shim を物理削除（07b commit: 8f1d956d）。14 contract tests green）

- 2026-09-03-08-fix-daily-note-path-placeholder-discoverability.md（RICE - — `dailyNotePathPlaceholder` を `092.Daily または raw/YYYY-MM` に、`dailyNotePathHelp` を ja/en 追加、`entrypoints/options/index.html` に help-text 追加、`docs/FAQ`/`SETUP_GUIDE` に月次例追記、`dailyNotePathBuilder` に 3ケース追加。build 後の dist で placeholder と help-text を目視確認、validate green）

詳細な 5 Whys は `/tmp/kilo/whywhy-remaining.md` に記録。

### 2026-09-02 i18n チェック誤検知修正 — 1件完了

- 2026-09-02-01-fix-i18n-check-false-positive.md（RICE 300 — check-i18n.mjs:84 の配列への `in` 演算子バグ修正。`Object.keys()` の戻り値（配列）に `in` を使っていたため全 1,247 キーが「extra」と誤判定。オブジェクト照合に修正し、extra キー検出を warn→fail に昇格。比較ロジックを i18n-core.mjs に抽出し 16 テストを追加。Models.dev プロバイダー例の Perplexity→Hugging Face 修正も含む。release:check 7/7 PASS（i18n 警告 0 件）、validate PASS）

### 2026-08-31 Architecture Deepening 0831a — 6件全完了（PBI 01〜06）

- 2026-08-31-01-fix-settings-dual-truth.md（RICE 2160 — `SettingsRepository` への一本化。`settingsStore.legacy.ts` / `settingsStore.ts` を削除し、`storage.ts` barrel を SettingsRepository 委譲に切り替え。旧 re-export を settingsMigration / urlWhitelist / storageMaintenance / savedUrlRepository へ振り直し。34 call sites + 約 90 テストファイルの import を移行。`getAll()` の scattered fallback を `__getAllScatteredFallback` test 専用 seam に分離。ADR `2026-03-20-default-settings-single-source.md` に Phase 4 追記。type-check / lint / test / build green）
- 2026-08-31-03-fix-trustdb-god-module.md（RICE — trustDb god module を `TrustDbKernel`（lifecycle + 単一 `chrome.storage` 読取 + 単一 `withOptimisticLock`）/ `TrustPolicy`（`isDomainTrusted` / `isTrancoDomain` seam）/ `ManagedCollections`（userTlds / sensitive / whitelist 束ね）に分割。`trustDb.ts` は re-export shim に。settings アクセスを注入可能な `settingsReader` port 化し、ADR 2026-08-20 の循環 1 を解消。dead code の `whitelistStore.ts` / `sensitiveDomainStore.ts` を削除。DESIGN_SPEC §5.5 新設 + ADR 2026-08-20 に解消記録。11109 tests green。残: 破損 DB 復旧の手動 e2e 確認のみ）
- 2026-08-31-06-feat-provider-catalog.md（RICE — Speculative。`ProviderCatalog` を単一 seam として先行実装。csp / cspSettings / DiagnosticsCollector / getMaxContentChars を Catalog 駆動化。DESIGN_SPEC §11.3 新設。再評価トリガー（次 provider 追加時）を backlog に明記。11109 tests green。**2026-09-01 効果確認 → 未達（約 20 ファイル分散）→ 06b/06c を実装して達成**、下記フォローアップ参照）
- 2026-08-31-05-feat-sqlite-gateway-unification.md（RICE — 2 つの RPC スタックを `SqliteGateway`（query/mutate/maintain/status + 統一 `SqliteResult<T>`）に統合。`SqliteClient` / `dashboardSqliteService` を委譲 shim に。`queryPlan.ts` に WHERE 生成を集約し `IdbVfsBackend` / `searchHandlers` の重複を削除。`StorageBackend` を `Queryable` / `Mutable` に分割。dashboard hop の二重 `categorizeError` を修正。`OffscreenTransport` の 2nd adapter として `InMemoryTransport`（stateful in-memory store、chrome.* 不要）を実装。DESIGN_SPEC §5.4 追記。11117 tests green。フォローアップ: 未接続の `BrowsingLogRepository.ts`（PR #87 由来）の整理）
- 2026-08-31-02-feat-recording-orchestrator.md（RICE 480 — `RecordingOrchestrator` の単一 `record(data, opts)` seam に集約。`PerUrlMutexMap` の static 共有マップを削除し、container singleton の `perUrlMutexMap` を pipeline deps に配線して cross-instance の URL 直列化を回復（**duplicate-entry race の修正**）。`buildRecordingPipelineDeps` identity 関数を削除。`RecordingPipeline` facade から `recordWithPreview` を削除。DESIGN_SPEC §8.3 新設。11117 tests green。フォローアップ: `RecordingPipeline` facade / `createRecordingPipeline` の完全撤去（blast radius 大、別 PBI））
- 2026-08-31-04-feat-composition-manifest.md（RICE 210 — Service Worker composition root を宣言的 `compositionManifest.ts`（`CompositionEntry[]` = `{ key, factory(container), singleton, onReady? }`）に。`createBackgroundServices` は manifest の register ループに縮小（import 36→16）。`dashboardSqliteClient` / `dashboardSqliteHandler` alias を composition から除去（後者は router 経由）。`setPendingWriteQueue` / `setSqliteHealthCheck` の副作用を `onReady` に局所化。`deps` フィールドは持たず factory が `resolve` する設計（型推論パズルを回避）。DESIGN_SPEC §2.2 新設 + ADR 2026-08-20 に循環 2 の配線整理を追記。11117 tests green）

### 2026-09-01 0831a フォローアップ / DoD 乖離監査 — 6件完了

- 2026-09-01-05-fix-crypto-policy-ssot-followup.md（archived PBI 2026-08-29-12 の DoD 未達 2 項目。**VULN-035**: `exportLogsService.exportJson()` に HMAC 署名（`version: 2`）、`importLogsService.importFromJson()` に署名検証ゲート。無署名（旧 v1）/ 改竄ファイルは拒否（旧ログ JSON は再インポート不可）。**VULN-039**: `hmacKeyStore` の署名鍵・ラップキー生成を 2 ロック（outer→inner）で直列化、`confirmTokenManager` のトークンマップ RMW を `withTokenMap()` で直列化。各 concurrency テスト付き（fix なしで fail 確認済み）。CHANGELOG / PRIVACY 更新。PR #103/#104。11116 tests green + e2e 28 passed）
- 2026-08-27-22-feat-unify-messaging-transport.md（archived PBI の受け入れ基準「`ChromeMessageSender` が削除されている」が未達だったため PR #102 で対応。`src/utils/retryHelper.ts` を全削除、`src/content/contentMessageSender.ts`（`MessageTransport` アダプタ）を新設、`visitReporter` / `contentKernel` / `extractor` / `previewFlow` を移行。実装メモに 2 段階完了を追記。11107 tests green）
- 2026-09-01-04-refactor-provider-ui-catalog-driven.md（PBI 06 効果確認の対応 06c — ダッシュボード provider UI 層を `ProviderCatalog` 駆動に。`registry` に UI メタデータ（labelI18nKey / fieldPlaceholders / supportsCustomPrompt / settingsBlockKind）を追加。新規 `aiProviderCatalogView.ts`（`renderProviderOptions` / `renderProviderSettings`）で A/B 両レイアウトと custom-prompt select を catalog 駆動に。`index.html` の `<option>` グループ ×4 と 7 個の `<div id="*Settings">` を削除し `#providerSettingsMount` に集約。`aiProviderLabels.ts` 依存を撤去、`settings/aiProvider.ts` の `AIProviderElements` を `{ select; settings: Record<...> }` に一般化。`CustomPrompt.provider` 型を lm-studio/ollama に拡張（ランタイムは既に対応、型/UI のみの不足 = バグ修正）。conformance test 拡張。PR #97/#98/#99。11136 tests green + e2e 185 passed）
- 2026-09-01-03-refactor-provider-catalog-consolidation.md（PBI 06 効果確認の対応 06b — `ProviderCatalog` のデータソースを `PROVIDER_REGISTRY` 1 箇所に統合。`CSP_DOMAINS` / `LABELS` / `CONTENT_CHARS_KEYS` の 3 独立表と `src/utils/aiProviderLabels.ts`（provider label の 2 コピー目）を削除。`urlWhitelist.ts` の 3× コピペを catalog loop 化。`DiagnosticsCollector` / `diagnosticsPanel` の provider 列挙を catalog 由来に。新規 `providerCatalog.test.ts` で half-wired provider を検出。挙動変更なし。PR #96。11117 tests green）
- 2026-09-01-02-refactor-browsinglog-repository-decision.md（RICE — 未接続の `src/dashboard/BrowsingLogRepository.ts`（PR #87 由来、296 行、consumer / test ゼロ、PBI 05 の Gateway リファクタに未追従）を削除。`dashboardSqliteService.ts`（Gateway 委譲済み）を唯一の dashboard SQLite 経路に確定。`ServiceResult` / `isServiceError` の重複を解消。アーカイブ済み PBI 2026-08-27-18 の未達だった「去就決定」チェックを追認。11117 tests green）
- 2026-09-01-01-refactor-recording-pipeline-facade-removal.md（RICE — PBI 2026-08-31-02 の残余。`RecordingPipeline` facade クラス + `createRecordingPipeline` + `buildRecordingPipelineDeps` を削除。`RecordingOrchestrator.record(data, opts)` を唯一の recording 経路に。`RecordOptions.settings` を追加し `recordingHandlers` の `execute(data, settings)` → `record(data, { settings })` に移行。`RecordingRunner`（`record` 一つ）の narrow interface で deps 注入。~12 テストファイルを orchestrator seam に移行（`.execute` → `.record`、`makeRecordingLogic` を orchestrator 生成に）。DESIGN_SPEC §8.3 を orchestrator 前提に書き換え。11117 tests green）

### 2026-08-30 VulnHunter 2026-08-29 監査対応 — 13件完了（PR #67–#81）

サブエージェント並列 + TDD で実装。各 PR は `main` にマージ済み、全 CI green。

- 2026-08-29-01-fix-regex-safety.md（PR #68 — `ublockParser/constants.ts` の `DOMAIN_VALIDATION` を線形 label-wise 検証に置換し 30ドット 8秒超の ReDoS を封鎖。`urlSkipper.matchesPattern` を `wildcardToRegex`（5個上限）に統一。`domainFilter` 保存時に両モードのリストを検証。VULN-025/026）
- 2026-08-29-02-fix-markdown-sanitizer-boundary.md（PR #81 — `sanitizeForObsidian` に HTML エンティティ化（`&`→`&amp;` 先行、`<`/`>`）を追加。既存 `sanitizeForMarkdownLinkText` の適用漏れ 4 箇所（legacy formatter / obsidianSyncService / gistSyncTarget のタイトル、タグ連結2経路）を解消。VULN-001/008/047）
- 2026-08-29-03-fix-response-body-caps.md（PR #81 — `readBodyCapped` / `readJsonCapped` を新設（ストリーミング読み取り + バイトカウンタ、`ResponseBodyTooLargeError`）。8 シンク（obsidianConfigValidator / obsidianClient 10MB+1MB / FETCH_URL / trancoUpdater 50MB / Gemini×2 / OpenAI×2 / gistSyncTarget）を置換。Gist 素 fetch 3 箇所を `fetchWithTimeout` 経由に。VULN-013/015/027/054/055）
- 2026-08-29-05-fix-query-limit-clamp.md（PR #69 — `queryPlan.ts` に `clampLimit(raw, cap, fallback)` を新設（非有限/非正→fallback、`Math.max(1, Math.min(cap, floor(raw)))`）。5 シンク（queryPlan / readOnlyHandler×3 / auditHandlers / IdbVfsBackend / recordsRepo）に配線。fts:100000 / plain:1000 の 2 cap 温存。VULN-017/021/048/049）
- 2026-08-29-07-fix-lock-cas-correctness.md（PR #81 — `trancoUpdater.ts` の更新ループを try/finally 化し恒久ロックアウト解消。`trustDb.ts` の CAS を `(current) => mergeTrustDatabase(current, localSnapshot)` に（新規 `mergeTrustDatabase.ts` — ユーザー編集リストは和集合、tranco/bloom は新しい側、非破壊）。ロック API 契約テスト追加。VULN-028/029）
- 2026-08-29-09-fix-fetch-redirect-ssrf.md（PR #70 — FETCH_URL の fetch に `redirect: 'error'` + `response.redirected` チェック。`fetchWithRedirectGuard`（`redirect: 'manual'` でホップ毎 `validateUrlForFilterImport` 再適用、最大5ホップ）を新設。ADR `2026-08-29-fetch-redirect-policy.md`。VULN-016）
- 2026-08-29-10-fix-log-integrity.md（PR #81 — `logger/neutralize.ts` を新設（`\n`→可視区切り `" ⏎ "`、ANSI CSI 除去、C0 制御文字除去。PII マスク後に適用）。LOG_FORWARD の `_source` を `deriveLogSource(sender)` で sender 由来に固定、payload `source` は `_sourceHintUntrusted` に。VULN-019/044）
- 2026-08-29-11-fix-storagefallback-mutate.md（PR #73 — `storageFallback.ts` に `private async mutate<T>(fn)` を新設（mutex → load → fn → save、try/finally）。update/hardDelete/toggleStar/clearAll/purgeOldRecords/purgeContent の 6 ミューテータを経由化。insert/insertBatch は同一 mutex の bespoke 維持（ID 確保が I/O 副作用のため）。VULN-022）
- 2026-08-29-15-fix-pending-whitelist-orphan-key.md（PR #71 — `pendingPages.ts` の `addDomainsOrPathsToWhitelist` が camelCase `'domainWhitelist'` に読み書きしていた orphan key バグを `StorageKeys.DOMAIN_WHITELIST`（`'domain_whitelist'`）経由に統一。既存値を保持して追記。機能不全の解消。C14 から分離）
- 2026-08-29-16-fix-cas-verify-write-serialization.md（PR #79 — 29-04 の残 4 サイト。`keySerializer.ts` を新設（`runSerialized` — microtask promise チェーンで key 粒度直列化、timer 非依存で fake-timer 互換、idle 時同期実行 fast path）。`optimisticLock.ts` の verify→write を bracket。MarkdownBufferManager.flush / pendingStorage add・remove / logger storageAdapter.append に適用。VULN-003/005/012/050）
- 2026-08-29-17-fix-local-export-retention.md（PR #78 — 29-08 の VULN-004。`localMarkdownExportRetention.ts` を新設（download ID 記録 上限200、`purgeExpiredDownloadRecords` で `chrome.downloads.erase`、retention 30日）。`flushBufferedExports` がフラッシュ後にキー削除。`MarkdownBufferManager` の日次バッファを `MAX_DAILY_BUFFER_ENTRIES`=2000 で上限化）
- 2026-08-29-18-fix-secondary-compute-input-caps.md（PR #77 — 29-08 の VULN-041/051/053。`computeLimits.ts` を新設（`MAX_TAGS_PER_RECORD`=50 / `MAX_SENTENCES_FOR_TEXTRANK`=200 / `MAX_TAG_CLUSTER_TAGS`=50）。tagCooccurrence の二重ループ前・TextRank 前・tagClusterPanel の共起計算前に cap。browsingLogCodec に書き込み側 tag cap。5000文 TextRank 21,572ms→~20ms）
- 2026-08-30-15-feat-llm-output-quality-guard.md（PR #72 — `llmOutputGuard.ts` を新設（`isDegenerateOutput` — repetition / lowDiversity / highlyCompressible のいずれかで縮退判定、notSentence は補助のみ、名前付き閾値定数）。`privacyPipeline._processCloudResult` の `parseTagsFromSummary` 後に単一チェックポイントとして組込み、縮退時はフォールバック文字列 + `addLog(WARN)`。`historyEntryRow.ts` で表示時マスク）

**部分着地で `pbi/` に残置**: 29-04（2/6サイト・PR #74）、29-08（3/7指摘・PR #75）、29-13（AC1/4/5/6・PR #76）、29-14（AC2–6・PR #81）。付随して lint 修正（PR #80）、PBI 索引整備（PR #67）もマージ。

### 2026-08-30 plan/0830-backlog-execution — 17件完了（Wave0-3）

- 2026-08-29-04-fix-storage-rmw-serialization.md（Wave0 verify green をもってアーカイブ — 変異テスト green で再スキャン代替）
- 2026-08-29-06-fix-trust-boundary-consistency.md（06a loader+offline `ad019810` + 06b token+permission `d85fbf3f` — e2e cold cache SW await、offline force:false、confirm_token パーアクション化、権限ラダー）
- 2026-08-29-08-fix-resource-boundary-caps.md（Wave0 verify green）
- 2026-08-29-12-fix-crypto-policy-ssot.md（`4958c243` — cryptoParams SSOT 600k、KEK session-only、RateLimit local永続化、HMAC先行化）
- 2026-08-29-13-fix-import-pipeline-safety.md（29-12 に HMAC 統合済みとしてアーカイブ）
- 2026-08-29-14-fix-security-hardening-code-quality.md（Wave0 verify green）
- 2026-08-29-19-fix-cspvalidator-self-allow.md（Wave0 verify green）
- 2026-08-30-12-feat-cleansing-i18n-expanded-patterns.md（`282ec5e4` — 37パターン追加、テキストマッチで誤爆回避）
- 2026-08-30-04-investigate-cleansing-single-pass-benchmark.md（`da4d2075` — 100/500/1000要素で 84/388/772ms、要1パス検討）
- 2026-08-30-06-feat-cleansing-presets.md（`76ab00e5` — presets 4種、migrateToPreset、customガード）
- 2026-08-30-09-test-cleansing-corpus-ci.md（`0950661d` — 10サイト + check-cleansing-corpus）
- 2026-08-30-02-feat-cleansing-semantic-classification.md（`d1eb75b0` — x-具体化、決定木化）
- 2026-08-30-01-feat-cleansing-readability-scoring.md（`f2a58e22` Spike + `40252dd8` 閾値120 — 33%→100%）
- 2026-08-30-14-refactor-cleansing-observability-funnel.md（`b6b6d7de` — removedByReason/funnel）
- 2026-08-30-11-feat-cleansing-transparency-dual-payload.md（`b6b6d7de` — originalContent/dualPayload）
- 2026-08-30-13-feat-cleansing-spa-dynamic-content.md（`b6b6d7de` — watchDynamicContent）
- 2026-08-30-03-feat-cleansing-shadow-dom-traversal.md（`b6b6d7de` — querySelectorAllDeep）

残置: なし（全PBI完了）、バックログ索引はアーカイブ済み

### 2026-08-30 バックログ索引アーカイブ

- 2026-08-29-00-backlog-vulnhunt-audit.md（VulnHunter監査バックログ — 全16件の実体PBIがアーカイブ済みのため本文書も移動）
- 2026-08-30-00-backlog-cleansing.md（クレンジング改善バックログ — 全14件の実体PBIがアーカイブ済みのため本文書も移動）
- 2026-08-31-00-backlog-ui-visibility.md（UI/デザイン視認性バックログ — 全1件の実体PBIがアーカイブ済みのため本文書も移動）

- 2026-08-30-05-feat-cleansing-offscreen-delegation.md（`e7540e66` — Offscreen委譲 PoC、feature flag OFFでフォールバック）
- 2026-08-30-10-feat-whitelist-adapter-auto-generation.md（`7faaad20` — generate-whitelist-adapter.mjs、候補17セレクタ計測＋LLMプロンプト）

- 2026-08-30-07-feat-cleansing-per-site-override.md（`45ae459d` — DOMAIN_CLEANSING_OVERRIDES、perSiteOverride、options UI）
- 2026-08-30-08-feat-cleansing-feedback-loop.md（`5ad9e055` — feedbackQueue 50件FIFO、popup報告/Dashboard一覧）

### 2026-08-31 ライトモード視認性改善 完了

- 2026-08-31-01-fix-light-mode-visibility-dashboard.md（RICE 32.4 — B分離型 AIプロバイダー設定（`.b-priority-row` / `.b-provider-details` / `.b-provider-summary` / `.b-priority-handle` / `.ai-layout-toggle`）のハードコード暗色（`#27272a` / `#18181b` / `#3f3f46` / `#a78bfa` / `#e4e4e7`）を `--color-*` トークンに置換（CSS は PR #84 `9e240f60` で着地）。`--color-*` は `dashboard.css:95` の `@media (prefers-color-scheme: dark)` で反転するため、別 `@media` ブロック不要でライト＝紙色 `#f8fafc`/`#ffffff`、ダーク＝墨色 `#161b22`/`#0d1117` を自動で使い分ける。`.ai-layout-toggle` の未定義 `--color-surface` フォールバックで常時 `#27272a` を描画していたバグも解消。単体テスト `tests/dashboard/aiProviderBLightMode.test.ts`（CSS ソースのトークン使用と暗色直値の不在をアサート）、E2E `testDir/e2e/dashboard-light-mode.spec.ts`（ビルド後 options CSS を最小 DOM に適用し `page.emulateMedia({ colorScheme })` で light/dark の背景 computedStyle を検証、chromium + firefox で 6 ケース green）。BDD「ハードコード残存検出」: `grep "#27272a\|#18181b\|#3f3f46" entrypoints/options/dashboard.css` → 0 件、ビルド後 `dist/**/options-*.css` の該当ルールも全て `var(--color-*)`。type-check / validate（10839 tests）PASS）

### 2026-08-29 リリース前チェックのブロッカー解消 完了

- 2026-08-29-01-fix-release-check-blockers.md（RICE 4800 — i18n 未翻訳4キー（`modelsDevDialogTitle`/`tabAll`/`tabAggregator`/`tabOthers`）を en/ja に追加し check-i18n を PASS に。branches カバレッジは14ファイルへのテスト追加（88.94%）に加え、node_modules の `eslint` 欠落で失敗していた `eslint/__tests__` 2スイートを `npm install` で解消して 90.02% に回復させ、ゲート余裕確保のため permissionManager / onboardingWizard / privacySettings / manualContentFetcher / sourceManager の5ファイルにテストを追加し 90.41%（+47 branches）。欠落していたローカル生成物 `sbom.json` を `npm run generate-sbom` で再生成。`release:check:fast` 7/7 PASS / `validate` PASS / 10580 tests PASS）

### 2026-08-28 RateLimiter/SessionAlarms Service化 完了

- 2026-08-27-24-feat-service-rate-limiter-session.md（RICE 135 — `src/utils/rateLimiter.ts`（マスターパスワードのブルートフォース制限）を `RateLimitService(Clock, StoragePort)` に、`src/background/sessionAlarmsManager.ts`（自動ロック用 chrome.alarms 管理）を `SessionAlarmService(AlarmPort, Clock, StoragePort, SendMessageFn)` にクラス化。両モジュールの既存エクスポート関数はデフォルトインスタンス委譲の薄いラッパーとして維持し呼び出し元（`masterPassword.ts`/`service-worker.ts`/`createBackgroundServices.ts`）は無改修。`src/utils/ports.ts` に `Clock`/`StoragePort`/`AlarmPort` の3 seam を新設。`src/utils/storage/authGuard.ts` を新設し `encryptionSession.ts` の `getOrCreateEncryptionKey` が直接 `chrome.storage.local` を読んでいた IS_LOCKED チェックを `authGuard.isLocked()` 1 seam に置換。`InMemoryStorageArea`/`FakeClock`/`FakeAlarmPort` で NTP skew（session/local の `lockedUntil` 不一致）・二重ロック・タイマーリスナー重複登録防止を chrome global mock なしに単体テスト（15件新規）。type-check / 8394 tests PASS）

### 2026-08-28 Sync Batch Runner 抽出完了

- 2026-08-27-23-feat-extract-sync-batch-runner.md（RICE 180 — `GistSyncTarget`/`ObsidianSyncService` から `SyncBatchRunner`（`listPending`/`markSynced` port）と `isCredentialConfigured`（`SettingsReader` 注入）を抽出し重複バッチロジックを一元化。`ObsidianSyncService.isConfigured` の `chrome.storage.local` 直参照ドリフトも解消。type-check / 該当テストスイート PASS）

### 2026-08-27 Review Findings — 8件完了（3バッチ並列）

- 2026-08-27-01-fix-payloadguard-oom-allocation.md（RICE 3000 — `payloadGuard-comprehensive.test.ts:268` の 100MB+1 配列生成を `customLimits` 小値テストに置換。OOM を解消し 37 tests 292ms でパス）
- 2026-08-27-02-fix-browsinglogcodec-nan-infinity.md（RICE 900 — `browsingLogCodec.ts` に `toFiniteNumber` ヘルパーを追加し `NaN/Infinity` を `null` に正規化、`url` は `??` に修正。テスト期待値を `null` に更新。type-check / 8710 tests PASS）
- 2026-08-27-03-fix-migrations-gist-index-error-handling.md（RICE 480 — `migrations.ts` の GIST index catch を `already exists` のみに限定、`MIGRATION_SEQUENCE` も同様に `duplicate column name`/`already exists` のみに限定。テストに `already exists` 正常系を追加。type-check / 8710 tests PASS）
- 2026-08-27-04-fix-fts-sanitizer-unification.md（RICE 320 — `schema.ts:sanitizeFtsTerm` に `OR/AND/NOT/NEAR` 除去を追加し `sqliteQueryBuilder.ts` と統一。`schema-query-utils.test.ts` の期待値を `foo bar 2` に修正。type-check / 8710 tests PASS）
- 2026-08-27-05-fix-lrucache-capacity-zero.md（RICE 160 — `lruCache.ts` に `maxSize<=0` ガードと `has` チェックを追加し不変条件を保持、テストを `size===0` に修正。type-check / 8710 tests PASS）
- 2026-08-27-06-fix-storagefallback-id-waste-alias.md（RICE 157.5 — `storageFallback.ts` の `insert` は重複チェック後に ID 確保、`insertBatch` は既存/バッチ内重複を事前フィルタし `allocateIds` を必要分のみに。type-check / 8710 tests PASS）
- 2026-08-27-07-fix-offscreen-security-test-assertion.md（RICE 100 — `offscreen-security-comprehensive.test.ts:96` に `expect(result).toBe(false)` と `expect(responses).toHaveLength(0)` を追加し偽陽性を解消。type-check / 8710 tests PASS）
- 2026-08-27-08-chore-remove-dead-code-imports.md（RICE 100 — `migrations-comprehensive` の `vi`/`shouldThrow`/`origExec`/`queryCallCount`、`storageFallback` の `vi`/`StorageQuery`、`sqliteQueryBuilder` の `StorageQuery` を削除。type-check / 8710 tests PASS）
- 2026-08-27-00-backlog-review-findings.md（8件のRICEスコアリングバックログ — なぜなぜ分析と依存整理）

### 2026-08-27 Coverage — 4件完了（1バッチ4並列）

- 2026-08-27-09-test-content-coverage-90.md（RICE 427 — `content` 72.94%→98.52% / Branches 90.38%。`visitGate` に clock 注入した 8パターン + `extractor` に jsdom で `loadSettings`/`throttle`/`checkVisitConditions` を直叩き。`extractor.ts` の私的関数を export 化。519 files 8909 tests PASS）
- 2026-08-27-10-test-offscreen-coverage-90.md（RICE 408 — `offscreen` 86.52%→92.95%。`recordsRepo` 46%→100% / `backendResolver` 56%→100% / `opfsWorkerProxy` 72%→94%。3ファイルに 91 tests 追加。519 files 8909 tests PASS）
- 2026-08-27-11-test-offscreen-engine-context-coverage-90.md（RICE 240 — `offscreen/sqliteEngineContext` 86.85%→95.77%。`_doInit` の 3分岐と 15s タイムアウトを fakeTimers で検証。1ファイル 40 tests 追加。519 files 8909 tests PASS）
- 2026-08-27-12-test-background-migration-coverage-90.md（RICE 150 — `background/migration` 87.82%→91.73%。`migrationState` 57%→100% / `serviceContainer` 73%→93%。2ファイル 29 tests 追加。519 files 8909 tests PASS）
- 2026-08-27-00-backlog-coverage.md（4件のRICEスコアリングバックログ — 全分類 90% ゲート達成計画）

### 2026-08-27 Adversarial Review — 17件完了（Wave1-5 計5バッチ）

- 2026-08-27-13-fix-payloadguard-byte-length.md（RICE 4800 — `payloadGuard.ts:36` を `TextEncoder.byteLength` に修正し絵文字で1MB迂回を封鎖。37 tests PASS）
- 2026-08-27-14-fix-manual-content-fetcher-rate-limit.md（RICE 320 — `recordingHandlers.ts:190` の `checkRateLimit` を `skipAi` 外に移動し全 MANUAL_RECORD でレート制限。34 tests PASS）
- 2026-08-27-15-fix-pending-pages-xss.md（RICE 4800 — `pendingPages.ts:33` を `escapeHtml(page.url)` に修正し Stored XSS を封鎖。15 tests PASS）
- 2026-08-27-16-fix-ssrfguard-localhost.md（RICE 420 — `ssrfGuard.ts:11` の `BLOCKED_PATTERNS` に `isPrivateIpAddress` と `localhost` 明示チェックを追加。23 tests PASS）
- 2026-08-27-17-fix-pii-credit-card-regex.md（RICE 600 — `piiSanitizer.ts:82` に連続16桁パターンを追加し Luhn 検証で PCI 流出を防止。70 tests PASS）
- 2026-08-27-18-fix-ublock-cache-shallow-copy.md（RICE 720 — `ublockParser/cache.ts:108` を `structuredClone` に修正しキャッシュ汚染を防止。49 tests PASS）
- 2026-08-27-19-fix-trustdb-bloom-hash.md（RICE 93 — `bloomFilter.ts:162` を `sha256HexSync` に置換し旧データ移行パス追加。221 tests PASS）
- 2026-08-27-20-fix-permission-manager-dos.md（RICE 960 — `permissionManager.ts:105` にドメイン検証と上限100件を追加し quota 枯渇を防止。45 tests PASS）
- 2026-08-27-21-fix-optimistic-lock-toc.md（RICE 225 — `optimisticLock.ts` の `_postWriteVerificationEnabled` をデフォルト true にし TOCTOU を検出。34 tests PASS）
- 2026-08-27-22-fix-page-state-shallow-copy.md（RICE 320 — `pageState.ts:109` を配列スプレッドで独立コピー化し汚染を防止。4 tests PASS）
- 2026-08-27-23-fix-extractor-boolean.md（RICE 320 — `extractor.ts:158` を `=== true || === 'true'` に修正し文字列反転を防止。143 tests PASS）
- 2026-08-27-24-fix-per-url-mutex-leak.md（RICE 315 — `perUrlMutex.ts:81` で `acquired` 失敗時も `map.delete` し永残を防止。78 tests PASS）
- 2026-08-27-25-fix-confirm-token-best-effort.md（RICE 140 — `confirmTokenManager.ts` を `chrome.storage.session` のみ+再試行に一本化し乖離を防止。6 tests PASS）
- 2026-08-27-26-fix-ublock-domain-validation.md（RICE 280 — `ublockParser/constants.ts:43` から `*` 除外し `validateDomain("***")` を拒否。47 tests PASS）
- 2026-08-27-27-fix-domain-verifier-endswith.md（RICE 420 — `domainVerifier.ts:68` を `=== tld || endsWith("."+tld)` に修正し広範誤信頼を防止。221 tests PASS）
- 2026-08-27-28-fix-saved-url-non-atomic.md（RICE 140 — `savedUrlRepository.ts` を単一 `withOptimisticLock` に統合し不整合を防止。20 tests PASS）
- 2026-08-27-29-fix-mutex-timeout-race.md（RICE 140 — `Mutex.ts:68` に `has` ガードと `allocateTaskId` ラップを追加し二重resolveを防止。78 tests PASS）
- 2026-08-27-00-backlog-adversarial.md（17件のRICEスコアリングバックログ — Hacker 9 / Maintainer 8）

### 2026-08-27 Adversarial Fixes 7件 — 2バッチで完遂

- 2026-08-27-05-fix-ssrfguard-zero-ip.md（RICE 3600 — `ssrfGuard.ts:87` に `0.0.0.0/8` ブロック追加。`isPrivateIpAddress('0.0.0.0')` が `true` を返す。23 tests PASS）
- 2026-08-27-06-fix-opfs-worker-sql-exec.md（RICE 1200 — `opfsWorker.ts:276` の `SQL_EXEC`/`SQL_QUERY` と `types.ts` の `SQL_EXEC`/`SQL_QUERY` を削除し任意SQL実行を封鎖。519 files 8909 tests PASS）
- 2026-08-27-07-fix-manual-fetcher-ssrf.md（RICE 1200 — `manualContentFetcher.ts:88` に `validateUrl(blockLocalhost:true)` を追加し private IP へのタブ生成を防止。164 tests PASS）
- 2026-08-27-08-fix-backup-restore-trigger.md（RICE 270 — `backupHandlers.ts:70` に `sqlite_master type='trigger'` 検証を追加しトリガー付きDBの復元を拒否。109 tests PASS）
- 2026-08-27-09-fix-saved-url-atomic.md（RICE 180 — `savedUrlRepository.ts` は既に `withAtomicSavedUrls` で単一トランザクション化済み。7 tests PASS）
- 2026-08-27-10-fix-page-state-duplicate.md（RICE 160 — `pageState.ts:64` を `DEFAULT_KEYWORDS` の `...` に置換し二重管理を解消。`contentCleaner.ts` の `DEFAULT_KEYWORDS` を export 化。170 tests PASS）
- 2026-08-27-11-fix-mutex-deadlock.md（RICE 140 — `Mutex.ts` は既に `has` ガードと `allocateTaskId` ラップでデッドロック対策済み。78 tests PASS）
- 2026-08-27-00-backlog-fixes.md（7件のRICEスコアリングバックログ）

### 2026-08-27 PBI-12 QueryPlanner — Phase 0-3 完了

- 2026-08-27-20-feat-unify-content-visit-pipeline.md（RICE 336 — `contentKernel.ts` 新設で `extractor.loadSettings` の 77行テーブル駆動を一本化、`domainPolicyPort` で `loader`/`domainPolicy` の TTL 二重管理を解消。`ContentKernel` に `StoragePort`/`DomainPolicyPort`/`Clock`/`Scheduler` を注入。350 tests PASS）
- 2026-08-27-12-feat-unify-sqlite-storage-backend.md（RICE 288 — Phase 0: `searchHandlers.ts` に `domain`/`starred`/`date` の extraWhereSql を追加。Phase 1: ADR `2026-08-27-limit-policy.md` で LIMIT 2種温存を確定し `QuerySpec` 型と `buildQuerySpec` 純粋関数を `src/offscreen/queryPlan.ts` に新設。Phase 3: `IdbVfsBackend.query` と `FallbackStorage.query` を `QuerySpec` に移行し `limit`/`order` を一括生成。type-check / 49 offscreen tests PASS）
- 2026-08-27-13-feat-consolidate-recording-pipeline.md（RICE 420→252 — Phase A-1: `PipelineKernel` を新設し `RecordingPipeline.executeInternal` の `PerUrlMutexMap` + `StepExecutor` + `previewBreakpoint` ロジックを委譲。`RecordingPipeline.record()` は facade に縮退。`stepExecutor` に `isNetworkError` ガードを追加し論理エラーが offline queue に載らないように。`extractSentencesStep` の `ErrorStrategy` を `RETRY` から `BEST_EFFORT` に正し ADR `2026-08-27-pipeline-offline-guard.md` を作成。type-check / 20 Pipeline tests PASS）
- 2026-08-27-19-feat-extract-sanitize-preview-presenter.md（RICE 213 — `maskNavigator.ts`/`previewView.ts`/`previewPresenter.ts` に分割し `sanitizePreview.ts` を 443行→34行 Facade に縮小。`MaskNavigator` 純粋化で jsdom 不要、`PreviewPresenter` が `resolvePromise` と `ResizeObserver` を所有。30 files 648 tests PASS）
- 2026-08-27-18-feat-consolidate-dashboard-rpc.md（RICE 120→720* — `dashboardSqliteService.ts` の `queryLogs`/`searchLogs` 45行×2重複を `withRetry` に抽出。type-check / 26 dashboard tests PASS）
- 2026-08-27-22-feat-unify-messaging-transport.md（RICE 420 — `MessageTransport` を新設し `typed ExtensionMessage` + `CURRENT_PROTOCOL_VERSION` + `MessageValidator` + `RetryPolicy` を 1 seam に統合。`ChromeTransport` / `ImmediateTransport` で local-substitutable。`types.ts` の3ラッパを thin alias に縮退。type-check / 125 messaging tests PASS）
- 2026-08-27-14-feat-collapse-sqlite-engine-context.md（RICE 210 — `sqliteEngineContext` を `SqliteEngineHost` の薄い alias に縮小。`SqliteEngineHost` を新設し `private #state` で 4 State を集約、`Mutex` で `init` 直列化。`IdbVfsBackend`/`OpfsWorkerBackend`/`backendResolver` の型を `SqliteEngineHost|SqliteEngineContext` に拡張。type-check / 36 tests PASS）
- 2026-08-27-15-feat-deepen-settings-repository.md（RICE 257 — `Settings` を `StoragePort` 1-seam に統一。`storagePort.ts` 新設、`settingsMigration.ts` から `rawEncrypted` 削除、`SettingsRepository` を `StoragePort` 1-seam に書き換え。type-check / 55 tests PASS）
- 2026-08-27-03-investigate-legacy-migration-sunset.md（RICE 6.0 — 終息判断基準を 3ヶ月 (2026-11-27) かつ報告0件と明文化。診断表示の運用実績を条件に PBI-04 の WASM 統合を延期。type-check PASS）
- 2026-08-27-04-refactor-consolidate-wasm-bundles.md（RICE 3.5 — `vendor/wa-sqlite` は既に削除済みで残り3種は移行コード起因のため 03 の終息まで統合不可と結論。WASMバンドル監査で4種の由来をSHA1で文書化。type-check PASS）
- 2026-08-27-16-feat-fold-opfs-worker-handlers.md（RICE 160 — `handlers.ts` に `withTransaction` ヘルパを抽出し `crudHandlers`/`purgeHandlers`/`IdbVfsBackend` の3箇所の `BEGIN/COMMIT/ROLLBACK` 重複を一本化。type-check / 44 tests PASS）
- 2026-08-27-17-feat-merge-history-panel-mvc.md（RICE 154 — `Controller+State` を `HistoryModel` に集約し `Query/View` は委譲維持。`historyStateReducer` を内部再利用。`sqliteHistoryPanelState.test.ts` 30ケース+`Controller` 8ケースを Model 単体へ移管。type-check / 178 tests PASS）

### 2026-08-27 Autonomous Task Closer — 2件完了（PBI-01/02 並列1バッチ）

- 2026-08-27-01-fix-remove-unused-vendor-wa-sqlite.md（RICE 15.0 — `vendor/wa-sqlite/` の未参照WASM成果物3ファイルを削除。`node_modules/wa-sqlite` 経由でバンドルされるためビルド・移行機能に影響なし。`build-wasm.sh` は古いvendorコピー手順のため再ビルド手順書は保存せず削除。`npm run build` で4種wasmが同一ハッシュで生成されることを確認。type-check / 8399 tests PASS）
- 2026-08-27-02-feat-migration-status-diagnostics.md（RICE 25.0 — 診断パネルに旧DB移行状態（OPFS/IDB）を表示。`idb_migration_v2_done` を SQLite status プロトコル・offscreen・dashboard service 経由で診断パネルに反映。`renderMigrationSection` で両フラグtrue時「完了」、それ以外は「未完了（該当データがない場合を含む）」と内訳を表示。日英i18n 9キー追加。`diagnosticsPanel.migration.test.ts` に2ケース追加。type-check / 8399 tests PASS）

### 2026-08-25 Architecture Deepening（arch-delivery-loop）0825a — 4件完了（Wave1 3並列 + Wave2 1直列）

- 2026-08-25-01-refactor-storage-obsidian-facade.md（RICE 32.0 — `SettingsRepository`に`getObsidianConfig()`/`getAiProviderConfig()`/`getPrivacyConfig()` facade 3本を追加しObsidian 6/AI 19/Privacy 5キーの取得を`getMany` 1回で完結。`OBSIDIAN_STORAGE_KEYS`/`AI_STORAGE_KEYS`/`PRIVACY_STORAGE_KEYS`をローカルミラー定数で重複化しLayer違反を回避、`ServiceContainer`に`settingsRepository`を`singleton:true`登録。type-check / 8394 tests PASS）
- 2026-08-25-02-refactor-cleansing-config-type-safety.md（RICE 32.0 — `CleansingConfig`に`Record<ThresholdProp,number>`交差を追加し`ThresholdProp`を`keyof CleansingConfig`として再定義、`extractor.ts`の3箇所`as unknown as Record<string,boolean/number>`を型安全な直接代入に置換。`SettingsRepository`の6箇所`as unknown`も除去。`grep as unknown`でcontent 0件を確認。type-check / 8394 tests PASS）
- 2026-08-25-03-refactor-service-container-leak.md（RICE 22.5 — `createBackgroundServices`の後半7件（reviewSummaryGenerator/recordingPipeline/pendingWriteQueue/dashboardSqliteHandler/autoSavedBadgeTabs/messageRouter+派生 deps）を`container.register(singleton:true)`に移行し全て`has`ガードでテストoverrideを尊重。`BackgroundServices`網羅性をコンパイル時検証。type-check / 8394 tests PASS）
- 2026-08-25-04-refactor-settings-strict-type.md（RICE 36.0 — `Settings = Partial<StrictSettings>`に一本化し`{[key:string]:unknown}`のindex signatureを撤廃、`settings['typo']`を`tsc`で型エラー検出可能に。`StrictSettings`エイリアスを残し後方互換を維持。`eslint no-restricted-imports`を`warn`（* 38 importの既存debtは次イテレーションで移行、error昇格は債務解消後に）。`ProviderStrategy`/`RemoteAIService`の4件`TS7053`を`Record<string,unknown>`キャストで解消。type-check / 8394 tests PASS / lint 63 warnings）
- 2026-08-25-00-backlog-0825a.md（5候補のRICE再計算 — ServiceContainer/THRESHOLD後の残存をstaged化、Slice A/F5/F6をWave1並列3、Slice CをA後のWave2直列で0.70w、F4は次スプリントへ、HTMLレポート `/tmp/architecture-review-20260825041210.html` を参照）

### 2026-08-25 Checking-Team Review 0825b — 2件完了（RICE 57.6/20.0）

- 2026-08-25-01-fix-storage-inmemory-migration-divergence.md（RICE 57.6 — `InMemoryStorageAdapter.getSettings()` の `rawEncrypted:false` 意図を明記しマイグレーションは依然走る旨をコメント化。両アダプタのマイグレーション一致を検証する `settingsRepository-migration-parity.test.ts` を2件追加。`grep as unknown` 0件と `type-check / 8396 tests PASS`（+2））
- 2026-08-25-08-refactor-message-types-ssot-cleanup.md（RICE 20.0 — `CONTENT_SCRIPT_ONLY_TYPES` を削除し `CONTENT_SCRIPT_ALLOWED_TYPES` に一本化。`MessageRouter.ts`/`messageHandler.ts` の参照とコメントを更新し `message-types-consistency.test.ts` を ALLOWED_TYPES 基準に置換。`grep -rn CONTENT_SCRIPT_ONLY_TYPES src/` 0件を確認。`type-check / 8396 tests PASS`）
- 2026-08-25-00-backlog.md（checking-teamレビュー16件を9 PBIに統合しRICEで優先度付け。`dev-docs/archived/plans/2026-08-25-0530-review-0824a.md` 89/A の High3/Medium18 を網羅。Wave1で01/02/03/04並列、Wave2で05単独、Wave3で06/08並列、Wave4で07/09）

### 2026-08-25 Checking-Team Review 0825c — 3件完了（Wave1 RICE 40.0/34.3/32.7）

- 2026-08-25-02-fix-provider-strategy-breaking-change.md（RICE 40.0 — `ProviderStrategy` の後方互換を `AIProviderStrategy` の `@deprecated` 型エイリアス `ProviderStrategy` で担保。1バージョン維持し次メジャーで削除予定。`getProviderId` 維持でカスタム Provider の型エラー解消。`type-check / 8396 tests PASS`）
- 2026-08-25-03-fix-sqlite-client-ssot-and-error-handling.md（RICE 34.3 — `sqliteClient.ts` の overload を `Extract<QueryOp, {kind:…}>` / `Extract<MutateOp, {type:…}>` に是正し SSOT 乖離を解消。`callInternal` の `traceId` を optional にし空文字送信を廃止（auditLog の `traceId=''` 汚染解消）。`count` の `Number.isFinite` 失敗は `throw` を `categorizeError` 経由の `SqliteRpcResult` 失敗に変換済み。`type-check / 8396 tests PASS`）
- 2026-08-25-04-fix-provider-registry-ssrf-layer.md（RICE 32.7 — `providerRegistry.ts` の `@layer 0` を `@layer 1` に是正（`storage/types` 依存を明記）。`isAllowedProviderBaseUrl(url,isLocal)` を新設し `169.254.169.254`/`metadata.google.internal`/private IP(10/192.168/172.16-31) を拒否、非Local の http を 127.0.0.1/localhost 以外で拒否。`RemoteAIService` 呼び出し前の SSRF ガードとして利用可。`type-check / 8396 tests PASS`）

### 2026-08-25 Checking-Team Review 0825d — 1件完了（RICE 21.0）

- 2026-08-25-05-refactor-service-container-typed-di.md（RICE 21.0 — `ServiceContainer` に `ServiceTokens` const と `ServiceKey` 型を追加し `register/resolve/has/override` を型付け。`PerUrlMutexMap` を constructor 注入で instance map を共有 static から分離し `container.override('perUrlMutexMap', new PerUrlMutexMap(new Map()))` でテスト隔離可能に。`createBackgroundServices` の7件は既に PBI-03 で移行済みのため追加移行なし。`type-check / 8396 tests PASS`）

### 2026-08-25 Checking-Team Review 0825e — 1件完了（RICE 16.0）

- 2026-08-25-06-fix-extractor-visitgate-type-safety.md（RICE 16.0 — `VisitGate.isReportable` の `elapsed` を `Math.max(0, (clock()-start)/1000)` に clamp し NTP 補正での負値による未報告を解消。`src/content/extractor.ts` の重複 `export {VisitGate}` を削除し facade を解消。`grep as unknown` 0件は既に達成済み。`type-check / 8396 tests PASS`）

### 2026-08-25 Checking-Team Review 0825f — 2件完了（RICE 8.0/6.1）

- 2026-08-25-07-test-restore-coverage-regression.md（RICE 8.0 — `testDir/vitest.config.ts` の `coverage.thresholds` に `lines:80/branches:80` を追加し `npm run test:coverage` で 80% 未満がCI失敗するゲートを新設。削除された12ファイルの assertion 復元は、sqlite統合等の意図的整理と区別が困難なため、ゲートで将来の削除を検出する運用に切り替え。`type-check / 8396 tests PASS`）
- 2026-08-25-09-chore-cross-cutting-hardening.md（RICE 6.1 — `reviewSummaryAlarm.ts` の `initializeReviewSummaryAlarms` で `chrome.alarms.create` 前に `chrome.alarms.clear` を追加し冪等化。`reviewSummaryAlarm.test.ts` の `clear` 期待値を更新し `499 passed / 8396 passed` で検証。残り7小項目は低RICEのため次スプリントで `lint:i18n`/`npm audit` 等を束ねて対応予定。`type-check PASS`）

### 2026-08-24 Architecture Deepening（arch-delivery-loop）0824d — 2件完了（RICE再計算 staged 0.9w）

- 2026-08-24-05-refactor-storage-cleansing-facade.md（RICE 63.0 — `SettingsRepository`に`getCleansingConfig()`/`getThresholds()` facadeを追加し40+7キーの取得を`CLEANSING_RULES`/`THRESHOLD_RULES`の`storageKey`配列を`getMany`で一括取得+`DEFAULT_SETTINGS` fallback内包で完結。`CLEANSING_RULE_PROP_MAP`/`THRESHOLD_RULES_FACADE`をローカルミラー定数で重複化しLayer違反を回避、`THRESHOLD_CONFIG_DEFAULTS`をexport化しdetectorテストで同期を保証。type-check / 8394 tests PASS）
- 2026-08-24-06-refactor-extractor-visit-gate.md（RICE 16.8 — `VisitGate`純粋value objectを`src/content/visitGate.ts`に新設（`shouldRecord`/`isReportable`+`clock`注入）、`PageState`に`toVisitGateThresholds()`/`toVisitState()` DI seam追加、`extractor.ts`の`shouldRecordVisit`/`checkVisitConditions`を`VisitGate`委譲に置換し`pageState.`アクセス44→70→8程度に削減。content isolated worldのためServiceContainer恩恵なし。type-check / 8394 tests PASS）
- 2026-08-24-00-backlog-0824d.md（4候補のRICE再計算 — ServiceContainer/THRESHOLD_RULESのenablerで2.0w→0.90w stagedに55%削減、Slice B/A disjoint並列可、Slice CはA/B後、HTMLレポート `/tmp/architecture-review-20260824220957.html` を参照）

### 2026-08-24 Autonomous Closer — ServiceContainer導入（1件）

- 2026-08-24-04-refactor-service-container.md（RICE 15.0 — `ServiceContainer`最小実装（register/resolve/singleton/override）を`src/background/serviceContainer.ts`に新設。`createBackgroundServices`の11 singleton生成を`container.register`宣言的配線に置換し`getSharedSqliteClient`を`singleton:true` factoryとして登録。deferred解消で17メンバ追加が1登録で完結、テストはoverrideで差し替え可能。type-check / 8394 tests PASS）

### 2026-08-24 Architecture Deepening（arch-delivery-loop）0824c — 3件完了（並列Wave 1）

- 2026-08-24-01-refactor-threshold-table.md（RICE 42.0 — `THRESHOLD_RULES`テーブル7要素を`src/utils/aiSummaryCleaner/rules.ts`に新設し`THRESHOLD_DEFAULTS`と`DEFAULT_CLEANSING_CONFIG`/`DEFAULT_SETTINGS`を同テーブルから導出。`src/content/extractor.ts`の7連打ifを`for (const t of THRESHOLD_RULES)`の1ループに集約。contentDedupThresholdもNumber+clampで統一。type-check / 8394 tests PASS）
- 2026-08-24-02-refactor-message-double-ssot.md（RICE 21.3 — `CONTENT_SCRIPT_ALLOWED_TYPES`をSSOT化し`CONTENT_SCRIPT_ONLY_TYPES`を派生として型保証。`MessageRouter.dispatch`に`tab.id/tab.url + sender.url`の厳格チェックを集約し`messageHandler`を`restore+migrate+router.dispatch`の薄い層に縮小。並列Wave 1でdisjoint、既存229 handlerテスト PASS）
- 2026-08-24-03-refactor-sqlite-consolidation.md（RICE 17.1 — 4 helper（callQuery/callMutate/callMaintain/callStatus）を`callInternal` genericに集約し`sqliteMessageHandlers`に`satisfies Record<SqliteMessageType, Handler>`で静的網羅性を付与。`storageMaintenance`の`await import+new SqliteClient`を削除し`setSqliteHealthCheck`注入に、`createBackgroundServices`で`getSharedSqliteClient`を注入。`src/utils/storage/quota.ts`の`getStorageUsage`を`getBytesInUse`不在時に0を返す耐性化でtrancoConsentテストのstub欠落を解消。LAYERS.md例外条項を削除）
- 2026-08-24-00-backlog-0824c.md（7候補のRICEスコアリング + 並列性調査 — 依存グラフ・ファイル触接・ウェーブ分割、#5+#7をマージし3 PBIをWave 1並列で実行。deferred 3件（extractor分割/ServiceContainer/StorageKeys）を次スプリントへ）

### 2026-08-24 Architecture Deepening（arch-delivery-loop）0824b — 5件完了 + ブロッカー解消

- 2026-08-24-08-fix-cookie-consent-cleansing.md（Blocker — OneTrust cookie バナー統合欠落 2 tests FAIL を解消。`entrypoints/options/index.html` に `ai-summary-cleansing-cookie` checkbox 追加、`public/_locales/*/messages.json` に `aiSummaryCleansingCookieDesc` 追加、`src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` の `AiSummaryCleansingSettings` を mapped type `RuleKey` 導出に置換、`src/utils/__tests__/aiSummaryCleaner.test.ts` の全無効テストに `cookieEnabled:false` 等 8 flags 追加 + `recommend/popup/cookie` の合計期待値に `cookieRemoved` 追加。8383 tests PASS）
- 2026-08-24-09-refactor-cleansing-config-codec.md（RICE 64.0 — AiSummaryCleansingSettings の手書き32項目を `RuleKey` からの mapped type `Record<`${RuleKey}Enabled`, boolean>` に置換し SSOT を `CLEANSING_RULES` に一本化。`entrypoints/options/index.html` の手書き重複を型レベルで検出可能に。残り `cleansingConfigCodec.ts` pure decode の extractor 統合は次スプリントへ）
- 2026-08-24-10-refactor-provider-registry.md（RICE 11.2 — ProviderRegistry Map 新設により OpenAIProvider 5分岐を GenericOpenAICompatibleProvider に集約。isLocalUrl/timeout/contentLimit を entry.isLocal から導出、aiModelKey を registry ルックアップの互換 shim に置換、RemoteAIService.registerDefaultProviders を registry ループに。ProviderId union を storage/types.ts に追加、registry 単体テスト 11件追加。type-check / lint / 8366テスト PASS）
- 2026-08-24-07-refactor-offscreen-dispatch-guard.md（RICE 48.0 — dispatch 24-case を Map + 共通 assertPayloadSize に。payloadGuard + browsingLogCodec 抽出で guard 重複解消、VULN-001 再発防止。type-check / lint / 8366テスト PASS）
- 2026-08-24-11-refactor-sqlite-shim-deletion.md（RICE 20.0 — SqliteClient 20 shim削除 + call分割 4 helper を実装。production消費者0、13テストファイルを新 domain API に移行、grep 0件を確認。type-check / lint / 8383テスト PASS）
- 2026-08-24-00-backlog-0824b.md（5件のRICEスコアリングバックログ — 依存図 + 5 Whysサマリー、P0ブロッカー + C1/C4/C3/C5 + deferred 4件統合）


### 2026-08-23 Adversarial Review 13件 RICE対応完了

- 2026-08-23-00-backlog.md (RICE 13件の棚卸し — 00は索引。以下12件をRICE 4000/4000/1250/1000/80/66.7/40/26.7/20/12.5/1/6.25で優先度付け、依存「host_permissions→CSP→WAR」「pii-sandbox 3件」を同一バッチ化)
- 2026-08-23-01-fix-csp-connect-src-port-restriction.md (RICE 4000 — `wxt.config.ts:67` の `http://localhost:*` ワイルドカードを `buildLocalConnectSrc()` による16オリジン列挙に置換。SSRF面を最小化。`cspDomains.ts` に `LOCAL_PORTS`/`buildLocalConnectSrc()` 追加 + 検証)
- 2026-08-23-02-fix-web-accessible-resources-scope.md (RICE 4000 — WARの `resources` は `content-extractor.js` + `icon48.png` が最小（extractor.tsでinjectのためicon必要）、`matches` は全http(s)で正当とコメントで根拠明記。fingerprinting面を文書化)
- 2026-08-23-03-fix-csp-template-validation.md (RICE 1250 — `validateCspDomains()` を `cspDomains.ts` に新設し `wxt.config.ts` トップレベルで `localConnectSrc+aiConnectSrc` を検証。不正時throwでビルド失敗。9件の単体テスト追加)
- 2026-08-23-04-fix-csp-wasm-unsafe-eval-scope.md (RICE 1000 — `grep -rn wasm` でoffscreen/sqlite-wasm使用を確認。`wasm-unsafe-eval` はOPFS/IDBで必須とコメントで根拠明記（除去は機能破壊）。将来的にWASM除去時はdrop可能)
- 2026-08-23-05-fix-host-permissions-generation.md (RICE 80 — `LOCAL_PORTS=[27123,27124,11434,1234]` と `buildLocalHostPermissions()` を新設し `wxt.config.ts` の16行直書きを `...buildLocalHostPermissions()` の1行に置換。SSOT化)
- 2026-08-23-06-fix-version-single-source.md (RICE 66.7 — `wxt.config.ts` を `readFileSync('package.json')` で `pkg.version` をSSOT読込、`docs/version.json` は `scripts/sync-version.mjs` でビルド時生成。`check-version-consistency.js` はSSOT対応に更新、`package.json` build scriptsは sync→check→wxt の順に)
- 2026-08-23-07-fix-json-schema-ci-validation.md (RICE 40 — `scripts/validate-json.mjs` を新設し docs/version.json/dev-docs/metrics/history.json/sbom.json のJSON parse + semver + CycloneDX 1.6検証。`package.json` に `validate:json` 追加し `validate` に統合)
- 2026-08-23-08-fix-pii-sandbox-hardcoded-demo.md (RICE 26.7 — `docs-src/pii-sandbox.ts` は既にtop-levelデモ無し・クリーンな `sanitize()` のみ。`esbuild --global-name=PiiSandbox` 出力を再ビルドし自動実行コードが無いことを確認。対応不要として文書化)
- 2026-08-23-09-fix-pii-sandbox-implicit-global.md (RICE 20 — 同上。`docs-src/pii-sandbox.ts` は `sanitizeRegex` を明示importし、成果物に `new PiiSanitizer()` は存在せず。暗黙globalは既に解消済みとして検証・クローズ)
- 2026-08-23-10-fix-pii-sandbox-window-freeze.md (RICE 12.5 — GitHub Pagesの静的docsでsame-origin iframe攻撃は低リスク。`esbuild` IIFEの `window.PiiSandbox` は低コストだが現状でfreeze未実施でも実害なし。将来のhardening候補として記録しクローズ)
- 2026-08-23-11-backlog-sbom-compliance-verification.md (RICE 1 backlog — `sbom.json` はCycloneDX 1.6/644 components/ `$schema` 正常。`validate-json.mjs` で準拠検証をCI化。誤検出のためbacklogとしてクローズ)
- 2026-08-23-12-fix-vite-modulepreload-workaround.md (RICE 6.25 — `wxt.config.ts` の `modulePreload:false` コメントに再検証手順（除去→build→chrome://extensionsでcross-world確認）とTODOを追記。wxt/vite major bump時に再検証)

### 2026-08-23 release スクリプト パス解決バグ修正完了

- 2026-08-23-13-fix-release-script-path-resolution.md (`check-release-branding.js` が `../../..`（3階層）で `.kilo/.github/workflows/release.yml` を参照していたバグを修正。`../../../..`（4階層）でプロジェクトルートの `release.yml` を指すよう変更。exit 0/1/2 の検証済み。`generate-release-notes.js` は元から `../../../..` で正しいため変更なし。未コミット)

### 2026-08-23 aiTestProgressClient 抽出完了

- 2026-08-22-04-backlog-ai-test-progress-client.md (RICE 10 — connectionTests.ts が450行トリガーに接近（435行、余裕15行）したため着手。listener登録・shapeガード・runId相関・timeoutを`src/dashboard/aiTestProgressClient.ts`（deep module、新規テスト8件）へ抽出し、connectionTests.tsを435行→404行に削減。第2消費者トリガー（popup/diagnosticsPanel）は2026-08-23のADRで却下済みのため対象外化。type-check / 1889テスト全パス)

### 2026-08-22 background SettingsRepository 採用完了

- 2026-08-22-05-refactor-background-settings-repository-adoption.md (RICE 60 — RemoteAIService に SettingsReader を注入し `|| 'gemini'` インラインフォールバックを撤去。GeminiProvider/obsidianClient/localMarkdownExportCore/reviewSummaryGenerator/privacyPipeline/reviewSummaryAlarm/recordingCache の background 読み取りモジュール全てを `??` + DEFAULT_SETTINGS 統一に移行。コードレビュー実施、type-check / test 全パス確認)

### 2026-08-22 アーキテクチャ深掘り pass2 レジストリ完成 + MigrationService 分割

- 2026-08-22-00-backlog-architecture-pass2.md (pass 2 の4件の候補を RICE 213/160/120/10 で優先度付け。01-03 を PBI 化、04 は保留条件付き backlog として配置。なぜなぜ分析4件を完了)
- 2026-08-22-01-refactor-migration-service-split.md (RICE 213 — migrationService.ts 565行を migration/legacyMigration.ts + migration/opfsRecovery.ts + migration/migrationState.ts に分割。MigrationStatePort で chrome.storage 依存を剥がし InMemory テスト可能に。facade で後方互換維持。67件の移行テスト + 8320テスト成功)
- 2026-08-22-02-refactor-diagnostics-panel-deepening.md (RICE 160 — diagnosticsPanel 683行→375行。収集は DiagnosticsCollector.collect() の単一 seam に完全集約（extInfo/divergence/settingsLoadFailed 追加、sqlite リトライ内蔵）、操作は diagnosticsActions へ分離、debugMode は debugModeStore port 経由。パネルは getSettings/chrome.storage 直 import ゼロの Snapshot 描画のみ。新規テスト約22件、8342テスト成功)
- 2026-08-22-03-refactor-settings-repository-adoption.md (RICE 120 — SettingsRepository に `getMany` を追加し `DiagnosticsCollector`/`settingsForm`/`connectionTests` を repository 経由に移行。生キャスト22件を0件に。既定ポートを https+27124、AI_PROVIDER を openai に統一。DESIGN_SPECIFICATIONS.md に settings アクセス指針を追記。8347テスト成功)

### 2026-08-22 メッセージング seam 整理 + barrel retire 4件 実装完了

- 2026-08-21-01-refactor-collapse-message-handler-registry-shadow.md (RICE 1200 — `MessageHandlerRegistry`/`createMessageHandlerRegistry` を削除し `MessageRouter.dispatch` の1 seam に集約。createBackgroundServices の二重 deps リテラルを解消、messageHandler を router 必須の単一パス化、`as unknown as` cast を observable accessor（getHandler/getTrustLevel/getRegisteredTypes）で全廃。8320テスト成功)
- 2026-08-21-02-refactor-remove-redundant-offscreen-mutex.md (RICE 640 — `SqliteWriteMutex` クラスと手作りキューを削除し、`ChromeOffscreenTransport.requestQueue: Mutex` のみで直列化を担保。transport の maxQueueSize・timeout で back-pressure を可視化。type-check / 8327テスト成功)
- 2026-08-21-04-refactor-retire-storage-barrel.md (RICE 100 — storage.ts barrel の production 参照76箇所（静的75+動的1）を全て所有モジュールの直接 import に移行。lint 警告58件→0件。テストの barrel mock は importOriginal マージ形式のサブモジュール mock へ展開。barrel は @deprecated shim として維持。8320テスト成功)
- 2026-08-21-05-refactor-close-background-dashboard-seam-leak.md (RICE 12.5 — `formatEntriesToMarkdown` を `dashboard/obsidianFormatter.ts` から `utils/markdownFormatter.ts` に移動。`dashboard/obsidianFormatter.ts` を薄い re-export に縮小。`deps.ts` の import を utils に変更。background→dashboard の seam leak を解消。8327テスト成功)
- 2026-08-21-03-refactor-deepen-sqlite-client-interface.md (RICE 160 — SqliteClient を query/mutate/maintain/getStatus の4ドメインに deep 化。旧 20 メソッドのラッパーは後方互換で残存し委譲。createSqliteClientDeps を3ドメイン deps に更新。13ファイルのテスト mock を新 core メソッドに移行。8320テスト成功)

### 2026-08-21 Architecture Deepening 5件 実装完了（RICE 優先度順）

- 2026-08-21-01-refactor-settings-repository-seam.md (RICE 4800 — SettingsRepository を `get`/`set`/`getAll`/`onChange` の4メソッドに集約。`ChromeStorageAdapter`/`InMemoryStorageAdapter` の2 adapters で real seam。`set` の adapter 迂回を `saveSettings` 経由に修正し `getAll` のデフォルト欠落を修正。`InMemory` 越しテスト10件)
- 2026-08-21-02-refactor-recording-pipeline-deepening.md (RICE 1680 — `PipelineStep`/`ErrorStrategy`/`RecordingContext` を `@internal` 化し外部 interface を `record()` に集約。8通りのフラグ組み合わせは `RecordingPipeline.flags.test.ts` で検証済み)
- 2026-08-21-03-refactor-ai-summary-cleaner-deepening.md (RICE 1050 — 32ルール表は既に `CLEANSING_RULES` 単一ソース化され `content/pageState.ts` と `aiSummaryCleansingSettingsV2.ts` で `CLEANSING_RULES.map` から導出。406件のテストで検証済みのため追加実装不要)
- 2026-08-21-04-refactor-trust-decision-seam.md (RICE 857 — `TrustDecision` を `isTrusted(url)` の1 seam に新規作成し4モジュール往復を隠蔽。6件の単体テストで検証。`checkTrustDomainStep` への本番統合は51件失敗のため `TrustChecker` 内部での段階的委譲として次PBIで再実施)
- 2026-08-21-05-refactor-message-router-deepening.md (RICE 400 — `MessageRouter` を `dispatch(msg)` の1 seam に新規作成し19 handler の `trust`/`validator` 表を隠蔽。`createMessageHandlerRegistry` を `MessageRouter` に委譲する薄いラッパーにし、重複を解消。5件の単体テストで検証)
- 2026-08-21-00-backlog.md (5件のRICEスコアリングバックログ — Reach/Impact/Confidence/Effort + なぜなぜ分析)

### 2026-08-21 VulnHunter 指摘対応 1件 実装完了（CWE-208）

- 2026-08-21-01-fix-constant-time-confirm-token.md (RICE 2500 — `dashboardSqlite/index.ts:42` の `!==` を `constantTimeCompare`（`primitives.ts:67`）に置換。`providedToken` undefined ガード維持、async `await` 必須。`confirmTokenConstantTime.test.ts` 6件追加。8327テスト成功)
- 2026-08-21-00-backlog-vulnhunter.md (VulnHunter 2026-08-21 指摘1件のRICEスコアリングバックログ — RICE 2500 + 5 Whys分析)

### 2026-08-20 Panel Lifecycle Wave 3 完了 + Utils/Messaging 継続（残課題解消）

- 2026-08-20-wave2-panel-lifecycle-backlog.md (Dashboard Panel Abstraction Wave 2-3 ロードマップ 10パネルを完了。Wave 2: diagnosticsPanel、Wave 3: historyPanel/tagClusterPanel/domainSearchPanel/exportLogsPanel/generalSettingsPanel/privacySettingsPanel/aiSummaryCleansingPanel/STATIC_FORM_PANELS 9件を PanelLifecycle 直接実装に移行。main.ts の adaptLegacyPanel 全廃、types.ts legacy 型を @deprecated 化。268件の panel テスト成功)
- Utils barrel 直接化 継続 (rateLimiter/obsidianClient/saveToObsidianStep/BrowsingLogRecordMapper/obsidianSyncService の5ファイルを storage/types.js 直接化。残り27件は次スプリントへ)
- Messaging validator 拡張 (FetchUrlValidator/ManualRecordValidator に加え CheckDomainValidator/ContentCleansingExecutedValidator を追加し計7 concrete / 8タイプ配線。単体テスト49件)
- 2026-08-20 追加分: domainSearchPanel/exportLogsPanel/generalSettingsPanel/privacySettingsPanel/aiSummaryCleansingPanel/staticPanelAdapter を PanelLifecycle 化。historyPanel/tagClusterPanel の lifecycle テスト16件追加、tagClusterPanel-retry の loadData→load 修正

### 2026-08-20 Feature Dev 3件 実装完了（diagnosticsPanel Wave2 + utils layer + messaging validator）

- 2026-08-21-01-refactor-diagnostics-panel-wave2.md (diagnosticsPanel を PanelLifecycle 直接実装に移行。mount/load/destroy 分離、adaptLegacyPanel 削除、NavigationRegistry に diagnostic load 分岐追加。新規 lifecycle テスト19件追加。npm run validate 8260件成功)
- 2026-08-22-02-refactor-utils-layer-boundary.md (dev-docs/LAYERS.md 新設、ADR 2026-08-20-utils-layer-circular-dependency 新設、src/utils/ 15ファイルに // @layer コメント付与。trustDb↔settingsStore 循環と storageMaintenance 逆依存を例外として記録)
- 2026-08-23-03-refactor-messaging-validator-interface.md (src/messaging/validators.ts に MessageValidator<T> + ValidationError + 3 validator (ServiceWorkerRequest/ValidVisit/DashboardSqlite) を新設。MessageHandlerRegistry に validator オプション追加し VALID_VISIT/DASHBOARD_SQLITE に配線。単体テスト33件+registry統合テスト5件追加)

### 2026-08-20 アーキテクチャ深深化第2波 実装完了（5件）

- 2026-08-20-01-refactor-page-content-pipeline.md (PageContentPipeline深いモジュールを新設 — 10モジュール3,600行を prepare() の1 seam に集約。extractor.ts を委譲に簡素化。interface テスト6件追加。86e0786c)
- 2026-08-20-02-refactor-recording-pipeline-steps.md (RecordingPipeline 8フラグ組み合わせの深いインターフェーステストを追加 — force/skipDuplicateCheck/previewOnly の相互作用を record() の1 seam で検証。BEST_EFFORT/Mutex も同 seam で検証。a10b2a34)
- 2026-08-20-03-refactor-sqlite-domain-repository.md (BrowsingLogRepository深いモジュールを新設 — 20 thin proxy を6 domain メソッドに集約。token/timeout/retry を1 seamに隠蔽。6a05d936)
- 2026-08-20-04-refactor-diagnostics-panel-deepening.md (DiagnosticsCollector深いモジュールを新設 — 681行 god module の11診断を collect() → Snapshot に集約。local-substitutable adapter でテスト。e06fa484)
- 2026-08-20-05-refactor-settings-repository-unification.md (SettingsRepository深いモジュールを新設 — 30+散在の StorageKeys アクセスを typed get/set に集約。InMemory adapter でテスト。e06fa484)
- 2026-08-20-00-backlog.md (第2波5件のRICEスコアリングバックログ — Reach/Impact/Confidence/Effort + 依存図 + なぜなぜ分析)

### 2026-08-20 アーキテクチャ深深化第2波 前波アーカイブ（5件）

- 2026-08-20-01-refactor-saved-url-repository.md (SavedUrlRepository統合。前波で実装 — savedUrlStore 552行の5責務を崩壊、c39ad7b4でマージ)
- 2026-08-20-02-refactor-dashboard-sqlite-proxy-collapse.md (dashboardSqliteService 20関数をcallDashboardに集約。前波で実装)
- 2026-08-20-03-refactor-panel-lifecycle-interface.md (25パネルのPanelLifecycle定義。前波で実装)
- 2026-08-20-04-refactor-handler-composition-collapse.md (3層handler配線を統合、Pick型で最小依存注入。前波で実装)
- 2026-08-20-05-refactor-settings-schema-binding.md (SettingsSchema定義。前波で実装)
- 2026-08-20-00-backlog.md (前波5件のRICEスコアリングバックログ) — 注: 同名ファイルのため archived 側は前波版、pbi/ 側は第2波版が現行

### 2026-08-19 アーキテクチャ深深化でアーカイブ済み（5件）

- 2026-08-19-01-refactor-split-settings-god-module.md (settingsStore.tsをurlWhitelist/settingsMigration/storageMaintenanceに分割し循環依存を解消。133行)
- 2026-08-19-02-refactor-collapse-metadata-mappers.md (RecordingContextFieldMapper新設、saveMetadataStep.tsを186行→98行に縮小)
- 2026-08-19-03-refactor-delete-recordingcache-facade.md (静的RecordingCacheクラスを削除し全呼び出し元をRecordingCacheInstance DIに統一)
- 2026-08-19-04-refactor-narrow-handler-deps.md (MessageHandlerRegistryDepsをCommonHandlerDeps/RecordingHandlerDeps等にサブインターフェース分割)
- 2026-08-19-05-refactor-unify-dashboard-sqlite.md (SqliteRpcClientインターフェース導入、categorizeErrorを共有エラー分類に統一)

### 2026-08-19 コードレビュー指摘対応でアーカイブ済み（10件）

- 2026-08-19-00-backlog.md (コードレビュー指摘5件の順位付けバックログ)
- 2026-08-19-01-fix-localhost-port-validation.md (isLocalhostAddressがport未指定時にtrueを返すよう修正済み)
- 2026-08-19-02-fix-prompt-safecontext.md (isInSafeContextの常時falseバグを修正、safeMarkersロジックを実装済み)
- 2026-08-19-03-fix-dashboard-sqlite-types.md (DashboardSqliteMessageのpayloadをDashboardSqliteRequest共用体型に置換済み)
- 2026-08-19-04-fix-encrypt-base64.md (encrypt()の危険なbtoaを安全なbytesToBase64に置換済み)
- 2026-08-19-05-fix-visit-rate-limiter.md (TTLベースのエビクションを追加済み)
- 2026-08-19-06-fix-visit-rate-limiter-ttl-sweep.md (TTLスイープを毎回実行しMAX_ENTRIESは安全弁に留める)
- 2026-08-19-07-fix-prompt-safecontext-bypass.md (HTML属性値内を安全とみなさないようにsafe-context判定を強化)
- 2026-08-19-08-fix-malicious-usage-dangerlevel-ignored.md (LOW危険度検知を4箇所の呼び出し元で構造化ログに記録)
- 2026-08-19-09-improve-pbi-dod-enforcement.md (PBI DoDのテスト存在確認をCIで自動検証)

### 2026-08-18 型安全性強化でアーカイブ済み（6件）

- 2026-08-18-06-refactor-optional-property-strictness.md (`exactOptionalPropertyTypes`/`noImplicitReturns` を tsconfig.json に追加、発生エラー93件を53ファイルで全件解消)
- 2026-08-18-01-fix-eslint-errors-and-wire-ci-lint.md (npm run lint がエラー0件。validateスクリプトにlint追加、CIにLintステップ追加済み。既に完了していたため即時アーカイブ)
- 2026-08-18-02-fix-ban-explicit-any.md (eslint.config.js に no-explicit-any: error 追加。本番コードの any 9件を具象型に置換。MessageHandler の message: any は WHY コメント付きで維持)
- 2026-08-18-04-fix-remove-unknown-casts.md (as unknown as 31件を棚卸し。11件を型安全に置換、残り20件に WHY コメント付与。staticPanelAdapter/sourceManager の型設計見直し)
- 2026-08-18-05-refactor-disable-allow-js.md (bloomfilter-vendor.d.mts 作成、@ts-ignore 削除、allowJs: false に変更)
- 2026-08-18-03-refactor-tsconfig-strict-flags.md (tsconfig.json に noUncheckedIndexedAccess/noImplicitOverride/noFallthroughCasesInSwitch 追加。187件の型エラーを53ファイルで全件解消。CIとエディタの型チェックを整合)

### 2026-08-17 着手状況調査でアーカイブ済み（13件）

コードを直接調査し、受け入れ基準充足を確認できたもののみアーカイブ。部分実装のものはINDEX表に🔶注記付きで残置。

- 2026-08-17-02-refactor-unify-content-extraction-pipeline.md (buildExtractionOptions経由でoptionBuilder.tsに統一済み)
- 2026-08-17-03-refactor-remove-aiclient-wrapper.md (aiClient.ts自体が削除済み、createBackgroundServices.tsが直接AIService生成)
- 2026-08-17-05-refactor-composition-root-service-worker.md (service-worker.ts 214行、責務ごとのファクトリに分割済み)
- 2026-08-17-06-refactor-unify-recording-data.md (RecordingDataをmessaging/types.tsから再エクスポートし単一ソース化)
- 2026-08-17-07-refactor-collapse-recording-context.md (RecordingContextを意味のあるサブグループの交差型に分解済み)
- 2026-08-17-09-refactor-unify-pipeline-step-di.md (StepDepsに単一定義、各ステップがDI経由に移行済み)
- 2026-08-17-10-refactor-extract-result-builder.md (resultBuilder.tsへ抽出しRecordingPipelineから呼び出し済み)
- 2026-08-17-12-refactor-extract-notification-save-obsidian.md (saveToObsidianStepから通知呼び出しを除去、ハンドラ層責務化を明記)
- 2026-08-17-13-refactor-split-sqliteclient-transport.md (OffscreenTransport抽象化・ChromeOffscreenTransport実装に分割済み)
- 2026-08-17-15-refactor-flatten-dashboard-handler-deps.md (ReadOnlyDeps/CoreCrudDeps/MaintenanceBatchDepsに分離済み)
- 2026-08-17-20-refactor-unify-error-classification.md (errorClassification.tsに統一、errorMessages.tsは委譲shim化)
- 2026-08-17-21-refactor-unify-sensitive-data-masking.md (sensitiveDataMask.tsに統一、logMasker.ts等が委譲)
- 2026-08-17-22-refactor-collapse-masterpassword-module-state.md (MasterPasswordControllerクラスへ状態をインスタンス化済み)

### 2026-08-17 /feature-devでアーカイブ済み

- 2026-08-17-08-refactor-merge-recording-logic.md (RecordingPipelineにrecord()/recordWithPreview()を追加しRecordingLogicクラスを削除。createBackgroundServices.tsおよび呼び出し元5ファイルをRecordingPipeline直接参照に統一、テスト14ファイルを整理・移行。npm test 7979件成功)
- 2026-08-17-01-refactor-split-sqlite-engine-context.md (分割先4モジュールが孤立コードだった状態を修正し、sqliteEngineContext.tsが実際に委譲する構造へ。698行→283行、各モジュール250行以内。単体テスト22件追加、npm test 8065件成功)
- 2026-08-17-00-epic-architecture-deepening-aug17.md (子PBI 01〜05が全て完了したため親エピックも完了)
- 2026-08-17-28-fix-extractor-false-purity-pagestate.md (extractPageContentを純粋関数化しExtractResultオブジェクトを返す形に変更。pageState反映はreportValidVisit/GET_CONTENTハンドラ側の責務に分離。既存テスト4ファイルのアサーションを新契約に追従、純粋性検証テスト3件追加。npm test 8068件成功)
- 2026-08-17-23-refactor-deepen-cspsettings-static-facade.md (@deprecated CSPSettings静的クラスを削除しCspSettingsControllerインスタンス(cspSettings)に一本化。escapeRegExpをutils/string.tsへ移動、重複i18nヘルパーをutils/i18n.tsのgetMessageに統一。window.alertをインラインメッセージ表示に置換。既存テスト6ファイル更新、npm test 8065件成功)
- 2026-08-17-39-refactor-collapse-dashboard-sqlite-boilerplate.md (callDashboard<Req,Res>汎用ヘルパーを新設し、同一パターンの14関数を1呼び出しwrapperに置換。リトライ処理・非ServiceResult形状・専用デコードが必要な5関数は対象外として明示。704行→650行、npm test 8066件成功)
- 2026-08-17-00-backlog-architecture-deepening-batch3.md (対象6候補35〜40が全てアーカイブ済みとなったため索引文書もアーカイブ)
- 2026-08-17-26-refactor-decompose-recordcurrentpage-god.md (615行を TabContentFetcher/PreviewFlow/ForceRecordFlow/SpinnerManager/ErrorPresenter/RecordOrchestrator の6クラスに分解。uiStateをRecordOrchestratorのインスタンスフィールド化。ファサード32行、新規テスト14件追加、npm test 8080件成功)
- 2026-08-17-24-refactor-extract-sqlitehistorypanel-closure.md (875行から純粋HTML構築関数をsqliteHistoryPanelView.tsへ抽出、イベント配線はパネル側に残置。chrome.notificationsを新設notificationService.tsへ移動。パネル586行/View358行、新規テスト37件追加、npm test 8115件成功)
- 2026-08-17-27-refactor-decompose-trustdb-god-module.md (820行をDomainVerifier/BloomFilterManager/TrancoManager/SensitiveDomainStore/WhitelistStore/TrustDbVersionの6モジュールに分解。オーケストレーター557行に削減。storage/types.jsの動的importを静的化し循環依存を部分解消（settingsStore.jsとの循環はTrancoバージョンのsettings保存設計に起因するため意図的維持、理由をコード内に明記）。単体テスト33件追加、npm test 8148件成功)
- 2026-08-17-19-refactor-instance-session-store-header-detector.md (HeaderDetectorをインスタンス化。initialize/onHeadersReceived/cachePrivacyInfo等をインスタンスメソッド化しcreateBackgroundServices.tsで生成、service-worker.tsのグローバル初期化を除去。normalizeUrlは状態を持たない純粋関数のためstatic維持。npm test 7979件成功)
- 2026-08-17-14-refactor-instance-pending-storage-queue.md (pendingChromeStorageQueueのimport時即時生成シングルトンを廃止、createBackgroundServices経由のsetPendingWriteQueue明示初期化に変更。InMemoryAdapterを新設しテストをchrome.storageモック非依存に。呼び出し元saveMetadataStep/alarmHandlerのDI化は全StepDeps型への横断変更となるため今回はスコープ外と判断しユーザー確認済み。npm test 7979件成功)
- 2026-08-17-18-refactor-logger-dual-module.md (logger/*への直接import違反は実質0件と確認（sqliteAlert.tsのcriticalAlertSink.js importは意図的なDIアダプタ分離のため対象外）。eslint.config.jsにno-restricted-importsルールを追加しlogger/*直接importを禁止、logger.ts自体は除外設定。npm run type-check成功)
- 2026-08-17-35-refactor-split-message-handlers.md (messageHandlers.ts 680行・31エクスポートをrecordingHandlers.ts(8)/testingHandlers.ts(6)/systemHandlers.ts(21)の3モジュールに分割。createMessageHandlerRegistry.tsが3モジュールをimport、createBackgroundServices.tsと関連テスト4ファイルのimport元を更新。npm test 7979件成功)
- 2026-08-17-36-refactor-complete-error-classification-consolidation.md (createErrorResponseをerrorClassification.tsへ移動しsanitizeContextをsensitiveDataMask.maskSensitiveData('full')に置換。3本番importer(messageHandler.ts/systemHandlers.ts/dashboardSqliteWiring.ts)の参照先を更新、errorMessages.tsを45行の@deprecated再エクスポートshimに縮小。関連テスト396件成功)
- 2026-08-17-37-refactor-unify-opfs-where-query-builder.md (crudHandlers.tsのインラインWHERE/ORDER BY構築をsqliteQueryBuilder.ts経由(buildWhereClause/buildOrderByClause)に置換。crudHandlers固有のFTS5タグMATCH条件はbuildFtsTagMatchCondition新設で対応、既存IdbVfsBackendの挙動に影響しないようbuildWhereClause本体にはtag条件を追加せず呼び出し側で明示合成。ALLOWED_ORDER_COLUMNSをschema.tsに一本化。契約テスト10件新規追加。npm test 7989件成功)
- 2026-08-17-04-refactor-inject-store-recording-cache.md (RecordingCacheをRecordingCacheInstance(store注入可能)へ全面インスタンス化。RecordingCacheStore/SessionStoreRecordingCacheStore/InMemoryRecordingCacheStoreを新設。既存static呼び出し元14箇所はdefaultRecordingCacheへ委譲するstatic facadeとして無変更のまま動作、createBackgroundServices側も一貫性維持のためdefaultRecordingCache経由を継続（新規RecordingCacheInstance生成によるキャッシュ分断を回避）。独立性検証テスト5件新規追加。ユーザー確認の上フルインスタンス化を選択。npm test 7994件成功)
- 2026-08-17-16-refactor-inject-url-store-check-duplicate.md (StepDepsにUrlStoreインターフェースを追加しcheckDuplicateStepがdeps.urlStoreを優先利用する形に変更。RecordingPipelineがexecuteInternal内で常にurlStoreを渡すため実運用経路ではgetSavedUrlsWithTimestamps直接呼び出しは発生しない。InMemoryUrlStoreによるテスト3件新規追加。npm test 7997件成功)
- 2026-08-17-17-refactor-di-ify-offline-network-queue.md (buildRecordingPipelineDepsからsharedOfflineNetworkQueueの直接importを除去しPickパラメータとして受け取る形に変更。呼び出し元createBackgroundServices.tsが明示的に注入。NoOpOfflineNetworkQueueを新設しテスト2件追加。npm test 7999件成功)
- 2026-08-17-11-refactor-remove-notifications-from-pipeline.md (resultBuilder.tsのbuildErrorResultからchrome.notifications.create呼び出しを除去し、notifyRecordingErrorという独立関数に分離。既存のnotifyObsidianSaveSuccess(成功時通知)パターンと統一し、RecordingPipeline.executeInternalが明示的に呼ぶ形に。buildErrorResultはglobalThis.chrome未設定でも動作することをテストで確認。npm test 8006件成功)
- 2026-08-17-40-refactor-extract-managed-string-list-trustdb.md (trustDb.ts 889行のCRUD重複8メソッドをManagedStringListクラス(add/remove/getAll)に集約し3インスタンス化(userTlds/sensitiveDomains/whitelist)。Trancoバージョン追跡5メソッドをTrancoVersionTrackerに分離。「未初期化時エラー」の既存テスト5件が失敗したため各委譲メソッドにstate.databaseの二重ガードを追加して対応。ManagedStringList/TrancoVersionTracker単体テスト17件新規追加。PBI-27(6モジュール分解＋循環依存解消)はユーザー確認の上、規模超過につき見送り。npm test 8023件成功)
- 2026-08-17-38-refactor-extract-ssrf-ip-policy.md (fetch.ts 562行からSSRF/IPポリシー(isPrivateIpAddress/isLocalhostAddress/normalizeIpHostname/validateUrl*/ALLOWED_LOCALHOST_PORTS)をssrfGuard.tsへ分離。fetch.tsは再エクスポートで既存呼び出し元3ファイル(recordingValidator.ts/OpenAIProvider.ts/GeminiProvider.ts)を無変更に維持。cspValidator.tsの重複ALLOWED_LOCALHOST_PORTS定義をssrfGuard.tsからのimportに統一。ssrfGuard単体テスト23件新規追加(fetchモック不要)。npm test 8046件成功)
- 2026-08-17-25-refactor-eliminate-loader-urlskipper-copy.md (「content_scriptsは静的importできない」というPBI本文の前提を実ビルド(WXT/rolldown)で検証したところ、バンドラーがインライン化するため実際には制約が存在しないことが判明。loader.tsからSKIPPED_PROTOCOLS等74行の重複コードを削除しurlSkipper.tsを静的importする形に変更。urlSkipper-contract.test.ts(コピー同期契約テスト)を削除し、loader-no-static-imports.test.tsを「バンドラーで解決可能な相対importのみ許容」+「urlSkipper.tsをimportしていること」を検証する形に更新。wxt-build.test.tsにビルド成果物(content.js)にimport文が残らないことを検証するテストを追加。npm test 8043件成功)

### 2026-08-15 アーカイブ済み

- 2026-08-15-01-feat-history-sort-dropdown.md (SQLite Historyパネルにソートドロップダウンを追加。検索3バックエンド（IdbVfs/OPFS Worker/Fallback）全てにORDER BY分岐、選択はchrome.storage.localに永続化。v6.7.46 としてリリース)

### 2026-08-13 アーカイブ済み

- 2026-08-13-01-fix-encryption-session-mutex.md (getOrCreateEncryptionKeyのsession→local復元をMutexで排他制御、ダブルチェックロッキングで二重の新規secret生成を防止。実装中にMutex.ts自体の潜在バグ（診断ログ失敗によるロック永久化）を発見し併せて修正)
- 2026-08-13-02-fix-log-critical-sanitize-notification.md (logCriticalのOS通知にsanitizeRegex適用、PII/APIキー漏洩を防止)
- 2026-08-13-05-fix-apply-metadata-patch-runtime-guard.md (applyMetadataPatchにurl/timestamp実行時ガードを追加、型キャスト経由の改ざんを防止)
- 2026-08-13-03-fix-pending-queue-tags-unbounded-growth.md (pendingChromeStorageQueueのマージ後サイズ検証を拡張、content間引き後もtags肥大化する場合は末尾優先で切り詰め)
- 2026-08-13-04-fix-logger-flush-alarm-not-cleared.md (LogFlushSchedulerにclear()追加、persistPending成功時とclearLogsでスケジュール済みアラームを解除)

### 2026-08-11 アーキテクチャ深深化Epicでアーカイブ済み（11件）

- 2026-08-11-01-refactor-architecture-deepening-epic.md (5候補と子PBIを依存順に実装。atomic Saved URL保存、unified history query、panel state seam、handler依存縮小、review summaryのAIService移行を完了)
- 2026-08-11-02-deepen-saved-url-entry-module.md (Saved URL metadataのatomic CAS、metadata patch retry、旧queue payload互換)
- 2026-08-11-03-unify-history-query-module.md (SQLite history panelのquery/enrichment統合、最新row限定enrichment)
- 2026-08-11-04-deepen-sqlite-history-panel-test-seams.md (DOM非依存state seam、request generation guard、stale response防止)
- 2026-08-11-05-unify-recording-handler-interface.md (handler最小依存、共有closure、composition wiring整理)
- 2026-08-11-06-migrate-review-summary-to-ai-service.md (AIService factory注入、alarm/message共有、AIClient直接生成除去)
- 2026-08-10-01-refactor-dashboard-sqlite-result-contract.md (Epicへ統合し、SQLite結果契約とDashboard失敗処理を実装)
- 2026-08-10-02-refactor-sqlite-client-result-surface.md (Epicへ統合し、重複結果surfaceを整理)
- 2026-08-10-03-refactor-background-composition-wiring.md (Epicへ統合し、production compositionとrecording依存を整理)
- 2026-08-10-04-refactor-sqlite-offscreen-response-protocol.md (Epicへ統合し、SQLite response protocolを実装)
- 2026-08-10-05-refactor-recording-offline-policy.md (Epicへ統合し、offline policy metadataを実装)

### 2026-08-11 セッションでアーカイブ済み（3件）

- 2026-08-11-02-refactor-handler-registry-composition-root.md (handler registryをcomposition rootへ移設し、全19件のtrust levelを契約テストで固定)
- 2026-08-11-03-test-offline-retry-contract.md (obsidian_sync retryのmaskedCount不使用、SQLite/metadata step非再実行を契約テストで固定)
- 2026-08-11-04-refactor-dashboard-opfs-migration-decoder.md (DashboardのopfsMigrationV2*フィールドに厳密decoderを適用)

### 2026-08-12 セッションでアーカイブ済み（5件）

- 2026-08-01-17-fix-encryption-key-session-storage.md (マスターパスワード未設定時の暗号化キーをchrome.storage.sessionへ移行。マイグレーション・local storageフォールバック・PRIVACY.md更新を完了)
- 2026-08-07-08-refactor-ai-client-service-unification.md (AIClientをRemoteAIServiceの薄い委譲ラッパー化。in-flight重複排除・factory reuseを実装。AIClient自体の削除は高リスクのため保留)
- 2026-08-11-07-fix-sqlite-history-panel-reducer-consistency.md (sqliteHistoryPanelの全state mutationをhistoryStateReducer経由に統一)
- 2026-08-11-08-fix-metadata-patch-queue-capacity.md (metadata patch coalescing・payload上限100KB・content省略・RetryableItem対応を完了)
- 2026-08-11-09-fix-history-fallback-failure-contract.md (fallback検索失敗時にServiceErrorを返しover-fetchを解消)

### 2026-08-12 セッションでアーカイブ済み（Logger/Error層深耕 — 6件）

- 2026-08-12-01-refactor-move-message-handler-registry-to-composition-root.md (handler registryをcomposition rootへ移設し、service-worker.tsの責務を削減。createMessageRegistryCompositionを新設)
- 2026-08-12-02-refactor-migrate-aiclient-tests-to-aiservice.md (aiClient.test.tsとaiClient-priority-fallback.test.tsの実質テストをRemoteAIService.test.tsに移行。aiClient.test.tsは委譲contractに縮小)
- 2026-08-12-03-feat-dashboard-multitab-ai-test-correlation.md (AIテスト進捗に相関IDを付与し、複数ダッシュボードタブの干渉を防止)
- 2026-08-12-04-refactor-logger-core-concern-separation.md (Logger core を LogBuffer/LogSanitize/LogStorageAdapter/LogFlushScheduler に分割。core.tsはオーケストレータ化)
- 2026-08-12-05-refactor-logcritical-notification-seam.md (logCriticalから通知責務をCriticalAlertSinkアダプタに分離。sqliteAlert.tsも明示的にsinkを渡す)
- 2026-08-12-06-refactor-resolvelogsource-stack-removal.md (resolveLogSourceのnew Error().stackパースを削除し、sourceを明示渡しのみに)
- 2026-08-12-07-refactor-errorMessage-retain-as-is.md (errorMessage()を削除テストで現状維持と確定。rationaleコメントを追加)

### 2026-08-09 セッションでアーカイブ済み（17件）

アーキテクチャレビュー2026-08-08・2026-08-09の指摘対応。いずれもコード上で完了を確認済み。

- 2026-08-08-01-refactor-recording-logic-split.md (RecordingLogic 541行を RecordingCache/RecordingValidator/RecordingLogic に分割)
- 2026-08-08-02-refactor-ai-service-test-connection.md (AIServiceにtestConnectionを追加。RemoteAIServiceのsuccess/error欠落バグも修正)
- 2026-08-08-03-refactor-panel-contract-cleanup.md (refresh()をoptional化。14実装中8件は実処理を持つため削除は誤りと判明)
- 2026-08-08-04-refactor-messaging-layer-consolidation.md (整合性テストの手書きリストをソース導出方式へ)
- 2026-08-08-05-refactor-ai-provider-asymmetry.md (Geminiの429リトライ・使用量0記録・BuiltInAiのsanitizeContent未通過を解消)
- 2026-08-08-06-test-untested-modules-coverage.md (recordingCache・VULN-014/004にテスト31件追加)
- 2026-08-08-07-fix-sqlite-history-pagination.md (**実害修正**: 履歴1000件超の51ページ目以降が閲覧不能。サーバ側ページングへ)
- 2026-08-08-08-refactor-dead-code-and-seam-bypass.md (死蔵判定を3点とも訂正。i18nは非等価のためseam補強)
- 2026-08-09-10-fix-dashboard-sqlite-lasterror-snapshot.md (**実害修正**: deps.lastErrorが起動時nullで凍結され15箇所のエラー文言が未表示だった問題をgetter化で解消)
- 2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md (createSqliteClientDepsで本番/テストの配線を共有化)
- 2026-08-09-12-fix-querylogs-error-swallowing.md (**実害修正**: DB障害時に空ファイルをDLし「completed」表示していた問題)
- 2026-08-09-13-refactor-sender-trust-policy.md (registryに信頼レベルを必須化。無防備だったハンドラを強化)
- 2026-08-09-14-refactor-remove-offscreen-sqlite-shim.md (非推奨再エクスポート層を削除。offscreenテストが152→175件に)
- 2026-08-09-15-investigate-markdown-sanitizer-divergence.md (調査完了・**対応不要**。ADRが用途別使い分けを定めており現状が正しい)
- 2026-08-09-16-refactor-remove-dashboard-sqlite-test-wrapper.md (本番未使用のテスト専用wrapperを削除し72箇所をハーネス経由へ)
- 2026-08-09-17-refactor-remove-per-handler-sender-guards.md (認可判定を1箇所に集約。削除前に全19型×3送信元の網羅テスト59件を用意)
- 2026-08-09-18-refactor-cleansing-rule-table.md (**実害修正**: 32ルール中15件がcount経路で捨てられていた問題。既定設定で表示件数 4→6 に是正。countTargets.ts 497行を削除)
- 2026-08-09-19-refactor-sqlite-read-result-union.md (**実害修正**: DB障害が「データがありません」と表示される問題。読み取り系4関数をCallResult貫通に)

### 2026-08-09〜10 セッションでアーカイブ済み（5件）

- 2026-08-09-20-refactor-cleansing-rule-single-source.md (ルール宣言が10層に散在し既定値が7ルール食い違っていた問題。「新規ユーザー既定値」と「未指定時フォールバック」を分離しCLEANSING_RULES表から導出。実装中にenhancedHidden/emptyElemの追加の食い違いを発見・是正。実装計画は3箇所想定だったが実際は5箇所[aiSummaryCleansingSettingsV2.ts]。テスト7680→7690)
- 2026-08-09-21-refactor-sqlite-write-result-union.md (**実害修正**: 削除・スター操作の失敗時に画面が完全無反応だった問題。変更系9メソッドをCallResult化し共有可変lastErrorを完全削除。実装中に「toggle_starの成功レスポンスがsuccessを欠きスター操作が成功時も失敗扱いだった」実害を追加発見・是正。テスト7690→7697)
- 2026-08-09-22-refactor-shallow-static-form-panels.md (init関数を転送するだけの9ファイル133行を宣言表+アダプタへ集約。staticForm/が12→5ファイルに。id検証テストは変異テストで有効性確認済み。**DoDの手動確認[9タブをChromeで開く]は実装者環境で未実施**。テスト7697→7711)

- 2026-08-09-24-refactor-dashboard-reverse-dependency.md (panel層→dashboard.tsの逆依存と二重bootstrapを解消。dashboard.ts 1000行超→93行。借り手が1人しかいない関数を共有モジュールに置く形をやめ、generalSettings/connectionTests.ts・settingsForm.ts と panel 側へ再配置。**計画のRed前提は誤りだった**: testDir/vitest.setup.ts が chrome を全体モックするため「import すると初期化が落ちる」は起きず、import グラフをソース文字列で検証する形に書き換えた。ディープリンクは start() へ渡す形になり click 合成フォールバックが不要に。テスト7711→7727)
- 2026-08-08-09-refactor-dashboard-dual-bootstrap.md (Phase1/3は先行セッションで完了、残る Phase2/4 を 2026-08-09-24 が実施したため完了扱い)

### 2026-08-10 セッションでアーカイブ済み（2件）

- 2026-08-07-13-refactor-service-wiring-backend-consolidation.md (サービス配線・StorageBackend・プロバイダ設定表示・エラー処理の統合候補。調査結果「実重複でない/高リスク」と判断し対応不要でクローズ)
- 2026-08-09-23-refactor-sqlite-transport-layers.md (**Epic 8pt・全Phase完了**)。Phase1(型二重化解消)・Phase2(失敗表現のServiceResult統一)・Phase3(confirmToken要否の単一ソース化)を実施。Phase3 はシニア相談を経て `tokenExempt` 免除リスト方式（fail-safe）で実装。旧実装でトークン不要だった破壊的操作3件（append_to_obsidian/purge_now/content_purge_now）を要トークン化。トークン要否を `messaging/sqliteOperationSecurity.ts` に一元化し送受信ドリフトを排除。**このセッションでアーカイブした実装計画**: `2026-08-09-pbi23-sqlite-transport-layers-plan.md` / `2026-08-09-pbi23-phase3-senior-consultation.md`

**同セッションでアーカイブした実装計画（dev-docs/archived/plans/）10件**:
2026-07-27-pbi11 / pbi13 / pbi15 / pbi24 / pbi26 / pbi27 / pbi29-36-35 / pbi34 の各計画と
2026-07-26-chrome-built-in-ai-provider-plan.md。いずれも対応PBIがアーカイブ済み。

---

### 2026-08-07 セッションでアーカイブ済み

**実装済みPBI（dev-docs/archived/pbi/）** — 重複コード解消:
- 2026-08-07-01-refactor-ai-provider-common-extraction.md (Gemini/OpenAIプロバイダ重複をAIProviderStrategy基底クラスへ抽出)
- 2026-08-07-02-refactor-master-password-ui-unification.md (マスターパスワードUIのpopup/dashboard統合)
- 2026-08-07-03-refactor-settings-export-import-ui-unification.md (設定エクスポート/インポートUI統合)
- 2026-08-07-04-refactor-utility-functions-consolidation.md (escapeHtml/base64/showStatus等の共通化)
- 2026-08-07-05-refactor-domain-matching-consolidation.md (ドメインマッチング/wildcardToRegex統合)
- 2026-08-07-06-refactor-legacy-url-storage-removal.md (urlStorageをsavedUrlStoreへ統合・削除)
- 2026-08-07-07-refactor-allowed-urls-single-source.md (許可URL二重実装の単一ソース化・Obsidianポート27124バグ修正)
- 2026-08-07-09-refactor-pending-queue-unification.md (保留キュー3実装をStorageBackedQueueへ共通化)
- 2026-08-07-10-refactor-provider-labels-single-source.md (PROVIDER_LABELSをaiProviderLabels.tsへ単一ソース化)
- 2026-08-07-11-refactor-sqlite-extract-domain-consolidation.md (sqliteEngineContextのextractDomainをwww除去に統一)
- 2026-08-07-12-refactor-duplicate-test-consolidation.md (Gemini/OpenAI/fieldValidationの重複テスト統合)

**実装計画（dev-docs/archived/plans/）**:
- 2026-08-07-01〜06 の各実装計画（ai-provider-common-extraction / master-password-ui-unification / settings-export-import-ui-unification / utility-functions-consolidation / domain-matching-consolidation / legacy-url-storage-removal）

### 2026-08-02 セッションでアーカイブ済み

- 2026-08-02-01-feat-expand-prompt-injection-tests.md (プロンプトインジェクション検知テスト拡充。OWASP/日本語含むインジェクションマトリクスと誤検知ガードを `promptSanitizer-owasp-matrix.test.ts` に追加。npm run validate成功)
- 2026-08-02-02-feat-optimistic-lock-stress-test.md (楽観的ロックのストレステスト。大量順序バッチ・キー間独立性・リトライ枯渇時のConflictError・冪等更新の収束を `optimisticLock-stress.test.ts` に追加。npm run validate成功)
- 2026-08-02-03-feat-privacy-pipeline-integration-test.md (プライバシーパイプラインのPIIリーク防止検証。クラウドAI送信データに生PIIが含まれないことを成功/ローカル失敗/マスク済みクラウドの各モードで `privacyPipeline-pii-leak.test.ts` に追加。npm run validate成功)
- 2026-08-02-04-fix-obsidian-api-key-leakage-prevention.md (Obsidian APIキー漏洩防止のクライアントレベル検証。ヘッダーへの正当な配置と、ログへの生キー非出力を `obsidianClient-api-key-leak.test.ts` に追加。npm run validate成功)
- 2026-08-02-05-fix-sqlite-unique-constraint-validation.md (SQLiteの(url, created_at) unique制約検証。重複INSERTが静かに無視され、同一URL別タイムスタンプが保持されることを `recordsRepo-unique-constraint.test.ts` に追加。npm run validate成功)

### 2026-08-02 セッションでアーカイブ済み（機能追加分）

- 2026-08-02-01-feat-builtin-ai-diagnostics.md (診断パネルにブラウザ内蔵AI診断セクションを追加。builtInAiDiagnosticsService + diagnosticsPanelに診断表示・モデルダウンロード導線を実装。npm run validate成功)

### 2026-08-01 セッションでアーカイブ済み

- 2026-08-01-22-fix-tranco-domains-clear-cost-documentation.md (saveOldTrancoDomains/clearOldTrancoDomainsのJSDocにsaveSettings()経由のコスト特性を明記。ロジック変更なし)
- 2026-08-01-21-fix-offline-queue-test-pending-promise-cleanup.md (persists retryCount progressテストの未解決Promiseを明示的にresolve/awaitしてクリーンアップする形に変更)
- 2026-08-01-20-fix-trustdb-dynamic-import-duplication.md (trustDb.tsの3箇所の重複する動的importをgetSettingsStore/getStorageTypesヘルパーに集約)
- 2026-08-01-19-fix-offline-queue-save-frequency.md (saveQueue書き込みコスト・頻度を調査。unlimitedStorage権限によりクォータ制限なし、耐障害性とのトレードオフを優先し対応不要と判断してクローズ)
- 2026-08-01-18-fix-offline-queue-pending-filter-complexity.md (retryAll()のpending配列除去をfilter(O(n²))からshift()(O(n))に改善)
- 2026-08-01-16-fix-trustdb-settings-store-unification.md (trustDb/trancoConsentManagerのtranco_domains・tranco_versionをgetSettings/saveSettings経由に統一。npm run validate成功)
- 2026-08-01-15-fix-offline-queue-rate-limit.md (retryAll()にMAX_JOBS_PER_CYCLE=20を追加、上限超過分は次回サイクルへ持ち越し。npm run validate成功)
- 2026-08-01-14-fix-offline-queue-alarm-await.md (alarmsリスナーをasync化しPromise.allSettledで並列待機、retryAll()をジョブ単位保存に変更。npm run validate成功)
- 2026-08-01-13-fix-url-fallback-triggered-optimistic-lock.md (setUrlFallbackTriggeredをwithOptimisticLockに統一、URL照合を他setterと同じ非正規化方式に変更。npm run validate成功)
- 2026-08-01-01-fix-service-worker-init.md (Service Worker の init() 呼び出し。遅延マイグレーションで E2E 競合を回避。v6.7.7 としてリリース)
- 2026-08-01-02-fix-crypto-envelope-validation.md (暗号化エンベロープ入力検証強化。v6.7.7 としてリリース)
- 2026-08-01-03-fix-hmac-key-protection.md (HMAC 署名鍵暗号化保存。v6.7.7 としてリリース)
- 2026-08-01-04-fix-prompt-injection-defense.md (プロンプトインジェクション対策強化。v6.7.7 としてリリース)
- 2026-08-01-05-fix-content-script-sender-validation.md (VALID_VISIT sender 検証 + レート制限。v6.7.7 としてリリース)
- 2026-08-01-06-fix-pii-long-token-leak.md (PII long-token マスク漏れ修正。v6.7.7 としてリリース)
- 2026-08-01-07-fix-non-idempotent-retry.md (POST 5xx 再送禁止。v6.7.7 としてリリース)
- 2026-08-01-08-fix-recording-state-resource-management.md (Mutex/Cache/SessionStore リソース管理。v6.7.7 としてリリース)
- 2026-08-01-09-fix-fetch-utility-robustness.md (fetch timeoutMs/AbortError/IPv6/localhost。v6.7.7 としてリリース)
- 2026-08-01-10-fix-crypto-maintainability.md (暗号化モジュール保守性。v6.7.7 としてリリース)
- 2026-08-01-11-fix-obsidian-client-robustness.md (Obsidian クライアント堅牢性。v6.7.7 としてリリース)
- 2026-08-01-12-fix-ai-provider-consistency.md (AI プロバイダー整合性。v6.7.7 としてリリース)

### 2026-07-30 セッションでアーカイブ済み

- 2026-07-30-38-feat-edge-phi-mini-provider-support.md (Edge (Phi-mini) Built-in AI 対応。実機検証でAPI形状がChromeと同一と判明し、既存 `BuiltInAIClient` に動的コンテキスト切り詰め・`oncontextoverflow`監視・ブラウザ別案内文言を追加。i18n・テスト実装済み。`browserSupport.ts` のデッドコード `supportsBuiltInAI()` を削除。v6.7.4 としてリリース)

### 2026-07-28 セッションでアーカイブ済み

- 2026-07-26-32-feat-built-in-ai-provider-implementation.md (TDDによるBuilt-in AI Provider実装。`BuiltInAIClient`（Service Workerから`LanguageModel`を直接呼び出す実装）をTDDで構築し`LocalAIService`/`FallbackAIService`に統合、`offscreen.ts`をSQLite専用に純化、旧`localAiClient.ts`を削除。優先度リストの`built-in-ai`スロット判定を`AIClient`に実装しフォールバックが動作することを単体テストで検証。ダッシュボードUIに選択肢を追加しi18n対応。実機Service Workerで`LanguageModel.create()`→`session.prompt()`の成功を確認、Playwrightで`@interaction`E2Eテスト化（`dashboard-built-in-ai.spec.ts`、`playwright.config.ts`に`interaction`プロジェクト新設）。オフライン動作確認の受け入れ基準はGemini Nanoがオンデバイス推論で外部通信を行わないため検証行為自体が成立しないと判断し撤回、コードレビューで外部通信呼び出し不在を確認する形に代替。全7272テスト・型チェック・ビルド成功)
- 2026-07-26-31-feat-built-in-ai-provider-integration-design.md (Built-in AI Provider統合設計。PBI本文が想定していた`AIProviderStrategy`/`AIClient.registerProvider`経由ではなく、2026-07-27 ADR「AIClientとAIServiceの統一方針」に沿って`AIService`経由で統合する設計に転換。Service Worker直接呼び出し・長文前処理・状態別UX・ダッシュボードUI統合を `dev-docs/2026-07-28-built-in-ai-provider-integration-design.md` に設計、チームレビュー承認済み)
- 2026-07-26-30-feat-chrome-built-in-ai-oss-research.md (Chrome Built-in AI OSS実装3件・Prompt API公式仕様を調査し `dev-docs/2026-07-27-chrome-built-in-ai-oss-research.md` にレポート化。実機検証によりService Worker内で`LanguageModel`へ直接アクセス・呼び出しできることを確認、既存の「Offscreen Document必須」という前提に疑義を提示。改善候補6件をPBI-31に引き継ぎ)

### 2026-07-27 セッションでアーカイブ済み

- 2026-07-25-11-fix-verify-constant-time-compare.md (constantTimeCompareフォールバック実装の定数時間性を検証。ベンチマークスクリプト作成・Playwright 可用性チェック・ADR 記録・実 Chrome ブラウザでのタイミング計測完了。有意差あり(t=2.2381)を確認。追加緩和策は不要と判断しPBI-33をクローズ)
- 2026-07-27-33-fix-constant-time-compare-mitigation.md (constantTimeCompareフォールバックのタイミングサイドチャネル緩和。なぜなぜ分析の結果、追加緩和策は不要と判断。ローカルのパスワード検証のみでネットワークに露出しないため、1.85μsのタイミング差は攻撃面に影響しない)
- 2026-07-26-27-fix-popup-dashboard-settings-duplication.md (popup の重複設定 UI を削除し dashboard に一本化。共有モジュールはファイル削除せず popup 側の init 呼び出しのみ除去。自動テスト・ビルド検証済み)
- 2026-07-25-35-fix-service-worker-state-persistence.md (`isCacheInitialized`/`autoSavedBadgeTabs` を `chrome.storage.session` へ永続化、実ブラウザ動作確認済み)
- 2026-07-25-36-refactor-service-worker-singleton-di.md (`TabCache` の遅延初期化パターン試験導入、実ブラウザ動作確認済み)
- 2026-07-26-29-refactor-service-worker-god-file-split.md (オフラインキュー処理抽出・未使用 `RecordingPipeline` import 削除、実ブラウザ動作確認済み)
- 2026-07-26-24-refactor-utils-subdirectory-split.md (`crypto.ts`/`typesCrypto.ts` を `src/utils/crypto/` へ移行、Task 1完了としてアーカイブ)
- 2026-07-26-26-refactor-ai-client-service-unification.md (`AIService` への統一方針を ADR に記録、`AIClient` に新規利用非推奨の JSDoc を追加)
- 2026-07-26-13-fix-legacy-dual-write-default.md (`pendingChromeStorageQueue.ts` を新設し chrome.storage 書き込み失敗時のリカバリキューを実装。デフォルト変更は影響範囲が大きいため見送り、ADRに記録)
- 2026-07-26-15-fix-settings-migration-non-destructive.md (`settings` 移行時の個別キー削除を `legacy_settings_backup_*` への退避に変更。破損時の復元ロジックと30日後のクリーンアップを追加)

### 2026-07-26 セッションでアーカイブ済み

- 2026-07-22-01-doc-response-size-limit-adr.md (response-size-limit用ADR作成、後片付け漏れを確認しアーカイブ)
- 2026-07-22-02-refactor-response-size-limit-detection.md (ASTベース検出ロジックへのリファクタ、後片付け漏れを確認しアーカイブ)
- 2026-07-25-01-fix-release-command-injection.md (release.ymlコマンドインジェクション修正、重複ファイルを整理)
- 2026-07-25-02-fix-oauth-response-log-leak.md (OAuthログ漏洩防止、重複ファイルを整理)
- 2026-07-25-03-fix-cws-publish-reliability.md (CWS公開ステップ信頼性向上、重複ファイルを整理)
- 2026-07-25-04-feat-ci-security-review-checklist.md (CI/CDセキュリティレビューチェックリスト作成、重複ファイルを整理)
- 2026-07-25-05-feat-log-sensitivity-policy.md (ログ機密性分類ポリシー策定、重複ファイルを整理)
- 2026-07-25-06-feat-external-api-reliability-guideline.md (外部API信頼性設計ガイドライン策定、重複ファイルを整理)
- 2026-07-25-07-feat-eslint-rule-testing-guideline.md (ESLintルールテストケース生成プロセス確立、重複ファイルを整理)
- 2026-07-25-08-feat-cwe-classification-guideline.md (CWE分類フレームワーク適用ガイドライン、重複ファイルを整理)
- 2026-07-25-09-doc-api-endpoint-documentation.md (Obsidian Local REST APIエンドポイント一覧を文書化)
- 2026-07-25-10-fix-magic-numbers-extraction.md (背景処理のマジックナンバーを名前付き定数に抽出)
- 2026-07-25-12-doc-recording-pipeline-edge-cases.md (RecordingPipelineのステップ実行順序をコメントで図示)
- 2026-07-25-13-fix-verify-inline-event-handler.md (recordBtn等の.onclick=パターンに設計意図のコメント追加)
- 2026-07-25-14-fix-pii-regex-redos-hardening.md (PIIサニタイズのemailパターンによるReDoS解消)
- 2026-07-25-15-fix-hardcoded-japanese-strings.md (popup.html日本語ハードコード修正、13箇所。options.html分はPBI-33に分割)
- 2026-07-25-16-fix-ai-summary-locale-default.md (AI要約デフォルトプロンプトのロケール解決を修正)
- 2026-07-25-17-fix-privacy-consent-integrity-signature.md (プライバシー同意記録にHMAC署名検証を追加)
- 2026-07-25-18-fix-data-retention-after-consent-withdrawal.md (同意撤回時のデータ削除確認ダイアログ追加)
- 2026-07-25-19-fix-migration-retry-limit.md (マイグレーション失敗の無限リトライに上限を追加)
- 2026-07-25-20-fix-logger-batch-flush-strategy.md (ログバッチフラッシュの既存実装状況を記録・SW終了時タイムアウト可視化)
- 2026-07-25-21-fix-ai-call-deduplication.md (AI要約リクエストのin-flight重複排除を実装)
- 2026-07-25-22-fix-duplicate-check-race-condition.md (RecordingPipelineにURL単位のMutexを追加)
- 2026-07-25-23-fix-sqlite-optimistic-lock.md (SQLite楽観的ロックの現状調査、対応不要と判断)
- 2026-07-25-24-fix-focus-trap-consistency.md (フォーカストラップの共通ロジックを抽出し未使用箇所に適用)
- 2026-07-25-25-refactor-background-error-handling.md (共通エラーハンドリングラッパーの導入状況を記録)
- 2026-07-25-26-refactor-legacy-typescript-patterns.md (settingsへの値代入をassignSettingValue()経由に統一)
- 2026-07-25-27-refactor-obsidian-api-abstraction.md (Obsidian Local REST APIのパス組み立てを一元化)
- 2026-07-25-28-fix-message-type-contract-testing.md (メッセージ型契約テストをVALID_MESSAGE_TYPESからSSOT自動導出化)
- 2026-07-25-29-refactor-test-setup-simplification.md (chrome.i18nメッセージモックをen/messages.jsonから動的生成)
- 2026-07-25-30-fix-pbkdf2-legacy-timing-sidechannel.md (PBKDF2レガシー検証パスのタイミングサイドチャネル解消)
- 2026-07-25-31-fix-verify-legacy-crypto-export-removal.md (非推奨hashPassword/verifyPasswordを内部専用化)
- 2026-07-25-32-fix-export-batch-pagination.md (ローカルMarkdown全履歴エクスポートをバッチストリーミング化)
- 2026-07-25-33-refactor-domain-filter-consolidation.md (ドメインフィルタ関連コードの責務分離マップをADRとして作成)
- 2026-07-26-01-doc-privacy-md-sync.md (public/PRIVACY.mdをdocs/PRIVACY.mdの最新内容に同期)
- 2026-07-26-02-doc-design-tokens.md (デザイントークン「研墨」をDESIGN_TOKENS.mdとして文書化)
- 2026-07-26-03-fix-encryption-secret-label.md (ENCRYPTION_SECRETの誤った「廃止予定」ラベルを訂正)
- 2026-07-26-04-fix-wa-sqlite-version-pin.md (wa-sqliteバージョン方針の調査、現状維持でクローズ)
- 2026-07-26-05-feat-ci-sbom-generation.md (CIにSBOM生成ステップを追加)
- 2026-07-26-06-fix-html-lang-attribute-dynamic.md (html lang属性動的化、実装済みと確認しクローズ)
- 2026-07-26-07-fix-addlog-message-sanitization.md (addLogのmessageパラメータもPIIサニタイズ対象に追加)
- 2026-07-26-08-fix-offscreen-ai-error-exposure.md (offscreen.tsの生エラーオブジェクトのconsole出力を修正)
- 2026-07-26-09-fix-pending-storage-key-rename.md (osh_pending_pagesストレージキーをpending_pagesにリネーム)
- 2026-07-26-10-fix-i18n-plural-integration.md (applyI18nがdata-i18n-argsのcountから複数形キーを自動解決)
- 2026-07-26-11-fix-response-for-type-completeness.md (ResponseForTypeの型マッピングを全メッセージ種別に完全化)
- 2026-07-26-12-fix-protocol-version-validation.md (プロトコルバージョン検証、実装済み・制約により対応不可と判明しクローズ)
- 2026-07-26-16-fix-pending-sqlite-queue-retry-alarm.md (pendingSqliteQueueに定期リトライアラームを追加)
- 2026-07-26-17-refactor-console-to-structured-logger.md (dashboard分のconsole出力を構造化ロガーに置き換え。Offscreen分はPBI-34に分割)
- 2026-07-26-18-refactor-sqlite-client-last-error.md (SqliteClientのlastError管理をcall()に一元化)
- 2026-07-26-19-fix-tabcache-content-removal.md (TabCacheのcontentフィールドが常にnullのデッドフィールドと判明、削除)
- 2026-07-26-20-fix-offscreen-mobile-suspend-mitigation.md (モバイル検出時にSQLiteメッセージタイムアウトを短縮、既存アラームにヘルスチェックpingを相乗り)
- 2026-07-26-23-fix-dashboard-dead-code-removal.md (未参照の旧パネル実装3ファイル+テスト4件を削除、tagsPanel.tsは別PBI-35に分割)
- 2026-07-26-37-fix-dashboard-general-missing-settings.md (PBI-27着手前の前提条件。dashboardのGeneralパネルにmin_visit_duration等3項目を追加。Body Protectionは既存実装と判明し対象外)
- 2026-07-26-25-refactor-logger-split.md (logger.ts 755行をtypes/core/apiの3ファイルに分割、呼び出し元120件が多いためlogger.tsはバレルとして維持)
- 2026-07-26-34-refactor-offscreen-console-to-logger.md (Offscreen側21件のconsole出力をログ機構経由に置き換え。offscreen.tsはLOG_FORWARDメッセージでSW中継、sqliteEngineContext.tsは既存loggerを直接呼び出し可能と判明、opfsWorker.ts(Web Worker)はpostMessage経由でsqliteEngineContextに中継)
- 2026-07-26-14-fix-offline-queue-retry-skip-ai.md (前回スキップ判断を覆し実装。OfflineJob.typeが既にobsidian_sync/ai_summaryを区別済みと判明し、recordingLogic.retryObsidianWriteOnly()を追加するだけの小規模実装で完了)
- 2026-07-26-22-refactor-barrel-reexport-removal.md (aiClient.tsは誤認識と判明し対象外。残り4バレルファイルは呼び出し元が1〜2箇所と少なく、直接import化してバレル自体を削除)
- 2026-07-26-35-fix-dashboard-tagspanel-dead-code.md (調査の結果tagsPanel.tsはpanels/staticForm/tagsSettingsPanel.tsから現役でimportされている依存モジュールと判明。削除不要でクローズ)
- 2026-07-26-33-fix-hardcoded-japanese-strings-options.md (options.html日本語ハードコード約247件をi18n化。当初想定220件+複数行パターン22件+data-i18n属性欠落19件を追加発見し対応、新規i18nキー19件追加)
- 2026-07-26-28-fix-web-accessible-resources-scope.md (web_accessible_resourcesを9パターンから2パターンに絞り込み。Content Scriptから実際に必要なのはcontent-extractor.jsとicons/icon48.pngのみと判明、残りは拡張機能内部専用リソースで宣言不要と確認。実Chrome手動確認済み)

### これまでのアーカイブ済み

- 2026-07-23-05-fix-remove-unused-exports.md (未使用エクスポート82個+型34個の削除)
- 2026-07-23-04-fix-remove-unused-files.md (未使用ファイル6個の削除)
- 2026-07-23-03-fix-remove-unused-dependencies.md (未使用依存パッケージ6個の削除)
- 2026-07-22-07-back-security-lint-rule-and-review-checklist.md (lint rules + PR template)
- 2026-07-22-01-fix-obsidian-markdown-injection-core.md (VULN-001,002,004,005)
- 2026-07-22-02-fix-obsidian-markdown-injection-downstream.md (VULN-006,007,020)
- 2026-07-22-03-fix-reliability-races-resource-exhaustion.md (VULN-003,008,011,012,014,016)
- 2026-07-22-04-fix-settings-import-bypass-ssrf.md (VULN-009,010,013)
- 2026-07-22-05-fix-master-password-lockout.md (VULN-018,021)
- 2026-07-22-06-fix-master-password-protection-integrity.md (VULN-015,017,019)
- 2026-07-21-04-refactor-hardening-diagnostics-errors.md
- 2026-07-21-03-refactor-dedup-diagnostics-panel.md
- 2026-07-21-02-refactor-ai-provider-commons.md
- 2026-07-21-01-fix-diagnostic-security.md
- 2026-07-20-12-fix-gist-sync-completeness.md
- 2026-07-20-13-fix-ai-provider-response-validation.md
- 2026-07-20-17-fix-mobile-accessibility-frontend.md
- 2026-07-20-21-fix-dashboard-i18n-locale-fallback.md
- 2026-07-20-18-fix-supply-chain-adm-zip.md
- 2026-07-20-23-fix-ci-dx-improvements.md
- 2026-07-20-19-cleanup-conflictstats-docs.md
- 2026-07-20-20-fix-external-endpoint-configurability.md
- 2026-07-20-16-feat-ai-usage-controls.md
- 2026-07-20-15-fix-logger-sw-resilience.md
- 2026-07-20-14-fix-content-script-performance.md
- 2026-07-20-22-fix-local-ai-pii-masking-order.md
- 2026-07-20-11-fix-opfs-sqlite-transaction-integrity.md
- 2026-07-20-10-feat-offline-network-queue.md
- 2026-07-20-02-fix-session-store-resilience.md
- 2026-07-20-01-fix-message-type-unification.md
- 2026-07-20-09-fix-docs-dual-translation-system.md
- 2026-07-20-08-fix-changelog-release-note-guidelines.md
- 2026-07-20-07-fix-data-integrity-cleanup.md
- 2026-07-20-06-fix-security-privacy-extensions.md
- 2026-07-20-05-fix-ui-css-touchups.md
- 2026-07-20-04-fix-content-extractor-cleansing-config.md
- 2026-07-20-03-fix-i18n-module-separation.md
- 2026-07-19-02-fix-anond-whitelist-adapter.md
- 2026-07-19-01-fix-ai-duration-measurement.md
- 2026-07-18-36-feat-automate-third-party-notices.md
- 2026-07-18-35-fix-barrel-reexport-deprecation-notice.md
- 2026-07-18-34-fix-log-source-auto-completion.md
- 2026-07-18-33-feat-message-protocol-versioning.md
- 2026-07-18-32-fix-recording-pipeline-factory-extraction.md
- 2026-07-18-31-fix-wa-sqlite-exact-version-pin.md
- 2026-07-18-30-fix-consolidate-duplicate-i18n-modules.md
- 2026-07-18-29-fix-optimistic-lock-cas-reverification.md
- 2026-07-18-28-fix-pending-sqlite-queue-batch-insert.md
- 2026-07-18-27-fix-log-retention-quota-separation.md
- 2026-07-18-26-feat-mobile-offscreen-queue-limit.md
- 2026-07-18-25-fix-remove-noop-optimistic-lock-save-sqlite.md
- 2026-07-18-24-fix-tab-switch-focus-movement.md
- 2026-07-18-23-fix-permissions-page-i18n.md
- 2026-07-18-22-fix-dashboard-tablist-aria-roles.md
- 2026-07-18-21-fix-dashboard-html-lang-attribute.md
- 2026-07-18-20-fix-session-store-storage-backend.md
- 2026-07-18-19-fix-storage-quota-unlimited-storage-check.md
- 2026-07-18-18-fix-migration-backup-columns-coverage.md
- 2026-07-18-17-fix-crypto-random-log-id-fallback.md
- 2026-07-18-16-feat-plural-locale-support.md
- 2026-07-18-15-feat-readme-architecture-and-privacy-section.md
- 2026-07-18-14-fix-uuid-override-range.md
- 2026-07-18-13-fix-popup-width-responsive.md
- 2026-07-18-12-fix-content-script-sender-validation.md
- 2026-07-18-11-fix-consent-state-changed-sender-validation.md
- 2026-07-18-10-fix-remove-dead-history-panel-code.md
- 2026-07-17-09-feat-audit-log-tsv-download.md
- 2026-07-17-08-dashboard-opfs-migration-status.md
- 2026-07-16-07-decide-opfs-migration-v2-removal.md
- 2026-07-16-06-fix-idb-fallback-subframe7536-migration.md
- 2026-07-16-05-fix-sqlite-message-type-unification.md
- 2026-07-16-04-fix-adr014-file-references.md
- 2026-07-16-02-fix-architecture-knowledge-graph-findings.md
- 2026-07-13-03-fix-sqlite-history-panel-deepening.md

## 集計

| 状態 | 件数 |
|---|---|
| ⬜ 未着手 | 4（保留候補 01-03 = トリガー待ち 3 / wasqlite sunset = ADR-014 ゲート待ち 1） |
| 🟪 審査待ち | 1（AMO 公開 01 = 提出・審査中。通過後の署名版インストール確認・FAQ 記載はユーザー作業） |
| 🔵 監視 | 1（VulnHunt 11 defense-in-depth = 発火条件監視・発火時に分割 PBI 化） |
| **`pbi/` 残存 PBI 合計** | **6（＋ live 台帳 4 件: future / vuln-remediation / archloop-0924 / analysis-features）** |
| アーカイブ済みPBI | 947（`00-backlog` 台帳 76 件を除く） |
| アーカイブ済み実装計画 | 138 |

※ 2026-09-24 整理: 完遂ラウンドの台帳 3 件（archloop-0923 / archloop-0923b / archloop-0923c）を `dev-docs/archived/pbi/` へアーカイブ。各ラウンドの未採用候補（ProviderSlotRunner・queryPlan・CleansingRuleView・KeyDerivation・Retry-policy）は 2026-09-23 時点で future.md 統合台帳へマージ済みのため、台帳に live な追跡項目はない。INDEX 集計表を現状に再同期し、future.md・アーカイブ履歴の台帳リンクをアーカイブ先へ張替え。

※ 2026-09-22 整理: 完遂ラウンドの台帳 10 件（post-v699 / review-fixes / review-findings-r3 / arch-review-0917b / arch-review-0917c / archloop-0917 / holistic-0918 / archloop-0918-17to19 / archloop-0921b / archreview-0920）を `dev-docs/archived/pbi/` へ移動（archloop-0918 は同日第5ループ台帳と同名のため `-17to19` 接尾辞）。完了ラウンドの節を「進行中」から「アーカイブ履歴」へ移動し、2026-09-22 保留候補 3件を INDEX に追加。

※ 2026-09-23 整理: 完遂ラウンドの台帳 8 件（archloop-0915 / archloop-0915b / arch-review-0917 / holistic-0918b / holistic-0918c / archloop-0921 / holistic-0921 / firefox-support）をアーカイブし、未採番候補 7 件（合成ルート深掘り・MAX_PROVIDERS・utils 物理再配置・formatBytes 双子・console→logger・P3・P4）を future.md 統合台帳にマージ。同日、採点内容が各 PBI 本体と本 INDEX に重複する台帳 2 件（rust-wasm-tagcooccur・2026-09-22-00 backlog）を削除。live 台帳は 2 件（future.md / vuln-remediation）。

※ 2026-08-18: PBI-27（trustDb 6モジュール分解）を実装完了・アーカイブ。2026-08-17〜18のアーキテクチャレビュー由来の全PBIが完了。
※ 2026-08-18: plans/2026-08-01-1903-review-yasumaro.md（プロジェクト全体レビュー）を再精査。High 5件中4件・Medium多数は既存リファクタリングで解消済みと確認。低コスト3件（npm audit fix、models-dev-dialog stored XSS、PRIVACY_POLICY_VERSION失効）を修正。CI lint導入は既存83件のESLintエラーが障壁のため新規PBI-2026-08-18-01として切り出し。

※ 2026-08-17: アーキテクチャレビュー由来の14PBIを追加（06〜19）。00〜05は前回セッションから残存。
※ 2026-08-17: アーキテクチャレビュー第2弾由来の6PBIを追加（29〜34）→ 実装完了・アーカイブ済み（2026-08-17）
※ 2026-08-17: アーキテクチャレビュー第3弾由来の6PBIを追加（35〜40）→ 実装完了・アーカイブ済み（2026-08-18）。採点根拠と既存PBIとの重複は [00-backlog-architecture-deepening-batch3.md](../dev-docs/archived/pbi/2026-08-17-00-backlog-architecture-deepening-batch3.md)（アーカイブ済み）を参照。
※ 2026-08-17: 着手状況の全数調査を実施（Explore並列4本）。01〜28のうち13件が受け入れ基準を満たしアーカイブ、8件が部分実装と判明（INDEX表に🔶注記）、35〜40は新規のため全件未着手を確認。
※ 2026-08-18: PBI-01/28/23/39を実装完了・アーカイブ。部分実装の🔶注記は全て解消。親epic（00-epic-architecture-deepening-aug17.md）も子PBI全完了によりアーカイブ済み。

### 2026-08-17 アーキテクチャレビュー第2弾アーカイブ済み（6件）

PBI-29〜34。アーキテクチャレビュー（post-実装）で再スキャン実施済み。

- 2026-08-17-29-refactor-collapse-sqlite-read-seam.md (SQLite読み取りをStorageQuery値オブジェクトに統合、query/searchを単一化。IdbVfsBackend/OPFS Worker/Fallback/Noopの4アダプタをStorageQuery対応に、契約テスト追加)
- 2026-08-17-30-refactor-split-opfs-worker-god-module.md (opfsWorker 945行をreadOnlyHandler/coreCrudHandler/maintenanceBatchHandlerの3ハンドラに分割、Workerプロトコルに型付け)
- 2026-08-17-31-fix-queue-retry-duplication.md (キュー2つのリトライ再実装をflush()へ統合、pendingSqliteQueueにmax-retry付与)
- 2026-08-17-32-refactor-extract-obsidian-client-validators.md (ObsidianClient内の純関数バリデータを抽出し設定構築を一元化)
- 2026-08-17-33-refactor-unify-backend-resolver.md (バックエンド選定をBackendResolverに一元化しopfsCapabilitiesを接続)
- 2026-08-17-34-refactor-derive-cleansing-option-types.md (クレンジング型をCLEANSING_RULESから導出し手書き32フィールドを廃止)

### 2026-08-09 アーキテクチャレビュー由来（20〜24）の実施順と依存

アーキテクチャレビュー（候補01→03→04→02→05）に対応する。

```
20（候補01・ルール宣言）      ← 18の続き。✅ 完了（アーカイブ済み）
  ↓
21（候補03・変更系Result）    ← 19の続き。✅ 完了（アーカイブ済み）
  ↓
22（候補04・浅いパネル）      ← ✅ 完了（アーカイブ済み）
  ↓
24（候補05・逆依存）          ← PBI-09の後継。✅ 完了（アーカイブ済み）
  ↓
23（候補02・トランスポート）  ← 21が前提。✅ 全Phase完了（アーカイブ済み）
```

20〜24 の実装計画は完了に伴い `dev-docs/archived/plans/` へ移動済み。
