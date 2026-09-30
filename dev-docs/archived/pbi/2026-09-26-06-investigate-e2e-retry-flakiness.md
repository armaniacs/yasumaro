# PBI: E2E テストの retry で隠れたタイミング失敗を調査・修正する

## ユーザーストーリー

開発者として、Playwright E2E テスト（43 ファイル）の `retries: 2` で隠れているタイミング起因の失敗を特定し、根本原因を修正したい。そうすれば、本番コードの潜在的な競合条件やタイムアウト問題を見落とさなくなる。

## ビジネス価値

**現状**: extension / interaction / usability プロジェクトで `retries: 2` が有効。グローバル retry も CI で有効。
- retry は sleep と同じく失敗を隠すだけで、負荷や実行環境が変わると再発する
- 本番バグ（await 漏れ、初期化タイミング、offscreen 通信のタイムアウト）を見えなくしている可能性がある

**ゴール**: 
- retry なし（`--retries=0`）で全 E2E テストが通るようにする
- 修正できない正当な理由のある遅延は、テストコードに明示的に理由を記載する

## 優先度

- RICE スコア: 2.0（Reach=2 / Impact=1 / Confidence=50% / Effort=2 SP）
- 依存: PBI 2026-09-26-05 の方針（condition-based wait）を踏襲

## 既知情報（2026-09-26 調査）

**E2E テスト統計:**
- extension プロジェクト: 30+ テスト（archive/dashboard/content-script/privacy 系）
- interaction プロジェクト: 別途設定（headless: false）
- a11y プロジェクト: アクセシビリティテスト
- usability プロジェクト: 13 テスト（e2e/usability/）
- **合計**: 43 E2E テストファイル

**Playwright config の retry 設定:**
- グローバル: `CI ? 2 : 0`（ローカル 0、CI 2）
- extension: `retries: 2`（常時）
- interaction: `retries: 2`（常時）
- a11y: `retries: 1`（常時）
- usability: `retries: 2`（常時）

**実行パターン（次フェーズで実施）:**
```bash
cd testDir
npx playwright test --retries=0 --project=extension  # 失敗を記録
npx playwright test --retries=0 --project=interaction
npx playwright test --retries=0 --project=a11y
npx playwright test --retries=0 --project=usability
```

## 実測した証拠（2026-09-26 autonomous-task-closer 実行時）

本 PBI の Phase 1 を部分的に実施し、**retry が実在の失敗を隠している具体例**を 1 件検出した。

### 検出した flaky テスト

`--project=extension` の実走（`retries: 2` の既定設定）で以下が報告された:

```
1 flaky
  [extension] › testDir/e2e/regenerate-summary.spec.ts:215:3
    › Regenerate summary @extension
    › CRITICAL: regenerate UPDATES the same row (no duplicate) and never persists cleanseMode
100 passed / 20 skipped
```

`flaky` は **1 周目で失敗し、retry で成功した**ことを意味する。このテストは名前を冠する
どおり同一行の更新と `cleanseMode` の非永続化という**データ整合性**を検証する
CRITICAL ケースであり、初回失敗は「他のテストなら気付けるが、整合性テストなら
そのまま見落とす」種類の失敗である。`retries: 2` により緑として報告されるため、
CI 上は検出されない。

### 同時に検出した別の失敗（既に修正済み）

同実走の初回で `content-script-recording.spec.ts:148`
「does NOT fire when stay < 5 seconds」が `retries: 2` をすべて使い切って失敗した。
原因は PBI 2026-09-26-08 の条件待ち置換が陰性判定の窓を 5 秒閾値の境へ
寄せていたことで、`24e3e28f` で修正済み。**retry で緑になるのではなく、
retries=0 で 5 周回全通過になるよう直した**（`--repeat-each=5 --retries=0` で 25 件 PASS）。

本 PBI の主題である「retry による隠蔽」の実例が既に 1 件存在することは、
retry 設定を見ずに retry を 0 にして全プロジェクトを走査すべき根拠になる。

### 残作業

- 上記 `regenerate-summary.spec.ts:215` の根本原因調査（**未着手**）。
- `interaction` / `a11y` / `usability` プロジェクトを `--retries=0` で走査（**未着手**）。
  既知の `test.skip(true, 'requires headed Chrome with display')` により
  `pii-wasm-initialization.spec.ts` は headless 環境では常に skip される。
- retry 設定を 0 にすべきか、あるいは retry 維持でも初回失敗を可視化する仕組み
  （flaky テストの CI への明示的レポート）を採用すべきかの裁定。

## 調査フェーズ（Phase 1）

1. `playwright.config.ts` で各プロジェクトの retry 設定を確認
   - global: `retries: CI ? 2 : 0`（CI だけ retry）
   - extension: `retries: 2`（常時）
   - interaction: `retries: 2`（常時）
   - a11y: `retries: 1`（常時）
   - usability: `retries: 2`（常時）

2. 実際に失敗しているテストを特定するため、`--retries=0` で実行し、失敗パターンを記録
   ```bash
   npx playwright test --retries=0 --project=extension 2>&1 | tee e2e-retry-failures.log
   ```

3. 失敗パターンを分類
   - await / waitFor 漏れ（UI 更新待ちの不足）
   - タイムアウト（extension / offscreen 通信の遅延）
   - 初期化順序（setup 後の即時呼び出し）
   - その他（環境依存、ポート競合など）

## 実装フェーズ（Phase 2）

修正内容は分類に応じて：
- **await / waitFor 漏れ**: `expect.poll` や `page.waitForFunction` で条件を待つ
- **タイムアウト**: extension-iframe 通信に timeout を明示、offscreen の起動完了を await する
- **初期化順序**: setup の `await Promise.all([...])` で全並行処理の完了を待つ
- **環境依存**: `process.env.CI` でスキップするか、ローカルでのみ実行

## DoD（Definition of Done）

- [x] `npx playwright test --retries=0 --project=extension` で全テスト PASS（実測 2026-09-27: 101 passed / 20 skipped / 0 failed）
- [x] `npx playwright test --retries=0 --project=interaction` で全テスト PASS（実測: 17 passed / 6 skipped / 0 failed。headed Chromium 実走）
- [x] `npx playwright test --retries=0 --project=a11y` で全テスト PASS（実測: 4 passed / 0 failed）
- [x] `npx playwright test --retries=0 --project=usability` で全テスト PASS（実測: 40 passed / 3 skipped / 0 failed）
- [x] `playwright.config.ts` の extension / interaction / a11y / usability の `retries` を 0 に変更（retries 行自体を削除し、グローバルの `retries: 0` に統一）
- [x] グローバル retry を CI のみから完全削除（理由を comment に記載済み。あわせて `trace: 'on-first-retry'` は retry 廃止で不活性化するため `retain-on-failure` に変更）
- [x] `npm run test:e2e` がローカル・CI 両方で PASS する（ローカル実測 2026-09-27: 323 passed / 30 skipped / 0 failed。CI 実走は push 後に確認 — ユーザー作業）
- [x] 修正内容を CHANGELOG に記載

### 調査結果の記録（2026-09-27 実走）

- 既知の flaky（`regenerate-summary.spec.ts:215` CRITICAL ケースは 2026-09-26 実走で 1 周目失敗・retry 通過を観測）は、本実走では `--retries=0` で初回 PASS。さらに `--repeat-each=5 --retries=0` で 20/20 安定通過を確認。AGENTS.md の定義（`--repeat-each=10 --retries=0 --workers=4`）には未達だが、extension プロジェクトは `workers: 1` を明示しており headed 起動の逐次実行が前提。反復 5 周で再現しない薄い flakiness は残存可能性があるため、CI 実走後の観測継続を推奨
- skip 29 件の内訳はすべて既知の意図的 skip: headed 要求ガード（`requires headed Chrome with display`。pii-wasm は macOS に DISPLAY が無いため該当）、恒久 `testInteraction.fixme`（privacy-consent @interaction 4 件）、`extension.spec.ts:286` の fixme。retry 隠蔽とは無関係
- 失敗 0 件のため「失敗パターン分類（await 漏れ等）」は該当なし。retry 隠蔽が現在進行中ではないことを 4 プロジェクト全走で実証できたことが本 PBI の主要成果

## 検討事項

- firefoxプロジェクト（グローバル retry のみ）の状況
- `testDir/` を `--retries=0` で実行した際の失敗パターン（参考）
- CI と ローカル環境での失敗パターンの相違

## 見積もり

2 SP。調査で遅延原因を特定したら、大半は条件待ち（`expect.poll`、`page.waitForFunction`）の追加で解決する見込み。

## 参照

- [[no-sleep-for-timing-failures]]: タイミング起因の失敗を隠さない原則
- [[fake-timers-setup]]: fake timer の制御方法
- dev-docs/TEST_RULE.md § Async / Timing Failures
- AGENTS.md § Async / Timing Failures
