# 積み残し全体実行計画 — 2026-08-30 時点バックログ横断

> Branch: `plan/0830-backlog-execution`（本計画策定ブランチ。実装は各 Wave ごとに `feat/fix` ブランチを切る）
> 作成日: 2026-08-30
> 対象: `pbi/00-INDEX.md` に残る未完了 PBI 全体（3系統横断）
> 前提: `main` @ `424fbd17`（PR #86 までマージ済み）、`npm run validate` green

---

## 1. Context — なぜ今この計画が必要か

- `pbi/` には **未完了のみ** が残る運用に移行済み。完了 13 件は `dev-docs/archived/pbi/` へ移動済み。
- しかし 3 系統（29 VulnHunter / 30 Cleansing / 31 UI Visibility）が併存し、RICE 尺度・Wave 提案・ファイル触接が系統ごとに分断されている。
- 本計画は **積み残し全体を1枚で俯瞰し、並列可能な Wave に再編して最短で閉じる** ためのマスタープラン。

---

## 2. 積み残し全体像（Single Source of Truth）

### 2.1 件数サマリ

| 系統 | 索引 PBI | 実体 PBI（未完了） | うち真に未着手 | 部分実装（実装は分離先で完了・再スキャン待ちで残置） |
|------|----------|-------------------|----------------|-------------------------------------------------------|
| 29 VulnHunter | 00 | 7 | **2**（06, 12） | 5（04, 08, 13, 14, 19）— 実装は PR #74-81/#79/#78/#77/#86 で完了、VulnHunter 再スキャンで解消確認後にアーカイブ |
| 30 Cleansing  | 00 | 14 | **14**（01-14 除く 15） | 0 |
| 31 UI Visibility | 00 | 0 | 0（01 は PR #84-85 でアーカイブ済み） | 0 |
| **計** | 3 | **21** | **16** | **5** |

> 真に手を動かすべきは **16 PBI**。部分実装 5 件は「再スキャン待ちの残置」であり、本計画では **Wave 0: 再スキャン＆アーカイブ判定** として扱う。

### 2.2 真に未着手 16 PBI の一覧（RICE 降順・系統内）

#### 29 系 — セキュリティ（高リスク・要慎重レビュー）

| # | PBI | タイトル | RICE | 規模 | 副作用 | 主な触接 |
|---|-----|----------|------|------|--------|----------|
| 29-06 | `2026-08-29-06-fix-trust-boundary-consistency.md` | 信頼境界一貫性（4迂回解消） | 1260 | 🟡 2pt | 🔴 | `src/content/loader.ts`, `offlineQueueProcessor.ts`, `readOnlyHandler.ts`, `tabContentFetcher.ts` |
| 29-12 | `2026-08-29-12-fix-crypto-policy-ssot.md` | 暗号・認証ポリシーSSOT＋HMAC先行化 | 453 | 🔴 3pt | 🔴 | `src/utils/crypto/*`, `masterPassword.ts`, `RateLimitService.ts`, `settingsExportImport.ts`, `exportLogsService.ts` |

#### 30 系 — クレンジング改善（独立・並列しやすい）

| 順位 | PBI | タイトル | RICE | 規模 | 副作用 | 触接の独立性 |
|------|-----|----------|------|------|--------|--------------|
| 30-12 | `2026-08-30-12-feat-cleansing-i18n-expanded-patterns.md` | 多言語パターン拡充 | 12.0 | 🟢 1日 | 🟢 | `patterns.ts` のみ — 完全独立 |
| 30-04 | `2026-08-30-04-investigate-cleansing-single-pass-benchmark.md` | 74回走査の1パス集約を計測検証 | 8.0 | 🟢 1日 | 🟢 | `aiSummaryCleaner/index.ts` + `scripts/benchmark*` — 計測のみ |
| 30-06 | `2026-08-30-06-feat-cleansing-presets.md` | 32トグルをプリセットに束ねる | 8.0 | 🟡 3日 | 🟢 | `entrypoints/options/*`, `aiSummaryCleansingSettingsV2.ts`, `presets.ts` — UI 中心 |
| 30-02 | `2026-08-30-02-feat-cleansing-semantic-classification.md` | クラス部分一致に依存しないセマンティック分類 | 6.3 | 🟡 2日 | 🟡 | `patterns.ts`, `helpers.ts`, `stripCore/Extended.ts` |
| 30-01 | `2026-08-30-01-feat-cleansing-readability-scoring.md` | Readabilityベース本文保護スコア | 4.8 | 🔴 3日 | 🟡 | `readabilityScore.ts`, `bodyProtection.ts` |
| 30-09 | `2026-08-30-09-test-cleansing-corpus-ci.md` | コーパスでCI検出 | 3.5 | 🟡 3日 | 🟢 | `test/corpus/`, `scripts/check-cleansing-corpus.mjs` — 土台 |
| 30-14 | `2026-08-30-14-refactor-cleansing-observability-funnel.md` | 観測性ファネル/理由分解 | 3.2 | 🟡 2日 | 🟢 | `contentExtractor/types.ts`, `index.ts`, `cleansedReason.ts` |
| 30-11 | `2026-08-30-11-feat-cleansing-transparency-dual-payload.md` | 二重ペイロード方式 | 2.0 | 🟡 3日 | 🟢 | `contentExtractor/types.ts`, `index.ts`, `cleansingStatsView.ts` |
| 30-13 | `2026-08-30-13-feat-cleansing-spa-dynamic-content.md` | SPA動的コンテンツ対応 | 1.67 | 🟡 3日 | 🟡 | `contentKernel.ts`, `extractor.ts` |
| 30-03 | `2026-08-30-03-feat-cleansing-shadow-dom-traversal.md` | Shadow DOM/iframe走査 | 1.5 | 🔴 3日 | 🟡 | `helpers.ts` + 各 strip |
| 30-07 | `2026-08-30-07-feat-cleansing-per-site-override.md` | ドメイン別オーバーライド | 1.44 | 🔴 5日 | 🟡 | `storage/types.ts`, `contentKernel.ts`, `popup` |
| 30-08 | `2026-08-30-08-feat-cleansing-feedback-loop.md` | 誤削除フィードバックループ | 0.96 | 🔴 5日 | 🟢 | `storage/types.ts`, `popup`, `dashboard` |
| 30-05 | `2026-08-30-05-feat-cleansing-offscreen-delegation.md` | Offscreen委譲 | 0.8 | 🔴 5日 | 🟡 | `offscreen.ts`, `pageContentPipeline.ts` — **保留候補** |
| 30-10 | `2026-08-30-10-feat-whitelist-adapter-auto-generation.md` | ホワイトリストLLM自動生成 | 0.48 | 🔴 5日 | 🟢 | `whitelistAdapters.ts`, `ai/`, `scripts/generate*` — **保留候補** |

> 29系と30系の RICE 絶対値は尺度が異なるため **系統を跨いだ RICE 比較はしない**。Wave は系統内 RICE＋依存で決める。

### 2.3 部分実装 5 PBI の扱い（Wave 0）

| PBI | 状態詳細 | アーカイブ条件 | 本計画での扱い |
|-----|----------|---------------|----------------|
| 29-04 storage RMW | 2/6 着地、残4は 29-16 で完了（`keySerializer.ts`） | VulnHunter 再スキャンで VULN-003/005/012/050 解消確認 | 再スキャンで確認 → 即アーカイブ |
| 29-08 resource caps | 3/7 着地、残は 29-17/18 で完了 | 再スキャンで VULN-004/041/051/053 解消確認 | 同上 |
| 29-13 import pipeline | AC1/4/5/6 着地、HMAC は 29-12 に統合 | 29-12 完了後に再スキャン | 29-12 完了を待って再スキャン |
| 29-14 code quality | AC2-6 着地、AC1 は 29-19 に分離 | 再スキャンで Code Quality 指摘解消確認 | 再スキャンで確認 → 即アーカイブ |
| 29-19 CSPValidator | 実装・テスト green（8ケース）、再スキャン待ち | Code Quality 指摘解消確認 | 同上 |

→ **Wave 0 で VulnHunter 再スキャンを1回実行し、5件の DoD を満たせるか判定する。満たせば即 `git mv` でアーカイブ。**

---

## 3. 実行戦略 — Wave 分割と並列性

### 3.1 原則

1. **系統間は完全独立** — 29系（background/content/crypto）と30系（cleansing）と31系（CSS済み）はファイル触接が重ならない。系統を跨いだ並列は常に安全。
2. **29系内は直列（高リスク）** — 29-06 と 29-12 はどちらもセマンティクス変更・暗号変更を含む。1ブランチずつ、レビューを挟んで直列に。
3. **30系内は Wave 化で並列** — `00-backlog-cleansing.md` の推奨 Wave を尊重しつつ、RICE 順＋Enabler 前倒しで再編。
4. **検証は `npm run validate` をゲートに** — 各 Wave 完了ごとに `type-check + validate (10839 tests)` を必須。

### 3.2 Wave 設計（推奨実行順）

```
Wave 0 : 再スキャン＆アーカイブ判定（1日・ブロッキングなし・即時）
  └─ 29-04 / 08 / 13 / 14 / 19 の再スキャン確認 → アーカイブ

Wave 1 : セキュリティ単独 ＋ クレンジング Enabler 並列（2-3日）
  ├─ Track A (security・直列): 29-06 trust-boundary（2pt）— 単独ブランチ `fix/trust-boundary-consistency`
  └─ Track B (cleansing・並列4): 30-12(i18n) / 30-04(benchmark) / 30-06(presets) / 30-09土台(corpus-ci)
       ※ 30-12 と 30-04 と 30-06 と 30-09 はファイル触接が disjoint → 4並列 subagent 可
       ※ 30-09 は「10サイト分のコーパス土台だけ先に」作る。以降の 01/02 の回帰ネットになる

Wave 2 : クレンジング中核（3-4日）
  ├─ 30-02 semantic-classification（2日）→ 30-01 readability-scoring（3日）の順
  │   ※ 01 と 02 は `bodyProtection.ts` / `helpers.ts` で競合するため直列
  │   ※ 09 の土台があれば回帰検出が安全
  └─ 29-12 crypto-SSOT（3pt）は Wave 1 の 29-06 完了後に着手（Wave 2 と並列可だがレビュー負荷を考慮し Wave 2.5 として分離推奨）
       ブランチ `fix/crypto-policy-ssot` — 暗号変更のため単独レビュー

Wave 3 : クレンジング観測性＆透明性（3-4日・並列可）
  ├─ 30-14 observability-funnel（2日）→ 30-11 dual-payload（3日）の順（ExtractResult 型で触接）
  ├─ 30-13 SPA dynamic（3日）— 独立、Wave 3 と並列可
  └─ 30-03 shadow-dom（3日）— 独立、Wave 3 と並列可

Wave 4 : 高 Effort・低 RICE（必要になったら・任意）
  ├─ 30-07 per-site-override（5日）
  └─ 30-08 feedback-loop（5日）

保留 : 30-05 offscreen委譲 / 30-10 whitelist自動生成
  └─ 30-04 の計測結果（Wave 1）で再評価。効果が裏付けられた場合のみ着手
```

### 3.3 ガント概算（Effort 合計）

| Wave | 含む PBI | Effort 合計 | 並列時カレンダ日数 | 備考 |
|------|----------|-------------|-------------------|------|
| 0 | 再スキャン5件 | 0.5日 | 0.5日 | 即時実行 |
| 1 | 29-06(0.2人月) + 30-12(1日)+04(1日)+06(3日)+09土台(1日) | ~0.2人月+6日 | **3日**（Bは4並列） | Track A/B 並列 |
| 2 | 30-02(2日)+01(3日) + 29-12(0.3人月) | ~0.3人月+5日 | **5日**（02→01 直列、29-12 は並列） | クレンジング中核 |
| 3 | 30-14(2日)+11(3日)+13(3日)+03(3日) | 11日 | **5日**（14→11 直列、13/03 並列） | 観測性・SPA・Shadow |
| 4 | 30-07(5日)+08(5日) | 10日 | **5-10日**（直列 or 並列） | 任意 |
| **小計（Wave 0-3 必須）** | 12 PBI + 再スキャン | ~0.5人月+22日 | **~13-14日** | 保留・Wave4 除く |
| 全体（Wave4含む） | 16 PBI | ~0.5人月+32日 | **~18-24日** | 保留2件除く |

> 1人月=20営業日換算。並列は subagent 4並列を想定。

### 3.4 ブランチ戦略

| Wave | ブランチ名 | ベース | マージ先 | 備考 |
|------|-----------|--------|----------|------|
| 0 | `chore/archive-vulnhunt-remaining` | main | main | 再スキャン結果を `dev-docs/archived/pbi/` へ `git mv` |
| 1A | `fix/trust-boundary-consistency` | main | main | 29-06 単独。PR でセキュリティレビュー必須 |
| 1B | `feat/cleansing-wave1-enablers` | main | main | 30-12/04/06/09 を1ブランチに束ねるか、4ブランチに分けて並列PR（推奨: 1ブランチ4コミットでレビュー負荷低減） |
| 2 | `feat/cleansing-semantic-readability` | main | main | 30-02→01 直列。1ブランチ2コミット |
| 2.5 | `fix/crypto-policy-ssot` | main | main | 29-12 単独。暗号レビュー必須、既存データ移行テストを含む |
| 3 | `feat/cleansing-observability-spa-shadow` | main | main | 30-14→11→13+03 並列。1ブランチ4コミット or 2ブランチ |
| 4 | `feat/cleansing-per-site-feedback` | main | main | 30-07+08。需要に応じて |

- 各ブランチは `git checkout -b <name> main` から作成。
- コンフリクト回避: 29系は `src/background/` / `src/content/` / `src/utils/crypto/`、30系は `src/utils/aiSummaryCleaner/` / `src/utils/contentExtractor/` / `entrypoints/options/` で触接が分離。Wave 1 の Track A/B はそもそもコンフリクトしない。
- 本計画ブランチ `plan/0830-backlog-execution` は **計画専用**。実装は含めず、計画書のみをコミットして PR 化 or main へ直接マージ。

---

## 4. 各 PBI の実装アプローチ（Outside-In / TDD 要点）

### 29-06 trust-boundary（2pt・高リスク）

- **Red**: 4経路の再現テストを先に書く（e2e属性注入・リプレイ force・confirm_token 読み取り・all_urls 要求）。現行で RED になることを確認。
- **Green**: loader 両ブランチ await 化 → offlineQueueProcessor force 解除 → confirm_token サブタイプ削除＆パーアクション発行 → 権限ラダー。1経路ずつ Green に。
- **Refactor**: senderTrust 網羅性テストを非メッセージ経路に拡張。
- **注意**: loader await 化で抽出タイミング遅延の回帰に注意。visitGate のタイミング要件をテストで担保。

### 29-12 crypto-SSOT（3pt・高リスク）

- **SSOT 抽出**: `cryptoParams.ts` に ITERATIONS=600k・ポリシー validator を集約。
- **付け替え**: settingsExport / password change / envelope の3 KDF 経路を SSOT 参照に。
- **KEK session-only 化**: `hmacKeyStore.ts` の local 書き込み削除、 `deriveHmacWrappingKey` リカバリ配線。
- **RateLimit 永続化**: `RateLimitService` を storage.local に。
- **HMAC 先行化統合**: 新形式は ciphertext 全体に HMAC、旧形式は互換読み込み。新規は新形式で書き出し。`exportLogsService` / `importLogsService` に署名ゲート追加。
- **DoD**: 旧 iterations 形式の読み込みテスト・暗号データ移行テスト必須。

### 30-12 i18n（1日・Quick Win）

- `patterns.ts` のみに多言語パターン追加。既存テストに多言語ケース追加。`validate` で回帰確認。

### 30-04 benchmark（1日・investigate）

- `scripts/benchmark-cleansing.mjs` を新設し、74回 `querySelectorAll` と1パス集約の性能差を実測。`dev-docs/` にレポート出力。30-05 の Go/No-Go 判断材料。

### 30-06 presets（3日）

- `presets.ts` 新設で32トグルを3-4プリセットに束ねる。`entrypoints/options/index.html` にプリセット UI、`aiSummaryCleansingSettingsV2.ts` でプリセット→個別トグルのマッピング。Playwright で保存→リロード検証。

### 30-09 corpus-ci（3日・Enabler）

- `test/corpus/` に10サイト分の HTML コーパス、`scripts/check-cleansing-corpus.mjs` でパターン衝突を CI 検出。`package.json` に `check:cleansing-corpus` 追加し `validate` に統合。以降の 01/02/12 の回帰ネット。

### 30-02 / 30-01（2日+3日・中核）

- 30-02: `isLikelyAd` の単語境界判定を他ヘルパに横展開。`helpers.ts` に決定木追加。
- 30-01: `readabilityScore.ts` を Readability 相当ロジックに置換。短文3パターンで保護成功率の改善をテストで示す。
- 順序は 02→01（02の方が局所的）。09 土台の上で実行。

### 30-14 → 30-11（2日→3日）

- 30-14: `ExtractResult` に `removed: Map<string, number>` と `reason` を追加しファネル可視化。
- 30-11: 同 `ExtractResult` を二重ペイロード（`cleansed` + `original`）に拡張。ダッシュボードで差分表示。
- 型で触接するため 14→11 の順。

---

## 5. 検証計画（Verification Before Completion）

### 5.1 ゲート

| ゲート | コマンド | 期待値 | 実行タイミング |
|--------|----------|--------|----------------|
| type-check | `npm run type-check` | PASS | 各 Wave コミットごと |
| validate | `npm run validate` | 10839 tests PASS（増加分含む） | 各 Wave PR ごと |
| build | `npm run build` | `dist/chromium-mv3` 生成 | 各 Wave PR ごと |
| e2e | `npm run test:e2e` | 既存 E2E PASS | Wave 1/2/3 で E2E 追加時のみ |
| corpus | `npm run check:cleansing-corpus` | 0 collision | 30-09 以降の全 Wave |
| vulnhunt | `graphify` or 手動再スキャン | VULN 対象の再現テストが GREEN→RED（解消） | Wave 0 / Wave 2.5 完了後 |

### 5.2 Definition of Done（各 PBI 共通）

- [ ] BDD シナリオが自動テストとして実装されパスする
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] 既存 E2E が回帰しない
- [ ] コードレビュー完了（29系はセキュリティレビュー必須）
- [ ] `pbi/00-INDEX.md` の該当行を削除し、`dev-docs/archived/pbi/` へ `git mv`、対応する plan があれば `dev-docs/archived/plans/` へ `git mv`、アーカイブ履歴に1行追記

---

## 6. リスクと Mitigation

| リスク | 影響 | Mitigation |
|--------|------|------------|
| 29-06 の loader await 化で抽出が空になる | e2e テスト失敗 | visitGate のタイミング要件をテストで担保。e2e スイートでキャッシュ事前投入パターンを維持 |
| 29-06 の confirm_token セマンティクス変更で UI 2段階フローが壊れる | ダッシュボード操作不能 | `dashboardSqliteService` の消費者を同時に更新し、E2E で一覧→確認→実行を検証 |
| 29-12 の暗号変更で既存ユーザーのアンロックが失敗 | データ喪失 | 旧 iterations 形式の互換読み込みテストを必須。新形式は「任意読み込み・既定600k書き込み」で段階移行。`CHANGELOG.md` と `PRIVACY.md` を更新 |
| 30-01 の Readability 置換で短文以外の回帰 | 本文誤削除の増加 | 09 のコーパス CI を先に土台化し、既存 `bodyProtection.test.ts` の期待値を新ロジックで更新しつつ 1000要素DOMで性能 2倍以内を担保 |
| 30-02 のセマンティック分類で誤爆が増える | 広告が残る | `address`/`admin`/`x-data` の誤爆0件を `patterns.test.ts` で保証しつつ、真の広告（sponsored テキスト/role）の削除も保証 |
| 並列 Wave でのコンフリクト | マージ時の手戻り | 系統間でファイル触接が disjoint であることを本計画で保証。同一ファイル（例: `ExtractResult`）を触る 14→11 は直列化 |

---

## 7. 次のアクション（本計画ブランチで即実行）

1. **本計画書をコミット** — `plan/0830-backlog-execution` ブランチで `dev-docs/plans/2026-08-30-backlog-execution-plan.md` をコミット。
2. **Wave 0 の即実行** — VulnHunter 再スキャン（または再現テストの GREEN→RED 確認）を実行し、29-04/08/14/19 のアーカイブ可否を判定。可能なら即 `git mv` でアーカイブ。
3. **Wave 1 の着手** — `fix/trust-boundary-consistency` と `feat/cleansing-wave1-enablers` を並列で着手。subagent 4並列で 30-12/04/06/09土台を同時実行。
4. **計画の可視化** — `pbi/00-INDEX.md` の「進行中」表は本計画の Wave 0-3 完了に応じて逐次更新。`dev-docs/plans/00-index.md` に本計画へのリンクを追記（任意）。

---

## 8. 付録 — トレーサビリティ（PBI → ブランチ → Wave）

| PBI | Wave | ブランチ | RICE | 依存 |
|-----|------|----------|------|------|
| 29-04 | 0 | `chore/archive-*` | 1440 | 再スキャンのみ |
| 29-08 | 0 | `chore/archive-*` | 1080 | 再スキャンのみ |
| 29-14 | 0 | `chore/archive-*` | 170 | 再スキャンのみ |
| 29-19 | 0 | `chore/archive-*` | 分離 | 再スキャンのみ |
| 29-06 | 1A | `fix/trust-boundary-consistency` | 1260 | なし（単独） |
| 30-12 | 1B | `feat/cleansing-wave1-enablers` | 12.0 | なし |
| 30-04 | 1B | `feat/cleansing-wave1-enablers` | 8.0 | なし（30-05 の前提） |
| 30-06 | 1B | `feat/cleansing-wave1-enablers` | 8.0 | なし |
| 30-09土台 | 1B | `feat/cleansing-wave1-enablers` | 3.5 | 01/02 の前提 |
| 30-02 | 2 | `feat/cleansing-semantic-readability` | 6.3 | 09土台後 |
| 30-01 | 2 | `feat/cleansing-semantic-readability` | 4.8 | 02後 |
| 29-12 | 2.5 | `fix/crypto-policy-ssot` | 453 | 29-06後推奨 |
| 30-14 | 3 | `feat/cleansing-observability-spa-shadow` | 3.2 | なし（11の前提） |
| 30-11 | 3 | `feat/cleansing-observability-spa-shadow` | 2.0 | 14後 |
| 30-13 | 3 | `feat/cleansing-observability-spa-shadow` | 1.67 | なし |
| 30-03 | 3 | `feat/cleansing-observability-spa-shadow` | 1.5 | なし |
| 30-07 | 4 | `feat/cleansing-per-site-feedback` | 1.44 | 任意 |
| 30-08 | 4 | `feat/cleansing-per-site-feedback` | 0.96 | 任意 |
| 30-05 | 保留 | — | 0.8 | 04計測後 |
| 30-10 | 保留 | — | 0.48 | スパイク後 |

---

## 9. 参考 — 関連バックログ索引

- [2026-08-29-00-backlog-vulnhunt-audit.md](../../pbi/2026-08-29-00-backlog-vulnhunt-audit.md) — 29系の RICE/なぜなぜ/Wave/TRACEABILITY の正本
- [2026-08-30-00-backlog-cleansing.md](../../pbi/2026-08-30-00-backlog-cleansing.md) — 30系の RICE/Wave/TRACEABILITY の正本
- [2026-08-31-00-backlog-ui-visibility.md](../../pbi/2026-08-31-00-backlog-ui-visibility.md) — 31系（完了済み1件、索引のみ残存）
- [pbi/00-INDEX.md](../../pbi/00-INDEX.md) — 全系統の進捗一覧（正）

> 本計画は上記3索引の Wave 提案を尊重しつつ、**系統を跨いだ並列（Track A/B）と Enabler 前倒し（09土台）** で最短化した統合版。
