# PBI: パフォーマンスベンチマーク基盤（局所ベンチ + e2e ベンチ + 回帰検出）

## ユーザーストーリー
保守開発者として、コンテンツ抽出・クレンジング・content script・Dashboard クエリの性能を、実測可能な局所ベンチと e2e ベンチで測定したい。なぜなら、後続の 7 件の性能最適化 PBI（本 backlog の 02〜08）が「本当に速くなったか」「無関係な箇所を遅くしていないか」を数値で判断できないと、最適化が推測ベースの博打になるから。

## ビジネス価値
- 後続の性能最適化 7 件すべてに、実装前ベースライン取得 → 実装後比較 → PR 添付という共通の検証フローを与える
- CI でベースライン比 +15% の回帰を検出し、将来の性能劣化を自動で止める
- 「拡張を入れるとページが重い」というユーザー体感を定量化する土台になる

## 既実装確認（Phase 0）
- `scripts/benchmark-cleansing.mjs` が存在: esbuild で `src/*.ts` を一時バンドル → jsdom グローバル注入 → `performance.now()` 差分計測 → `querySelectorAll` 呼び出し回数カウント → Markdown 出力。これを共通ハーネスの原型として抽出・再利用する
- `npm run benchmark:cleansing` / `npm run benchmark-constant-time-compare` が既存の単発ベンチ
- Playwright: `testDir/playwright.config.ts` に `extension` project（`@extension` タグ、headed chromium、`channel: 'chromium'`）、`testDir/e2e/fixtures/extension.fixture.ts`、`testDir/e2e/test-pages/server.mjs`（port 8080）
- 性能指標の対象箇所（backlog 02〜08）はレビュー済み。測定軸はユーザー合意済み（wall-clock / CPU / メモリ / Lighthouse + Long Tasks/TBT / reflow / 走査数 / GC / P50-P95-P99 / スケーリング曲線 / 自動保存 e2e 時間 / INP / content script A/B / SW 起動時間 / storage I/O 回数）

## BDD受け入れシナリオ

```gherkin
Scenario: 局所ベンチが指標を出力する
  Given bench/micro/ に少なくとも 7 件のベンチ定義がある（c1〜c7 に対応）
  When `npm run bench:micro` を実行する
  Then 各ベンチについて S/M/L サイズ別の wall-clock P50/P95/P99 が出力される
  And DOM 走査数（querySelectorAll + createTreeWalker）のカウントが出力される
  And スケーリング曲線の傾き（線形回帰の指数）と O(N)/O(N^2) 判定が出力される
  And bench/reports/micro-<date>.md と baselines 候補 JSON が生成される

Scenario: e2e ベンチが自動保存の end-to-end 時間を測る
  Given 拡張をロードした Chromium で bench/fixtures のニュース記事ページを開く
  When content script が抽出・クレンジングを完了し AI 要約リクエスト送信直前に達する
  Then performance.mark('ow-extract-start') から 'ow-send-ready' までの経過時間が記録される
  And その計測時の Long Tasks 合計時間（TBT 相当）が記録される
  And JS ヒープ使用量が記録される

Scenario: CI で性能回帰を検出する
  Given bench/baselines/micro.json にコミット済みのベースライン値がある
  When `npm run bench:check` を CPU 4x throttle 下で実行する
  And いずれかの指標の P95 がベースライン比 +15% を超える
  Then コマンドは exit code 1 で失敗する
  And どのベンチのどの指標が何 % 悪化したかを出力する

Scenario: ベースラインを更新する
  Given 意図的な性能変化があり新しい基準値を確定したい
  When `npm run bench:baseline` を実行する
  Then bench/baselines/micro.json が最新の計測値で上書きされる
  And 差分が git diff で確認できる
```

## 受け入れ基準
- [x] `bench/harness/` に共通ハーネス（runner / stats / report / domEnv / bundle）を実装。`runner.bench(id, {sizes, warmup, measure, setup, run, teardown, counters})` が P50/P95/P99・stddev・カウンタ・スケーリング判定を返す
- [x] `bench/micro/` に c1〜c7 の 7 ベンチ定義（backlog 02〜08 の各対象を測る。c5 は FakeScheduler の仮想時間で schedule 回数とコールバック累積時間、c6 は fake `chrome.storage` / fake `queryHistory` の呼び出し回数）
- [x] `bench/fixtures/` に 5 種の固定 HTML（news-article / spa-heavy / long-blog / shadow-dom / iframe-nested）と S/M/L 増幅ジェネレータ `_sizes.mjs`
- [x] `bench/e2e/` に 4 スペック: autosave-latency / content-script-impact（注入あり/なしビルドの A/B）/ lighthouse（LCP/TBT/CLS/INP）/ sw-startup
- [x] content script に `performance.mark('ow-extract-start')` と `performance.mark('ow-send-ready')` を追加（本番コードへの最小侵襲。既存の抽出開始・送信直前地点に 1 行ずつ）
- [x] `bench/baselines/{micro,e2e}.json` をコミット。`report.mjs` がベースライン比較し、P95 +15% 超で exit 1
- [x] e2e ベンチは CDP `Emulation.setCPUThrottlingRate` を 4x に固定
- [x] npm scripts: `bench` / `bench:micro` / `bench:e2e` / `bench:lighthouse` / `bench:baseline` / `bench:check`
- [x] `bench/README.md` に実行方法・全指標の定義・ベースライン更新手順・CI 組み込み方法を記載
- [x] `scripts/benchmark-cleansing.mjs` を新ハーネス（`bench/harness/*`）を使うよう書き換え、重複ロジックを排除（`npm run benchmark:cleansing` は後方互換で維持 or bench:micro に統合）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `bench/harness/__tests__/stats.test.ts`: percentile（既知の配列で P50/P95/P99）、trimmedMean、線形回帰の指数推定（y=x^1 と y=x^2 の合成データで exponent ≈ 1.0 / ≈ 2.0 を判定）
- `bench/harness/__tests__/report.test.ts`: ベースライン比較ロジック（+15% ちょうど / 超過 / 改善 の 3 ケースで exit 判定）、Markdown 生成のスナップショット
- `bench/harness/__tests__/domEnv.test.ts`: QSA カウンタと treeWalker カウンタが正しくインクリメントされ、teardown でプロトタイプが復元される

### 統合テスト
- `bench/micro/__tests__/smoke.test.ts`: c1〜c7 の各ベンチを warmup=1/measure=2 の最小設定で実行し、例外なく結果オブジェクトを返すこと（数値の妥当性は問わない、あくまで配線確認）
- e2e スモーク（`@extension` タグ、CI では最小反復）: autosave-latency ベンチが mark を取得でき、値が正の有限数であること

### 手動確認
- `npm run bench:micro` をローカルで実行し、7 ベンチすべてがレポートに出ること
- `npm run bench:e2e` をローカル headed で実行し、Lighthouse スコアと autosave 時間が出ること

## 見積もり
3 pt（新規サブシステム。ハーネス + 7 micro + 5 fixtures + 4 e2e spec + CI 配線。ただし既存 `benchmark-cleansing.mjs` と Playwright fixture の再利用で圧縮可能）

## 技術的考慮事項
- 依存関係: **なし（このPBIが 02〜08 の依存元）**
- 追加 devDependency: `web-vitals`（INP/LCP 取得、~2KB）、`lighthouse`（プログラマティック実行）
- reflow カウンタ: jsdom は実レイアウトしないため「`innerText`/`offsetHeight` 等 getter へのアクセス回数」を代理指標にする（`Object.defineProperty` でラップ）。実ブラウザ側は e2e の trace で `Layout` イベント数を採る
- メモリ: `performance.measureUserAgentSpecificMemory()` は `crossOriginIsolated` 必須。取れない環境は CDP `Runtime.getHeapUsage` にフォールバック
- content script A/B: `wxt build` の define で `__OW_DISABLE_CONTENT_SCRIPT__` フラグ付きビルドを別ディレクトリに生成し、同一 fixture のロード時間を比較
- jsdom 計測は絶対値でなく「比率」と「ベースライン差分」で判断する（`benchmark-cleansing.mjs` の既存方針を踏襲）
- CI 実行時間: micro は数十秒で完了する設計（warmup 5 + measure 30）。e2e ベンチは nightly or 手動トリガー推奨（PR ごとは micro のみ）

## 実装者向け注記

### 既存資産の抽出元
```bash
# esbuild バンドル + jsdom グローバル注入 + QSA カウンタ + median + restoreGlobals
cat scripts/benchmark-cleansing.mjs
# Playwright extension project 設定 / fixture / test サーバ
cat testDir/playwright.config.ts testDir/e2e/fixtures/extension.fixture.ts testDir/e2e/test-pages/server.mjs
```
`createInstrumentedDom` / `teardownDom` / `restoreGlobals` / `bundleCleaner` / `median` をそのまま `bench/harness/{domEnv,bundle,stats}.mjs` へ移す。

### ディレクトリ構成（目標）
```
bench/
  README.md
  harness/     runner.mjs stats.mjs report.mjs domEnv.mjs bundle.mjs cli.mjs
  micro/       c1-bytesize.bench.mjs .. c7-dedup.bench.mjs  c6-history-query.bench.mjs
  e2e/         autosave-latency.bench.ts content-script-impact.bench.ts lighthouse.bench.ts sw-startup.bench.ts
  fixtures/    news-article.html spa-heavy.html long-blog.html shadow-dom.html iframe-nested.html _sizes.mjs
  baselines/   micro.json e2e.json
  reports/     (gitignore、生成物)
  playwright.bench.config.ts
```

### 実装手順（Outside-In）
1. `bench/harness/stats.mjs` + テスト（percentile / trimmedMean / 回帰指数）を先に固める
2. `bench/harness/domEnv.mjs`・`bundle.mjs` を `benchmark-cleansing.mjs` から抽出
3. `runner.bench()` を実装。`bench/micro/c2-textscore.bench.mjs` を最初の実ベンチとして書き、配線確認
4. 残り c1/c3/c4/c5/c6/c7 を追加
5. `report.mjs`（Markdown + baseline 比較 + exit code）+ `cli.mjs`（`micro` / `--check` / `--update-baseline` / `--filter`）
6. fixtures 5 種 + `_sizes.mjs`
7. `bench/e2e/` の Playwright スペック 4 種、`playwright.bench.config.ts`（CPU 4x throttle、`bench/fixtures` も配信）
8. content script に `performance.mark` 2 箇所
9. npm scripts、`bench/README.md`、`benchmark-cleansing.mjs` の書き換え
10. baseline を一度実行して JSON をコミット

### 落とし穴
- jsdom グローバルのリークで次ベンチの計測が汚染される → 各 `run` の後で必ず `restoreGlobals` / `teardownDom`（既存コード踏襲）
- warmup 不足で初回 JIT コンパイル分が P50 に乗る → warmup 5 は最低ライン
- `performance.mark` を本番に足す際、E2E テストの `data-ow-*` 属性経由の観測と混同しない（mark は Performance Timeline、属性は DOM）
- content script A/B ビルドは manifest の `content_scripts` を空にするのでなく、スクリプト側で早期 return するフラグにする（注入コスト自体も測りたいなら別途 manifest 版も用意）
- CI の CPU throttle を忘れるとマシン差でベースラインが無意味になる

### backlog 02〜08 への接続（各 PBI の「テスト戦略」に入れる固定文言）
> 実装前に `npm run bench:micro -- --filter cN` でベースライン取得 → 実装後に再実行し `bench/reports/` の差分を PR に添付。無関係な指標が +15% 超で悪化していないこと。対応 micro ベンチの P95 が baseline 比で有意に改善（目標値は各 PBI に明記）していること。e2e に影響する変更は `npm run bench:e2e` の autosave-latency も添付。

## Definition of Done
- [x] 全 BDD シナリオが自動テスト（単体 + `@extension` スモーク）として実装されパスする
- [x] `npm run bench:micro` `npm run bench:e2e` `npm run bench:check` がローカルで動作
- [x] baseline JSON をコミット
- [x] コードレビュー完了
- [x] `dev-docs/PERFORMANCE_GUIDE.md` に「ベンチマークの実行と回帰検出」節を追加
- [x] CHANGELOG.md に記載（開発者向け・非機能）
