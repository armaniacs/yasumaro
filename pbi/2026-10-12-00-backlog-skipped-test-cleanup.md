# Backlog: skipped test の棚卸しと再発防止（skipped-test-cleanup） ― ✅ 4件完了（2026-10-12 ラウンド2 で実装・アーカイブ済み）

autonomous-task-closer（2026-10-12）が残課題として報告した「skipped test 4 箇所」を入力に、
pbi-backlog-prioritizer で候補を再列挙・RICE 採点して PBI 化したラウンド。

**実行結果（2026-10-12 ラウンド2）**: W1（01 / 02 / 03）はサブエージェント3体で並列実行、W2（04）は 02 完了後の直列実行で完了。全 4 件 `npm run validate` exit 0（1061 files / 16029 tests passed・skipped 0）でアーカイブ。個別 PBI は `dev-docs/archived/pbi/` へ移動済み（INDEX 進行中セクションとアーカイブ履歴を参照）。

- 入力: 2026-10-12 の残課題報告（`robustness-data-integrity.test.ts` / `RecordingPipeline.test.ts` /
  `recordingPipeline-full.test.ts` / `recordingCache-settingsCache.test.ts` の skip）
- 実測で判明した範囲の訂正: ユニットテスト側の**無条件宣言形 skip は 10 件 + 空 `describe.skip` 1 件**
  （当初報告の「4 箇所」はファイル数。うち 1 件は NN01 が再活性化、9 件 + 空 describe を NN02 が削除）
- E2E（`testDir/`）の 8 件は実行時条件形のため候補から除外（下記）
- `manifest.test.ts` の 11 件は一度 S1 として台帳送りにしたが、同日中に**恒久 skip の実害（高リスク領域の
  検証が常時 skip・WAR 検証は early return で空振り）を実測**したため NN03 として昇格した。昇格に伴い
  RICE 1.8 > 1.6 のため lint ゲートを NN04 へ繰り下げた

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 今後1年の保守・利用での関与頻度（相対 1-10）
Impact: 3=実害解消 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小
Confidence: 1.0=コード・実測で確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| 01 | [recording-pipeline-obsidian-skip 再活性化](../dev-docs/archived/pbi/2026-10-12-01-test-reenable-recording-pipeline-obsidian-skip.md) | test | 2 | 1.0 | 1.0 | 0.25 | **8.0** | 0.25 | なし |
| 02 | [死んだ無条件 skip スタブ 9 件 + 空 describe 1 件の削除](../dev-docs/archived/pbi/2026-10-12-02-test-remove-dead-test-skips.md) | test | 2 | 0.5 | 1.0 | 0.25 | **4.0** | 0.25 | なし |
| 03 | [恒久 skip されている権限最小化テスト 11 件の復旧](../dev-docs/archived/pbi/2026-10-12-03-test-manifest-verification-permanently-skipped.md) | test | 3 | 1.5 | 0.8 | 2.0 | **1.8** | 2.0 | なし |
| 04 | [恒久 skip を検出する lint ゲート](../dev-docs/archived/pbi/2026-10-12-04-refactor-no-dead-test-skip-lint.md) | refactor | 3 | 1.0 | 0.8 | 1.5 | **1.6** | 1.5 | **02 の後** |

RICE = R × I × C / E。値は各 PBI 内「RICE」行と一致。03 と 04 は 1.8 対 1.6 のほぼ同点で、
同点時の裁定基準（リスク軽減効果 → 時間的緊急性）に従い 03 を先とした。

## 実行順（確定）とバッチ計画

RICE 降順。依存は 02 → 04。

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 / 02 / 03 | `RecordingPipeline.test.ts` の skip 再活性化 / 対象 3 ファイルの死んだスタブ削除 / manifest 検証の復旧 | 3 者ともファイル非重複。01 の `RecordingPipeline.test.ts` は 02 の削除対象 3 ファイルと別 |
| W2 | 04 | `eslint/rules` + `eslint.config.js` への lint ゲート追加 | 02 の完了（既存違反ゼロ）が前提 |

01 / 02 / 03 はファイル非重複のため並列可。04 のみ直列（依存）。

## 候補から除外したものと理由

- **E2E `testDir/` の `test.skip` 8 件** ― `test.skip(cond, reason)` の実行時条件形
  （`if (!process.env.CI && !process.env.DISPLAY)` / `testInfo.project.name !== 'firefox'`）。
  恒久 skip ではないため削除対象外。NN04 では**誤検知してはならない valid ケース**として固定する。
- **`manifest.test.ts` の 11 件** ― 一度 S1 として台帳送りにしたが、実測で恒久 skip（かつ WAR 検証が
  early return で空振り）と判明したため NN03 へ昇格した（S1 は消費済み）。

## 台帳送り（見送り・トリガー管理）

| # | テーマ | 理由 | 再検討トリガー |
|---|---|---|---|
| ~~S1~~ | ~~`src/__tests__/manifest.test.ts` の権限最小化テスト 11 件が恒久的に skip~~ | **2026-10-12 に NN03 として昇格・消費** | ― |
| S2 | E2E の `test.fixme` 7 件（headless 条件）と headed 専用 skip の実行保証 | `test.fixme(true, HEADLESS_FIXME_MESSAGE)` は headless で意図的に落とさない設計。headed CI で実際に走っているかの保証は別問題 | headed E2E の CI 実行状況を触る時 / `HEADLESS_FIXME_MESSAGE` 経路の見直し時 |
| S3 | `local/no-greedy-fake-timers` が `warn` のまま（既存 124 箇所） | 既存台帳の項目であり本ラウンドの対象外。NN04 と同じ「warn 導入 → 解消 → error 昇格」の型が使える | `useFakeTimers` を含むテストを触る時 / lint 警告バジェットを見直す時 |

## 共通ファイル（統合側が更新）

- `pbi/00-INDEX.md`、本台帳。
