# PBI: E2E プローブがページ側 DOM 経由でユーザー設定と記録状態を露出するのを止める

- 種別: fix
- RICE: 3.6（R3 × I2 × C0.9 / E1.5）
- 依存: なし（他 PBI とファイル非重複で並列可。E2E テストのヘルパーを更新するため `testDir/` を触る唯一の PBI）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）Blue Team Leader Medium

## ユーザーストーリー

プライバシー重視のユーザーとして、任意の Web ページが拡張の E2E フックを起動して、自分の保存設定や「このページが記録対象になったか」を読み取れないでほしい。なぜなら現状はページ側が付与できる DOM 属性がトリガになっており、プローブ出力もページ共有 DOM に書かれるから。

## 背景（現状・証拠）

- トリガ判定: `src/content/contentKernel.ts:64-66` — `document.documentElement.hasAttribute('data-ow-e2e-test')`。**低信頼側（Web ページ）が自分の `<html>` に付与できる属性**で決まる。
- 出力: `src/content/e2eTestState.ts:30-36` — `document.documentElement.setAttribute('data-ow-test-state', JSON.stringify(state))`。publish 呼び出しは `src/content/contentKernel.ts:215-224` / `:230-233` / `:318-319`。
- プロダクションビルドにも `publishE2eTestState()` がそのまま入っており、ビルド時の除去も無い。
- ページ側 JS から読める情報:
  - `minVisitDuration` / `minScrollDepth` — ユーザーが保存した「最小滞在時間・最小スクロール深度」（`visitGating.ts:163-166` で settings から読込）。拡張設定の外部オリジンへの開示・フィンガープリント材料。
  - `isValidVisitReported` / `duration` / `maxScrollPercentage` — そのページが記録対象になったかどうか。ページは「あと何秒・何%で記録が発火するか」を正確に知り、記録を誘発／回避するよう振る舞いを調整できる（visit gate のゲーム化）。
- isolated world の `window.__OW_TEST_STATE` はページから見えないが、DOM 属性は共有される。
- `src/content/loader.ts:59-63` のコメントは「E2E 属性だけでは domain filter を bypass できない」ことのみを担保しており、プローブ出力の露出は塞いでいない。

## BDD 受け入れシナリオ

```gherkin
Scenario: ページが属性を付けてもユーザー設定が露出しない
  Given 任意のページが <html data-ow-e2e-test> を付与している
  When コンテンツスクリプトが動作する
  Then ページ側 DOM に minVisitDuration / minScrollDepth が書かれない

Scenario: ページが属性を付けても記録発火の可否が露出しない
  Given 任意のページが <html data-ow-e2e-test> を付与している
  When visit gate が判定する
  Then ページ側 DOM に isValidVisitReported / duration / maxScrollPercentage が書かれない

Scenario: E2E テストは従来どおり状態を観測できる
  Given E2E ハーネスが拡張側の制御経路でプローブを有効化する
  When テストが状態を読み取る
  Then 拡張側（storage / runtime メッセージ / 拡張ページ）から従来と同じ情報が得られる
```

## 設計決定（2026-10-11 autonomous-task-closer 実装）

C8 案を以下の形で確定した。`isE2E` はプローブ publish のゲートであることのみに使い、
記録動作（VALID_VISIT 判定・report）には一切影響しないことを実コードで確認した
（`deadlineTimer.isE2E` に外部消費者はいない）。

1. **有効化**: `chrome.storage.session` の `owE2eProbeEnabled` フラグ
   （`src/content/e2eTestState.ts` の `E2E_PROBE_ENABLE_KEY`）。
   ページは chrome API を持たないため書けない。harness は SW 経由で書く。
   kernel は `init()` で一度だけ解決し `VisitGating` に載せる（従来の once 契約を維持）。
   明示注入（`opts.isE2ETest`）は単体テスト用に不変。
2. **出力**: `owE2eTestState` session キー + isolated-world の `window.__OW_TEST_STATE`
   のみ。`data-ow-test-state` 書き込みは削除（`publishE2eTestState` は session
   書き込み失敗時も例外を出さない）。harness の読み取りは
   `testDir/e2e/fixtures/e2eProbe.ts`（`enableE2EProbe` / `readE2EProbeState` /
   `waitForE2EProbeInit`）経由の SW evaluate へ移行。4 spec を移行
   （content-script-recording / recording-traceId / overcut-guard-recording /
   archive-recommended-verification）。regenerate-summary は状態読みが無いため不変。
   テストページ HTML の `data-ow-e2e-test` は残置（今は inert＝属性だけでは何も起きない
   ことの E2E レベル回帰網になる）。
3. **本番除去**: `__OW_E2E_PROBE__` define（`wxt.config.ts`、`__OW_BENCH__` と同一 pattern）。
   既定 true（CI/ローカル E2E は `npm run build` のまま動く）。
   ストア出荷は `OW_E2E_PROBE=0` で死滅させるよう `release.yml` の 3 zip 手順に env 追加。
4. **変更ファイル**: `src/content/e2eTestState.ts` / `contentKernel.ts` / `loader.ts`、
   `wxt.config.ts`、`testDir/e2e/fixtures/e2eProbe.ts`（新規）、4 spec、
   単体 7 件更新 + `contentKernel.e2eProbeIsolation.test.ts`（新規）。
   新規 content モジュールは作らないため manifest 変更なし。

## 受け入れ基準

- [x] E2E プローブの有効化を、ページ側 DOM 属性ではなく拡張側が制御する経路にする（`chrome.storage.session` の `owE2eProbeEnabled` フラグ。kernel `init()` で一度だけ解決）
- [x] プローブ出力をページ共有 DOM 以外へ移す（`owE2eTestState` session キー + isolated `window.__OW_TEST_STATE`）。`data-ow-test-state` をページ DOM に書かない（通常ビルドの bundle grep で文字列不在を確認）
- [x] 本番ビルドからテスト専用コードを落とす（`__OW_E2E_PROBE__` define。`OW_E2E_PROBE=0` ビルドで probe 文字列が bundle から消えることを確認し、`release.yml` の 3 zip 手順に env を追加）
- [x] E2E ハーネス（`testDir/e2e/fixtures/e2eProbe.ts` 新規 + 4 spec 移行）を新しい制御経路に合わせて更新する
- [ ] 既存 E2E テスト（拡張 `@extension` / interaction / usability プロジェクト）が green のまま
- [x] 「ページ側 DOM に設定値と記録状態が現れない」ことを検証する回帰テストを追加する（`contentKernel.e2eProbeIsolation.test.ts` 新規 + `e2eTestState.test.ts` 拡張）
- [x] `npm run validate` が green

## テスト戦略

- unit: `contentKernel` の E2E 判定がページ属性に依存しないこと、`e2eTestState` の publish 先がページ DOM でないことを検証
- unit: ページ属性を付与しても `minVisitDuration` / `minScrollDepth` / `isValidVisitReported` が DOM に出ないことを検証
- E2E: 既存の拡張 E2E スイートが新経路で green（`npm run test:e2e` の対象プロジェクト）
- 回帰: `contentKernel` / `visitGating` / `loader` 系の既存テストが green

## 見積もり

1.5 SP（制御経路の差し替え 0.5 + 出力先の移動 0.5 + E2E ヘルパー更新 0.5）

## 技術的考慮事項

- 制御経路は「拡張側だけが書ける場所」である必要がある。ページが書ける `chrome.storage.session` は無いので storage フラグは安全だが、**E2E ハーネスがどうやって書くか**（拡張の service worker へメッセージを送る、offscreen/テスト用ページから書く）を先に設計する
- 出力先を storage にすると publish のたびに書き込みが増える。E2E 有効時のみ書く（`isE2E` ゲートは維持）
- E2E は `--grep @extension` の CI 経路がある。ローカルで全 E2E が重い場合は対象プロジェクトを絞って確認し、最後に `npm run test:e2e` を通す
- 本番ビルドからの除去は `wxt.config.ts` の define を使うのが素直（既存の define 慣習を確認する）

## 実装者向け注記

### 実装手順

1. 現在の E2E がどうやって属性を付け、どうやって状態を読んでいるかを `testDir/` で確認する（変更範囲の確定）
2. 新しい制御経路と出力先を決める（設計を PBI に記録）
3. 失敗するテストを先に書く（ページ属性で設定が露出することを pin する Red）
4. 実装 → E2E ハーネス更新 → Green
5. `npm run validate` と対象 E2E

### 落とし穴

- E2E ハーネスを更新しないと E2E が全滅する。`grep -rn "data-ow-e2e-test\|data-ow-test-state" testDir/ src/ entrypoints/` で全参照を洗う
- `visitGating.ts` のロード値そのものを消さない（消すと visit gate が壊れる）。露出経路だけを塞ぐ
- テストで実時間待ちを入れない（E2E は `expect.poll` を使う）

## Definition of Done

- [x] ページ側 DOM にユーザー設定・記録状態が現れないことをテストで確認
- [ ] E2E が新経路で green
- [x] `npm run validate` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 autonomous-task-closer）

- `npx tsc --noEmit` exit 0
- `npm run type-check:test:baseline` — 463（pinned 463、exit 0）
- `npx eslint`（変更 18 ファイル） exit 0
- `npm run validate` exit 0（Test Files 1056 passed / Tests 15960 passed）
- `npm run build`（既定）exit 0 — bundle に `owE2eProbeEnabled` / `owE2eTestState`
  あり、`data-ow-test-state` / `data-ow-e2e-test` 文字列なし
- `OW_E2E_PROBE=0 npx wxt build` exit 0 — probe 文字列すべて不在（死滅確認）
- E2E 再実行は未実施（当環境に display / Playwright ブラウザがなく headed 実行不可）。
  実装手順: `npm run build` 後に headed 環境で
  `npx playwright test --config testDir/playwright.config.ts --grep @extension`
  （CI の extension/a11y/usability ジョブでも検証される）。green を確認したら
  上の残り 2 項目を `[x]` にしてアーカイブすること。

## 着手メモ（2026-10-11 / 未着手の理由と手順）

本 PBI は 2026-10-11 のセッションでは**意図的に未着手**（他の NN01-NN07, NN09, NN10 は
完了・アーカイブ済み）。理由と手順は live 台帳の **C8** に記録した。要点:

- 変更規模: `data-ow-e2e-test` / `data-ow-test-state` の参照が **18 箇所**（E2E 仕様 6 ファイル、
  テストページ HTML、単体テスト `extractor-comprehensive.test.ts`）に及び、出力先の移設は
  E2E ハーネスの読み取り経路そのものの付け替えになる
- 検証手段: 正しさは E2E スイートの再実行でしか確認できない（`npx playwright test
  --repeat-each=10 --retries=0`）。部分実装は E2E を壊すリスクが利得を上回る
- 残っている実害: ページ側から `minVisitDuration` / `minScrollDepth`（ユーザー設定）と
  `isValidVisitReported` / `duration` / `maxScrollPercentage`（記録状態）が読める。本番でも
  有効な経路なので優先度は高い
- 進め方の案: (1) 発火を拡張側制御チャネル（`chrome.storage.session` のフラグを E2E が
  service worker 経由で設定）へ移す (2) 出力をページ共有 DOM から拡張側へ移す
  (3) E2E の読み取りを `context.serviceWorkers()[0].evaluate(...)` へ移行
  （`minVisitDuration` を閾値に使う 2 箇所は既知定数 5 に置換可） (4) E2E 再検証 (5) 単体テスト更新

