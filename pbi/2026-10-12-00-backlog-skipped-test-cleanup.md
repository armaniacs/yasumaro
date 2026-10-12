# Backlog: skipped test の棚卸しと再発防止（skipped-test-cleanup）

autonomous-task-closer（2026-10-12）が残課題として報告した「skipped test 4 箇所」を入力に、
pbi-backlog-prioritizer で候補を再列挙・RICE 採点して PBI 化したラウンド。

- 入力: 2026-10-12 の残課題報告（`robustness-data-integrity.test.ts` / `RecordingPipeline.test.ts` /
  `recordingPipeline-full.test.ts` / `recordingCache-settingsCache.test.ts` の skip）
- 実測で判明した範囲の訂正: ユニットテスト側の**無条件宣言形 skip は 10 件 + 空 `describe.skip` 1 件**
  （当初報告の「4 箇所」はファイル数。うち 1 件は NN01 が再活性化、9 件 + 空 describe を NN02 が削除）
- E2E（`testDir/`）の 8 件と `manifest.test.ts` の 11 件は**形の上では skip だが事情が異なる**ため
  候補から除外し、台帳送りに分類した（下記）

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
| 01 | [recording-pipeline-obsidian-skip 再活性化](2026-10-12-01-test-reenable-recording-pipeline-obsidian-skip.md) | test | 2 | 1.0 | 1.0 | 0.25 | **8.0** | 0.25 | なし |
| 02 | [死んだ無条件 skip スタブ 9 件 + 空 describe 1 件の削除](2026-10-12-02-test-remove-dead-test-skips.md) | test | 2 | 0.5 | 1.0 | 0.25 | **4.0** | 0.25 | なし |
| 03 | [恒久 skip を検出する lint ゲート](2026-10-12-03-refactor-no-dead-test-skip-lint.md) | refactor | 3 | 1.0 | 0.8 | 1.5 | **1.6** | 1.5 | **02 の後** |

RICE = R × I × C / E。値は各 PBI 内「RICE」行と一致。

## 実行順（確定）とバッチ計画

RICE 降順。依存は 02 → 03。

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 | `RecordingPipeline.test.ts` の skip 再活性化 | 同ファイルを触る唯一の PBI |
| W2 | 02 | 対象 3 ファイルの死んだスタブ削除 | 01 とファイル非重複（01 完了後なら 02 の削除対象から 01 分が除外済み） |
| W3 | 03 | `eslint/rules` + `eslint.config.js` への lint ゲート追加 | 02 の完了（既存違反ゼロ）が前提 |

01 と 02 はファイル非重複のため並列可。03 のみ直列（依存）。

## 候補から除外したものと理由

- **E2E `testDir/` の `test.skip` 8 件** — `test.skip(cond, reason)` の実行時条件形
  （`if (!process.env.CI && !process.env.DISPLAY)` / `testInfo.project.name !== 'firefox'`）。
  恒久 skip ではないため削除対象外。NN03 では**誤検知してはならない valid ケース**として固定する。
- **`manifest.test.ts` の 11 件** — 下記の台帳送り参照。形は `describe.skipIf` 相当だが実態は恒久 skip。

## 台帳送り（見送り・トリガー管理）

| # | テーマ | 理由 | 再検討トリガー |
|---|---|---|---|
| S1 | `src/__tests__/manifest.test.ts` の権限最小化テスト 11 件が**恒久的に skip されている**。判定は `join(process.cwd(), 'manifest.json')` の存在（`manifest.test.ts:34`）だが、WXT 移行後 manifest は `dist/chromium-mv3/manifest.json` にのみ生成されるため常に false。`npm run build` 後でも skip されたまま | host_permissions は AGENTS.md が宣言する「破壊的変更の高リスク領域」であり、検証が無防備になっている。ただし修正は WXT の生成物パスに依存するテスト設計の変更で、本ラウンドの「skip の棚卸し」スコープを超える | 診断パネル権限表示を触る時 / `wxt.config.ts` の manifest 生成を触る時 / 次回の権限最小化レビュー時 |
| S2 | E2E の `test.fixme` 7 件（headless 条件）と headed 専用 skip の実行保証 | `test.fixme(true, HEADLESS_FIXME_MESSAGE)` は headless で意図的に落とさない設計。headed CI で実際に走っているかの保証は別問題 | headed E2E の CI 実行状況を触る時 / `HEADLESS_FIXME_MESSAGE` 経路の見直し時 |
| S3 | `local/no-greedy-fake-timers` が `warn` のまま（既存 124 箇所） | 既存台帳の項目であり本ラウンドの対象外。NN03 と同じ「warn 導入 → 解消 → error 昇格」の型が使える | `useFakeTimers` を含むテストを触る時 / lint 警告バジェットを見直す時 |

## 共通ファイル（統合側が更新）

- `pbi/00-INDEX.md`、本台帳。
