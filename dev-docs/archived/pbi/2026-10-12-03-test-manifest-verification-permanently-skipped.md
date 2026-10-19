# PBI: 恒久 skip されている権限最小化テスト 11 件を実行される検証へ戻す

- 種別: test
- RICE: 1.8（R3 × I1.5 × C0.8 / E2.0）
- 依存: なし（NN01 / NN02 とファイル非重複）
- 採番補足: 2026-10-12 に台帳送り S1 から昇格。RICE 1.8 > NN04 の 1.6 のため NN03 とした（NN04 は当初 NN03 だった lint ゲート）
- 出所: 2026-10-12 の autonomous-task-closer 報告 → `pbi-backlog-prioritizer` のラウンドで S1 として台帳送り → 同日昇格
- 台帳: `pbi/2026-10-12-00-backlog-skipped-test-cleanup.md`

## ユーザーストーリー

保守担当の開発者として、`host_permissions` / `optional_host_permissions` / `web_accessible_resources` の期待が自動で検証される状態に戻したい。なぜなら現在この 11 件は WXT 移行前の前提（リポジトリ直下の `manifest.json`）を見ており**恒久的に skip** されていて、AGENTS.md が「破壊的変更の高リスク領域」と明示する manifest 権限の検証が無防備なまま緑に見えるから。

## 優先度

- 順位: 3 / 4
- RICEスコア: 1.8（Reach=3 / Impact=1.5 / Confidence=0.8 / Effort=2.0）
- 根拠: 実害は未発生（リリース前の `release:check` が一部を代替）だが、高リスク領域の検証が常時 skip という「部分的に実害」の状態。Impact は中、Effort は中。NN04（lint ゲート、RICE 1.6）とはほぼ同点で、同点時の裁定基準（リスク軽減効果）でも本件が上。

## 背景（現状・証拠）

### 1. 恒久 skip の機序

- `src/__tests__/manifest.test.ts:34` ― `const manifestExists = existsSync(join(process.cwd(), 'manifest.json'))`、`:35` ― `const describeFn = manifestExists ? describe : describe.skip`。
- WXT 移行後、manifest は `wxt.config.ts` からビルド時に `dist/chromium-mv3/manifest.json` へ生成される。リポジトリ直下に `manifest.json` は存在しないため `manifestExists` は**常に false**。`npm run build` の後でも変わらない。
- 実測（2026-10-12、`npx vitest run --reporter=json`）: 本ファイルの skip は 11 件。`src/background` の 10 件と合わせてスイート全体の skip 21 件のうち 11 件を占める。

### 2. skip 対象のうち他でカバーされていないもの

`scripts/release-checks/check-manifest.mjs` は `dist/chromium-mv3/manifest.json` を検査し、MV3 準拠・必須 permission・`<all_urls>` 不在・CSP・icons 実在・WAR の `matches` 構造をカバーする。ただし:

- **CI 未配線**: `.github/workflows/ci.yml` が release-checks から呼ぶのは `check-privacy.mjs` のみ（`ci.yml:144`）。`check-manifest.mjs` は `npm run release:check` を人間が実行したときだけ走る。
- 以下は `check-manifest.mjs` の対象外で、現状**どのゲートでも検証されていない**:
  - `host_permissions` のドメイン数（<30）と総 permission 数（<100）
  - 既定 AI プロバイダドメインが**含まれる**こと / 追加プロバイダドメインが既定に**含まれない**こと / 追加側に**含まれる**こと
  - `localhost` と `127.0.0.1` の permission が含まれること
  - essential non-AI ドメインが `optional_host_permissions` に含まれること
  - **`web_accessible_resources` の import chain 完結**（`manifest.test.ts:171-198`）
  - **登録された `utils/*.js` が dist に実在すること**（同 `:200-220`）

### 3. WAR 側の assertion は既に前提がずれている（重要）

- `manifest.test.ts:172` は `dist/content/extractor.js` を見るが、現行のビルド出力は `dist/chromium-mv3/content-extractor.js`。
- さらに同テストは `if (!existsSync(entryPoint)) { console.warn(...); return; }` で**前提が無いと静かに pass する**（`:200-220` も同型）。`describe.skip` を外しても、この early return が残る限り「緑だが何も検証していない」状態になる。
- 現行の `web_accessible_resources` は `content-extractor.js` と `icons/icon48.png` の 2 件のみ（`wxt.config.ts:287-290`）。`utils/*.js` を前提にした assertion は対象 0 件で空振りする。
- この WAR 検証の元々の目的は、CLAUDE.local.md が記録する**実際の障害**（`contentExtractor.ts` / `aiSummaryCleaner.ts` の分割時に WAR 更新が漏れ、Content Script の動的 import が失敗して自動保存が全ページで失敗。2026-04-15）の再発防止である。バンドル構成が変わった現在、同じ目的を**別の形の assertion** で達成する必要がある。

## BDD 受け入れシナリオ

```gherkin
Scenario: 権限の期待がビルドなしで検証される
  Given wxt.config.ts の host_permissions / optional_host_permissions の入力がある
  When  npm run validate を実行する
  Then  ドメイン数・既定ドメインの包含・追加ドメインの非包含・localhost/127.0.0.1 の包含が検証される
  And  11 件のうち該当する assertion は skip されずに実行される

Scenario: 権限を壊すとゲートが落ちる
  Given host_permissions に不要なドメインを1つ足す（または既定ドメインを1つ消す）
  When  該当ゲートを実行する
  Then  テストが fail する（skip や early return で緑にならない）

Scenario: 生成物の検証が skip に落ちない
  Given ビルド成果物（dist/chromium-mv3）が存在する
  When  CI のビルド後ゲートを実行する
  Then  web_accessible_resources が Content Script の実行時に必要な資源を過不足なく宣言していることが検証される
  And  成果物が無い状態でゲートを実行した場合は pass ではなく fail する
```

## 受け入れ基準

- [x] 11 件の skip が解消され、**いずれかの自動ゲートで実際に実行される**（`npm run validate` または CI のビルド後ゲート。実行されないまま緑にしない）
- [x] ソース層（ビルド不要）で表せる assertion は `npm run validate` で走る。`host_permissions` の入力 SSOT（`wxt.config.ts` が参照する `AI_PROVIDER_HOST_PERMISSIONS` / `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS` / `buildLocalHostPermissions()`）を直接検証する
- [x] 生成物層の assertion（WAR と dist 実在）は CI のビルド後ゲートで走る。実現方法は「`check-manifest.mjs` を拡張して `release:check --category=manifest` を CI に配線」または「ビルド後に vitest を追加実行」のいずれかを選び、選択理由を PBI に記録する
- [x] `describeFn = manifestExists ? describe : describe.skip` と `if (!existsSync(...)) { console.warn; return; }` の**静かに skip / pass する経路を除去**し、前提の欠落は fail として現れる
- [x] WAR の assertion は現行バンドル（`content-extractor.js`）に合わせて**目的から再設計**されている（`utils/*.js` 前提の空振り assertion を残さない）。再発防止したい事象（WAR 漏れで Content Script の動的 import が失敗する）が fail として検出できることを Red 確認で示す
- [x] CI を変更した場合、`.github/workflows/ci.yml` の paths フィルタと `src/__tests__/ci-paths-filter.test.ts` の MATRIX を同時に更新し、テストで pin している
- [x] Red 確認: 権限を1つ壊す／WAR から必要資源を1つ外して、それぞれのゲートが fail することを実測し記録する
- [x] `npm run validate` が green、かつ追加した CI job が green（ローカルでは `npm run build` 後のゲートを実行して確認）
- [x] スイート全体の skip 件数が 21 → 10（`manifest.test.ts` の 11 件が 0 になる）

## テスト戦略

- 単体（ソース層）: `wxt.config.ts` の manifest 入力定数を対象に、ドメイン集合・件数・localhost 包含を検証。ビルド不要で `npm run validate` に乗る。
- 統合（生成物層）: `npm run build` 後の `dist/chromium-mv3/manifest.json` と dist の実ファイルを検証。CI のビルド job の後段に置く。
- 回帰: `provider-domain-ssot.golden.test.ts` / `providerAllowlist.test.ts` / `cspDomains.test.ts` が green のまま（ドメイン SSOT の既存 pin を壊さない）。
- Red 確認: 意図的に権限と WAR を壊し、それぞれの層で fail することを確認する。

## 見積もり

2 SP（ソース層 assertion の復元 0.75 ／ WAR 検証の再設計 0.75 ／ CI 配線と paths フィルタ pin 0.5）

## 技術的考慮事項

- `manifest.test.ts` のヘッダは `@jest-environment jsdom` だが `node:fs` を使う。ソース層と生成物層を分ける際、置き場所（`src/__tests__/` のままか `scripts/__tests__/` へ移すか）はビルド依存の有無で決める。
- `dist/` は gitignore。CI のビルド後ゲートは同一 job 内で `npm run build` の後に実行するのが最も単純（artifact 受け渡しを増やさない）。
- **既存の `ci-paths-filter.test.ts` の MATRIX を必ず更新する**。CI job を足してトリガを配線し忘れると「変更したのにゲートが走らない」穴になる（wasm で同種の穴を塞いだ前例が `beb98820` にある）。
- WAR の正しい期待値を導くには WXT のバンドル結果を1回実測する。`content-extractor.js` は Content Script のページ文脈から動的 import される唯一の資源であり、`utils/*.js` が個別に WAR 登録されない設計に変わっている可能性が高い（`wxt.config.ts:273-286` のコメントが「Content Script のページ文脈から fetch される資源だけを載せる」と明記）。
- `dev-docs/TEST_RULE.md` の Red 確認と、AGENTS.md の「固定待ちで隠さない」規約に従う（本件は時間依存ではない）。

## 実装者向け注記

### 実装手順

1. `npm run build` を実行し、`dist/chromium-mv3/manifest.json` の `host_permissions` / `optional_host_permissions` / `web_accessible_resources` の実値を記録する（期待値の baseline）。
2. `wxt.config.ts` が manifest を組み立てる入力（定数と関数）を確認し、ソース層で検証できる範囲を切り出す。
3. 11 件の assertion を「ソース層」と「生成物層」に振り分け、それぞれの置き場所と実行ゲートを決める。
4. ソース層は `npm run validate` で走らせ、生成物層は CI のビルド後ゲートへ配線する。`ci-paths-filter.test.ts` の MATRIX を更新する。
5. 静かに skip / pass する経路を除去し、Red 確認（権限破壊・WAR 欠落）を行う。
6. `npm run validate` と `npm run build`、追加した CI job のローカル相当を実行する。

### 落とし穴

- `manifestExists` の分岐を消すだけで満足すると、11 件は `describe` になるが、リポジトリ直下に `manifest.json` が無いため**別の形で全件 fail** するか、early return で静かに pass する。実行されるゲートに置くことを最優先する。
- WAR の assertion を「現行実装に合わせて通す」だけにすると、再発防止の目的（動的 import 失敗による自動保存全滅）が失われる。**何を壊したら落ちるか**を Red 確認で示すこと。
- `release:check --category=manifest` を CI に配線する場合、`check-manifest.mjs` は `dist/` を前提にしているため、ビルド job の後段に置く必要がある。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る（`npm run validate` green）＋追加したゲートが green
- [x] Red 確認の結果（何を壊すとどのゲートが落ちるか）を PBI に記録する
- [x] スイート全体の skip 件数の変化（21 → 10）を記録する
- [x] コードレビュー完了

## 検証結果（2026-10-12 実施）

レイヤー設計: ソース層（`src/__tests__/manifest.test.ts` 再設計・15 テスト・`wxt.config.ts` の manifest ファクトリを直接呼び SSOT 合成と完全一致を検証・`npm test` に乗る）＋生成物層（`scripts/release-checks/check-manifest.mjs` 拡張）。ゲート配線の選択: 「`check-manifest.mjs` を拡張して `release:check --category=manifest` を CI build job に配線」。理由: (1) `index.mjs` が既に `--category=manifest` をサポートし package.json 編集不要、(2) dist 依存テストを vitest スイートに置くと include パターンが src と scripts の両方にマッチし dist 無しの `npm run validate` が壊れる、(3) 人間のリリースフロー `npm run release:check` にも同じ保護が乗る、(4) vitest 起動コストより速い。

dist 実測値（build 前後で同一）: host_permissions 30 件（ローカルサービス origin 16 + 常時許可 AI プロバイダ 14）/ optional_host_permissions 32 件（オプトイン 26 + リストソース 6）/ permissions 12 件 / host+optional 合計 62 件 / `<all_urls>` 不在 / WAR 2 資源（`content-extractor.js`, `icons/icon48.png`）。

- Red 確認: (a) ソース層ゲートに壊した入力（`https://tracker.example/*` を 1 つ追加 / `http://127.0.0.1:27123/*` を 1 つ削除）→ AssertionError で fail、実 manifest では同一ゲートが 15/15 green。(b) dist manifest の WAR から `content-extractor.js` を一時削除 → gate exit 1（`Page-context getURL() fetches missing from web_accessible_resources`）→ 復元 + `npm run build` で再生成し green。2026-04-15 の障害モード（WAR 漏れで動的 import 失敗）を fail として検出できることを実証。
- `npx vitest run src/__tests__/manifest.test.ts src/__tests__/ci-paths-filter.test.ts` → 66 passed（manifest 15 件は全実行・skip 0。旧 11 件の skip は解消）。
- `node scripts/release-checks/index.mjs --category=manifest`（build 後）→ exit 0（20 passed / 0 failed）。
- `npm run type-check` / `npm run type-check:test:baseline`（463 = pinned 463、型エラー不変）/ `npm run lint`（0 errors）→ 全 green。
- 静かに skip/pass する経路の除去: `describeFn = manifestExists ? describe : describe.skip` 分岐・beforeEach の early-return warn・WAR の `if (!existsSync) { console.warn; return; }` を全廃。前提欠落は throw / fail-fast で fail になる。
- スイート全体の skip 件数: 21 → 0（NN01/NN02 の src/background 10 件解消と合わせて。最終フルスイートで skipped 0 を確認）。
- CI: build job に Manifest artifact gate ステップ追加（`ci.yml`）、paths フィルタへ `scripts/release-checks/**` 追加、`ci-paths-filter.test.ts` の MATRIX と build 入力サブセット検査に pin。
- コードレビュー: マージ時にメインエージェントが全差分をレビュー済み。
