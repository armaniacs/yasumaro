# PBI: Vitest の DOM 環境を wasm-quickjs-dom へ置き換えて固定コストを削減する

- 状態: 未着手
- 種別: 非機能追加 (性能改善)
- 見積もり: 3 SP
- 起票日: 2026-11-19
- 親 PBI: なし (ADR `dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md` の「環境構築の費用向下」領域)
- 深掘り: 完了 (末尾の「深掘りセッション」節参照。セキュリティ系退避リスト確定、ゲート決定規則、kill criteria 追加済み)

## ユーザーストーリー

開発者 (validate / npm test を回す全員) として、テストスイートの実行固定コスト、特に DOM 環境の構築コストが削減されたい。なぜなら jsdom 環境構築が残存固定コストの約半分を占め (ADR 実測: 106ms/ファイル)、suite が成長するたびに `jsdomFileCount` ゲート (現在 426) が赤になり、開発サイクルと CI が繰り返し止まるから。

## ビジネス価値

- **wall 時間の短縮**: jsdom 環境構築 106ms/ファイル × 約420ファイル (docblock 集計) を大幅に安くできれば、CPU 換算で約30秒、wall 換算で数秒から10%程度の短縮が見込める。記事 (zenn: wasm-quickjs-dom-bench) の「30%短縮」は環境構築が1.15秒/ファイルのスイートでの値であり、本リポジトリではそのまま期待しない
- **ゲート摩擦の解消**: `jsdomFileCount` ゲートは「jsdom 構築 約106ms/ファイル」を価格付けの根拠にする (bench/baselines/test-perf.budget.json の `_comment`)。環境構築が大幅に安くなれば 426 の pin の前提が変わり、suite 成長による頻繁な赤 (直近でも 403 → 426 に改定) から解放される。ゲートの扱いは「ゲート決定規則」(本 PBI 末尾の決定事項) に従う
- **setup モックの削減余地**: 新環境は matchMedia / IntersectionObserver / ResizeObserver 等をネイティブ提供するため、`vitest.setup.ts` の条件付きモックの一部が不要になる可能性がある

## BDD受け入れシナリオ

```gherkin
Scenario: DOM 環境を差し替えてもテストの結果は変わらない
  Given テストスイートに jsdom 環境を指定したテストファイルが約420件ある
  And セキュリティ系退避リストのファイルは jsdom を維持している
  When 開発者が退避リスト以外の DOM 環境を wasm-quickjs-dom に差し替えてフルスイートを実行する
  Then パスと失敗の集合は差し替え前と同一である
  And スイートの壁時間は差し替え前より短い

Scenario: 環境差異が強いテストは元の環境に退避する
  Given 退避リストと差異分類の基準が実装者向け注記に確定している
  When 環境差し替え後のスイート実行で差異が検出される
  Then 該当ファイルはファイル単位で元の jsdom 環境に戻される
  And 各退避ファイルには判断根拠が1行で記録される
  And セキュリティ関連テスト (サニタイザ・XSS・エスケープ) は緩和なしで全件パスする

Scenario: suite の成長が予算ゲートで止まらなくなる
  Given 予算ゲートが jsdom ファイル数 426 件で固定されている
  When スパイクで新環境の per-file コストが実測される
  Then ゲート決定規則 (ADR 追記に記載) に従ってゲートの形が決まる
  And 更新は ADR への追記 (推移と原因) と同時に行われる
```

## 受け入れ基準

- [ ] スパイク計測が ADR R5 プロトコル (load average の事前確認、ブロッキング待機、孤児プロセス排除) で実施され、1 ファイルあたりの環境構築コストが node / jsdom / wasm-quickjs-dom の3条件で数値記録される
- [ ] スパイクの判断ゲートで「全面移行 (退避リスト除く) / ハイブリッド / 中止」を決定し、根拠を本 PBI に追記する。**中止基準は両側**: (a) 削減見込みが wall の3%未満なら中止、(b) 機械置換後の失敗が対象ファイルの10%超なら全面移行を断念しハイブリッドへ縮小、ハイブリッドでも退避+差異修正が重ければ中止
- [ ] 環境差し替え後、フルスイートが全件パス (スキップ・テスト削除・アサーション緩和なし)
- [ ] セキュリティ系退避リスト (実装者向け注記に列挙) のファイルが jsdom のまま全件パス
- [ ] `scripts/test-perf/report.mjs` と `bench/baselines/test-perf.budget.json` が新構成に対応し、`npm run test:perf` が緑
- [ ] ADR 2026-09-26 に計測結果・判断・ゲート決定規則・(該当すれば)却下案テーブルの更新が追記される
- [ ] 依存追加の審査が緑 (`check-licenses`、`check:deps:audit-warn`、`generate-sbom`)
- [ ] `npm run validate` が緑

## テスト戦略 (t_wadaスタイル)

### E2Eテスト (最小限)
- フルスイートゲート: `npm test` + `npm run test:perf` が緑。置き換え前後でテスト結果の集合が一致すること

### 統合テスト (中程度)
- プロジェクト単位: `npx vitest run --project=isolated` / `--project=shared` が緑
- setup ファイル: `vitest.setup.ts` の canvas / matchMedia 条件分岐が新環境下で期待どおり評価されること
- ゲート: test:perf の環境分類 (`JSDOM_DOCBLOCK`) が新 docblock を正しく扱えること

### 単体テスト (多数)
- 能力プローブ: 新環境が matchMedia / IntersectionObserver / ResizeObserver / canvas / crypto をどう提供するかを、本リポジトリが使う API の範囲で確認
- パーサー同値: `aiSummaryCleaner` の stripCore / stripExtended 同値系と `contentExtractor` のパース系が新環境でも同一結果
- 境界値: viewport サイズ・userAgent 既定値の差異に依存するテストの有無調査 (viewport は `environmentOptions.wasmQuickjsDom.width/height` で jsdom 既定 1024x768 に合わせられる)
- 例外ハンドリング: 環境初期化に失敗した場合は失敗として可視化する (黙るフォールバックを作らない)

## 実装アプローチ

- **Outside-In**: フルスイートゲートの期待 (E2E) を先に固定し、プロジェクト単位 → 1 ファイル単位の順に下りる
- **Red-Green-Refactor**: 差異が見つかったファイルごとに「setup 修正で解決 / jsdom 退避 / テスト側修正」を分類してから手を入れる
- **リファクタリング**: 緑の後、setup の不要モック削減と docblock の整理

## 見積もり

3 SP (難易度: 🔴高。判断ゲートと供給網審査を含むため)

## 技術的考慮事項

- **依存関係**: 新規 devDependency `vitest-environment-wasm-quickjs-dom` (内部で wasm-quickjs-dom を取り込む)。MIT、依存 0、週次ダウンロード約1,300、Node 20 以上 / ESM 必須 ― 本リポジトリは Node >= 24 / `type: module` で適合。Vitest 5.1.0 は記事の検証版本と同一。devDependency 専用で成果物には同梱されない
- **テスタビリティ**: 環境は docblock 単位で切替可能。ハイブリッド (ファイル単位の jsdom 残存) が常に可能で、全面切替は要求しない
- **非機能要件**: 供給網審査 (単著者・.wasm 同梱パッケージ) を SECURITY_REVIEW_GUIDE の観点で実施。wall はマシン依存 (R4/R5) のため CI (ubuntu / 4 vCPU) での再確認が必須
- **ロールバック**: docblock の機械置換は git revert で完全に戻る。予算 JSON・ADR・package.json / lockfile を revert 対象に含める。初回フルスイート実行前にタグを打つことを推奨

## 実装者向け注記

### 現状コードの確認

(着手前に必ず実行すること)

```bash
# 既実装でないことの再確認 (フェーズ0で未実装を確認済み: 2026-11-19 時点で0件)
grep -rn "wasm-quickjs" src/ testDir/ package.json scripts/

# 現在の jsdom docblock の所在と件数
grep -rln "@vitest-environment.*jsdom" src testDir tests | wc -l

# 現在のゲート値と判定ロジック
cat bench/baselines/test-perf.budget.json
grep -n "JSDOM_DOCBLOCK" scripts/test-perf/report.mjs

# crypto ランダム性に依存する jsdom テストの特定 (退避判定用)
grep -rln "crypto.getRandomValues\|crypto.randomUUID" src --include="*test.ts" | xargs grep -l "@vitest-environment.*jsdom" 2>/dev/null
```

既実装の可能性: なし。2026-11-19 に `wasm-quickjs|quickjs` で src/ testDir/ package.json scripts/ を検索し0件であることを確認済み。

### セキュリティ系退避リスト (機械置換の対象から最初から除外する)

深掘りセッションで確定した退避対象。**このリストは docblock 置換スクリプトの除外リストにそのまま使う**。

| ファイル | 退避理由 |
|---|---|
| `src/popup/__tests__/popup-xss.test.ts` | XSS サニタイザ検証。パーサー意味論の変更を避ける |
| `src/popup/__tests__/trustSettings-xss.test.ts` | 同上 |
| `src/dashboard/generalSettings/__tests__/connectionTests-innerhtml.test.ts` | innerHTML エスケープ検証。同上 |
| crypto ランダム性依存ファイル (上の grep で特定) | 新環境の `crypto.getRandomValues` / `crypto.randomUUID` は Math.random バックエンド (CSPRNG でない) のため、ランダム性・一意性を検証するテストは退避 |
| `src/utils/ui/__tests__/focusTrap.test.ts` | `:focus` 等の相互作用セレクタの挙動差がある。差異分類で確認し、必要なら退避 |

パーサー同値系 (stripCore / stripExtended / contentExtractor) は「検知能力は維持、本番一致の根拠は弱まる」と位置づけ、新環境へ移してよい。ただしスパイクで同値テストが緑であることを確認し、落ちたら退避する。

### 実装手順

1. **スパイク (タイムボックス 2日)**
   - 空のテストファイル3種 (node / jsdom / wasm-quickjs-dom docblock) を用意する
   - `npm install -D vitest-environment-wasm-quickjs-dom`
   - ADR の 20 ファイル隔離実行測定と同方法で、R5 プロトコルに従い3条件の Duration を計測する
   - **判断ゲート (両側)**: (a) 削減見込みが wall の3%未満なら中止、(b) 失敗が対象の10%超ならハイブリッドへ縮小。いずれも ADR の却下案テーブルへ記録する
   - **棚卸しメモ**: パネル系 unit DOM テスト (`src/dashboard/panels/**` 配下の jsdom ファイル) の件数と、既存 Playwright E2E と重複している疑いのある経路の内訳を1行メモとして数える (実施はしない。fileCount 復帰時の再検討材料)
2. **導入試験**: 退避リストを除外した `@vitest-environment jsdom` → `@vitest-environment wasm-quickjs-dom` を機械置換し、フルスイートを実行する。`environmentOptions.wasmQuickjsDom.width/height` を 1024/768 (jsdom 既定) に設定して viewport 差異を消す
3. **差異分類**: 失敗ファイルを「setup 修正で解決 / jsdom 退避 / テスト側修正」の3分類にする。退避ファイルには docblock の近くへ1行の根拠を残す
4. **ゲート対応**: ゲート決定規則 (下記) に従い、`scripts/test-perf/report.mjs` の環境分類と `bench/baselines/test-perf.budget.json` を新構成へ更新する (実測後の値で。改定は ADR の追記と同時)
5. **ADR 追記**: 計測結果・判断・ゲート決定規則・却下案テーブルの更新を `dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md` へ行う
6. **供給網審査 + validate**: `check-licenses` / `check:deps:audit-warn` / `generate-sbom` を通し、`npm run validate` で緑確認する

### ゲート決定規則 (スパイク実測に紐づく機械化された決定)

ゲートの本質は「全テストファイルの固定コスト総量」であり、jsdom は高価な部分集合を便宜的に数えていた。新環境の per-file コスト実測値 (C) と node の実測値 (N) の比で決める:

- **C ≦ N × 1.5 の場合**: 価格差がほぼ消失したため、`gates.jsdomFileCount` を廃止し `gates.fileCount` を復帰させる (2026-10-18 降格の理由「全ファイルを同じ価格で数える誤価格付け」が解消された旨を ADR に記録)。閾値は実測ベースで再設定する
- **C > N × 1.5 の場合**: 価格差が残るため、`gates.jsdomFileCount` を「DOM 環境ファイル数 (実装 jsdom / wasm-quickjs-dom を問わない)」へ再定義し、実測ベースで閾値を改定する

いずれの場合も、改定は本 ADR への追記 (推移と原因) と同時に行う (既存手続きを維持)。

### 落とし穴

- **期待値の補正**: 記事の「30%短縮」は jsdom 環境構築が1.15秒/ファイルのスイートでの値。本リポジトリの ADR 実測は 106ms/ファイルなので、期待は wall 数秒から10%程度。記事の数字をそのまま目標にしない
- **matchMedia モックが効かなくなる**: `vitest.setup.ts` の matchMedia モックは `typeof global.matchMedia === 'undefined'` 判定のため、新環境では導入されない。モックは常に `matches: false` を返すが新環境の matchMedia は実際の幅クエリを評価する (記事の probe: `(min-width: 1px)` が true)。`matches: false` に依存するテストは差異分類で修正または退避する。`(hover: hover)` は true を返す点にも注意
- **crypto が CSPRNG でない**: 新環境の `crypto.getRandomValues` / `crypto.randomUUID` は Math.random バックエンド。ランダム性・一意性を検証するテストは退避リストへ (セキュリティ系退避リスト参照)
- **canvas**: 新環境は `<canvas>` の `getContext()` が null / `toDataURL()` が `"data:,"` を返す。setup の canvas モックは `typeof HTMLCanvasElement !== 'undefined'` 判定なので新環境でも導入され `getContext` を上書きするはずだが、`toDataURL` に依存するテストがあれば退避する
- **`:focus` 系セレクタの挙動差**: 新環境の `:focus` / `:hover` / `:active` はページ状態に追従するが jsdom と細部が異なる可能性。focusTrap 系は差異分類で先に確認する
- **fork 起動は残る**: `testDir/testPartition.ts` は docblock の有無で isolated プロジェクトへ強制する。置換後も fork spawn + transform + setup の固定コストは消えず、削れるのは環境構築の差分のみ
- **testPartition との整合**: `NEEDS_ISOLATION` の正規表現は `@vitest-environment` を拾うため wasm docblock も isolated になる (変更不要)。docblock を消さない限り挙動は変わらないが、置換漏れ・重複指定がないか確認する
- **Stryker**: `@stryker-mutator/vitest-runner` も同じ環境設定を解決する。docblock 置換後、ミューテーションの対象チャンク1つで先に動作確認する
- **CI での再確認**: wall はマシン依存 (R4/R5)。ローカルの数値だけでゲートを判断しない
- **happy-dom 却下との区別**: ADR は happy-dom 一括移行を「利得小・挙動変更大」で実測の上、却下済み。wasm-quickjs-dom は別の実測として扱い、却下判断を引き継がない
- **文字規則**: 本 PBI・ADR 更新は Shift-JIS 往復規則 (`scripts/check-docs-chars.mjs`) に従う

## Definition of Done

- [ ] 全 BDD シナリオが検証されパスする (シナリオ1は計測記録付きで)
- [ ] テストカバレッジ基準を維持する (coverage thresholds 80/80 を変更しない)
- [ ] コードレビュー完了 (GitHub PR での approve を必須とする。依存追加のため SECURITY_REVIEW_GUIDE の供給網観点の確認を PR 説明に明記)
- [ ] リファクタリング完了 (緑後の setup モック整理)
- [ ] ロールバック手段を記載済み (git revert 1件で docblock + budget.json + ADR + 依存を完全復元。初回フルスイート実行前にタグ打ち)
- [ ] ドキュメント更新済み (ADR 追記、必要に応じて dev-docs/TEST_RULE や bench/README への反映)

## 深掘りセッション ― 2026-11-19

### 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| セキュリティ系テストは「jsdom 上で通る」ことで安全性を検証できている | 高 | 退避対象が事前未確定だった。パーサー差異はテストの合否以前に検証の基準線を動かす。jsdom も Blink の近似であり「本番一致」は元々保証されていない (既存の限界) | セキュリティ系退避リストを事前確定 (XSS 3 ファイル + crypto ランダム性依存 + focusTrap 判定)。「jsdom も近似」の限界は別課題 (ブラウザモード昇格検討) として記録 |
| 移行後も jsdomFileCount ゲートを何かの形で維持できる | 中 | ゲートの本質は「全ファイルの固定コスト総量」であり、jsdom は高価な部分集合の便宜的分類。価格差が消えれば fileCount 降格理由 (誤価格付け) も消える | スパイク実測に紐づく決定規則を確定 (C ≦ N×1.5 なら fileCount 復帰、超過なら DOM 環境全体を数え直す) |
| コスト削減の軸は環境差し替えで十分 | 中 | coverage 設定は panels/** を「E2E で検証」と宣言しながら unit DOM テストが大量残存という不整合がある。ただし母数削減は test:perf 数字では安く見えるが開発体験を別場所で高くつける (E2E は遅くフレーキー) | 環境差し替え一本を維持。スパイクに棚卸しメモ (件数+重複疑い内訳) のみ追加し、実施はしない |
| kill criterion は「利得が小さい」側だけで十分 | 中 | 「失敗文件数が爆発する」側の中止基準がなかった (対称性欠落) | 両側 kill criteria を追加 (利得 3% 未満で中止 / 失敗 10% 超でハイブリッド縮小) |
| setup のモック分岐はそのまま機能する | 高 | matchMedia モックは `undefined` 判定のため新環境では導入されず、`matches: false` 依存のテストはほぼ確実に挙動が変わる。crypto は Math.random バックエンド (CSPRNG でない)。canvas は getContext null だが setup モックが上書きするはず | 差異分類の注意点として落とし穴へ明記。crypto 依存は退避リストへ |
| 供給網審査は未知数 | 中 | npm 確認: MIT、依存 0、週次約1,300 DL、1.0.19 (活発)。devDependency 専用で成果物に同梱されない | リスクは低と判断。審査スクリプト (check-licenses / audit-warn / SBOM) の通過を受け入れ基準で確認 |

### 新たに発見したリスク

- **jsdom も本番 Blink の近似である**: セキュリティ系サニタイザ検証の「本番一致」は unit 環境では保証されない。将来的にサニタイザ検証の一部を Playwright browser mode / 実機 E2E へ昇格する検討が必要 (本 PBI のスコープ外、別課題候補)
- **同値/golden 系テストの根拠の弱まり**: パーサー同値テストは新環境でも検知能力を維持するが、「本番と同じパース結果」という根拠は弱まる。退避基準 (緑であること) を受け入れ基準に組み込み済み

### 未解決の疑問

- パーサー同値系テスト (stripCore / stripExtended) が新環境で落ちた場合、実装差異と本物のバグをどう区別するか (スパイク時に個別判定する。基準は「両環境で手動再現できるか」)
- 新環境の wasm が CI ランナー (ubuntu / 4 vCPU) で安定動作するか (スパイク + チャンク1つで Stryker 確認)

### 決定事項

1. セキュリティ系退避リストを事前確定し、機械置換の除外リストとして使用する
2. kill criteria を両側化した (利得 3% 未満で中止 / 失敗 10% 超でハイブリッド縮小)
3. ゲートはスパイク実測に紐づく決定規則 (C ≦ N×1.5 の分岐) で形を決める。改定は ADR 追記と同時
4. コスト削減の軸は環境差し替え一本。母数削減 (E2E 移管) は棚卸しメモのみ作り、実施はしない
5. viewport は environmentOptions で 1024/768 に合わせて差異を消す
