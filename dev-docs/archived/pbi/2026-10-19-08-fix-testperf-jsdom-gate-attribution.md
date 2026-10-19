# PBI: test-perf の `jsdomFileCount` 引き上げ（360 → 362）に推移と原因を記録する

## ユーザーストーリー

テスト予算を保守する開発者として、**ゲートを引き上げたときに「どこから来て、何が増やしたのか」が残っていてほしい**、なぜならこのリポジトリは「ゲートの引き上げには ADR 注記で推移と原因を記録する。素の引き上げは時計をリセットするだけ」という規約を自分で定めているのに、`jsdomFileCount` の 360 → 362 は**推移も原因も書かれていない**ため、次に同じ判断をするときに前例が無く、同じ「素の引き上げ」を繰り返すから。

## 優先度

- 順位: 2026-10-19 の 08 / 09（同日 9 件のうち 8 番目）
- RICE: 100（Reach=50 / Impact=1 / Confidence=100% / Effort=0.5）
  - Reach: テスト予算を触る保守担当（少数）。ただし予算は CI の赤を左右するため、判断の記録が無いまま次の引き上げが起きる
  - Impact: 1。CI もテストも壊れていない。**規約違反（記録漏れ）**であり、次回の判断材料が欠けている
  - Confidence: 100%（現物と履歴を確認済み。下記）
  - Effort: 0.5 SP。2 ファイルの同定（partition と bisect）と、`_comment` / ADR への 1 段落の追記
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟢なし（ドキュメントと JSON のコメントのみ。ゲートの値は変えない）

## 背景（発見の経緯）

PBI [2026-10-18-01](2026-10-18-01-fix-ai-fetch-redirect-policy.md) / [08](2026-10-18-08-fix-obsidian-redirect-bearer.md) の独立レビューで「demotion 自体は妥当だが、`jsdomFileCount` の 360 → 362 は予算コメント自身が求める『推移と原因』を欠いている」と指摘された。レビューはこれ以外に test-perf の指摘を出していない。

### 確認した事実

| 事実 | 根拠 |
|---|---|
| `jsdomFileCount` は `360` で導入された | `git log -p --follow -- bench/baselines/test-perf.budget.json` → 導入コミット `c2e28943`（`fileCount` の推移 930 → 1059 は書かれているが、jsdom 側の推移は無い。新設なので当然ではある） |
| `360 → 362` に改定された | 同 → `65057bf0`（2026-10-18、PR #180 の一部）。**この差分には推移も原因も書かれていない** |
| 予算コメント自身が規約を明記している | `bench/baselines/test-perf.budget.json` の `_comment` 末尾: "Raising a gate requires an ADR note recording the trajectory and the cause, because a bare raise only resets the clock." |
| ADR 側も同じ規約を定めている | `dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md` の決定 3 と、`2026-10-18` の追記（`:327-345`）。追記には `gates.jsdomFileCount` を `360 → 362` に改定したと書かれているが、推移（いつ 360 になり、何が 2 ファイル増やしたか）は無い |
| `fileCount` 側の推移は記録されている | 同 ADR 追記: `930 → 1060 → 1062 → 1093`。**jsdom 側だけが欠けている** |

## 影響

- ゲートの引き上げが「素のリセット」になり、次回も同じ手続き漏れが起きる。予算コメントは「規約がある」と宣言しているのに、直前の改定がその規約を守っていないため、**規約の実効性が下がる**。
- `jsdomFileCount` は固定コスト（約 106ms/ファイル）に対応する唯一のゲートなので、引き上げ判断の履歴が無いと「どの追加が高くついたか」を後から説明できない。
- CI の赤・緑には影響しない（値は変えない）。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 引き上げの推移と原因が記録されている
  Given test-perf の予算コメントが「引き上げには推移と原因を残す」と定めている
  When  jsdomFileCount の改定履歴を読む
  Then  360 になった時点と 362 になった時点が分かる
  And   360 → 362 の 2 ファイルがどれで、なぜ jsdom 側に分類されるのかが書かれている

Scenario: 2. 次回の引き上げ手順が 1 箇所で分かる
  Given 新しい jsdom テストを追加して予算を超えそうになっている
  When  予算コメントと ADR の該当節を読む
  Then  何を記録し、どこに追記すればよいかが手順として書かれている

Scenario: 3. ゲートの値と挙動は変わらない（回帰ガード）
  Given 本 PBI の変更を適用する
  When  `npm run test:perf` を実行する
  Then  jsdom files のゲート判定は同一の値（362）で行われ、advisory の fileCount も従来どおり表示される
```

## 受け入れ基準

- [x] `360 → 362` の内訳が特定され、ファイル名と jsdom 側に分類される理由（`report.mjs` の `JSDOM_DOCBLOCK` = `testDir/testPartition.ts` と同じ規則）が記録されている。**実測では 2 ファイル増ではなく「1 減 + 3 増」**だった（`manifest.test.ts` が jsdom を離脱）
- [x] 推移（`jsdomFileCount` がいつ 360 になり、いつ 362 になったか）が ADR の `2026-10-18` 追記に書かれている
- [x] 原因（3 ファイル追加 + 1 ファイル離脱）が書かれている。実測で特定した（推測で埋めていない）
- [x] `_comment` と ADR の記述が矛盾しない（`_comment` は推移を要約し ADR を参照）
- [x] `gates.jsdomFileCount` の値は 362 のまま。`npm run test:perf` の判定が変わらない（`ok jsdom files: 362 / 362`、exit 0）
- [x] `npm run validate` が緑（CI）

## テスト戦略

- **単体**: `scripts/test-perf/` に予算の構造を検証するテストがあれば、`_comment` の変更で落ちないことを確認する（`grep -rn "test-perf" scripts/__tests__/` で有無を確認）。
- **回帰**: `npm run test:perf` を実行し、`ok jsdom files: 362 / 362` と advisory 行が出ることを確認する（値の変更が無いことの証明）。
- **ドキュメント**: 自動テストは無い。ADR の追記内容をレビューで確認する。
- **E2E**: 不要。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 箇所 | 内容 |
|---|---|---|
| `bench/baselines/test-perf.budget.json` | `_comment` | 規約を宣言している。推移と原因の置き場としても自然 |
| `dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md` | `:327-345` | `2026-10-18` の追記。`jsdomFileCount` の改定に推移が無い |
| `bench/baselines/test-perf.budget.json` | `gates.jsdomFileCount` | 362（**変更しない**） |
| `testDir/testPartition.ts` | ― | jsdom / node / shared の分類規則。2 ファイルの同定に使う |
| `scripts/test-perf/report.mjs` | 240 / 256 | advisory とゲートの表示 |

### 実装手順

1. `jsdomFileCount` が 360 になった時点（`c2e28943`）と 362 になった時点（`65057bf0`）の間で、jsdom に分類されるテストファイルがどれだけ増えたかを数える。
   - `testDir/testPartition.ts` の規則で現在の jsdom ファイル一覧を作り、`git log --diff-filter=A --name-only <360の時点>..<362の時点> -- '**/__tests__/**/*.test.ts'` と突き合わせて、その期間に追加された jsdom ファイルを特定する。
2. 特定したファイルと「なぜ jsdom 側なのか（DOM を使うから）」を 1 段落で ADR の `2026-10-18` 追記に書く。
3. `_comment` の末尾に、jsdom 側の推移を 1 文で足す（`fileCount` の推移が既に書かれているので並べる）。
4. `npm run test:perf` でゲート判定が変わっていないことを確認する。

### 実装者向け注記 ― 現状コードの確認（着手前に必ず実行）

```bash
# 1) jsdomFileCount の改定履歴（360 で導入 → 362 へ）
git log -p --follow -- bench/baselines/test-perf.budget.json | grep -E "^[+-].*jsdomFileCount|^commit"
# 2) 規約の宣言（予算コメント末尾）
node -e 'console.log(require("./bench/baselines/test-perf.budget.json")._comment.split("Raising a gate")[1])'
# 3) ADR の 2026-10-18 追記
sed -n '327,350p' dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md
```

**未対応**（2026-10-19 に履歴を確認し、`65057bf0` の差分に推移と原因が無いことを確認済み）。

### 落とし穴

- **ゲートの値を変えないこと。** 本 PBI は記録の補完であり、予算の改定ではない。値を触ると CI の判定が変わり、別の意味の変更になる。
- 2 ファイルの同定は **partition の規則に依存**する。`testDir/testPartition.ts` は「isolated / shared」の分割も決めているため、jsdom 判定の条件だけを読むこと（ファイル数 362 は `jsdomFileCount` の定義と同じ数え方でなければ説明にならない）。
- 特定できなかった場合に**推測でファイル名を書かない**こと。規約が求めているのは「推移と原因の記録」であり、不確かな原因を書くと次の判断を誤らせる。
- 予算コメントは 1 行の JSON 文字列なので、**日本語や `->` のエスケープに注意**（`npm run validate:json` が通ることを確認する）。

### ロールバック手順

1. ドキュメント（JSON のコメント文字列と ADR の追記）のみなので `git revert` で戻せる。ゲートの値・挙動は変わらないため、ロールバックの副作用は無い。
2. revert 後は「推移と原因が未記録」の状態に戻る。監査上の扱いは未修正のままとする。

## 見積もり

0.5 SP（🟢低）。2 ファイルの同定（partition の規則＋`git log` の突き合わせ）と、`_comment` / ADR への 1 段落の追記。

## Definition of Done

- [x] BDD シナリオ 1〜3 が満たされる（シナリオ 3 は `npm run test:perf` の実行で確認: `ok jsdom files: 362 / 362`、exit 0）
- [x] ADR の `2026-10-18` 追記に `jsdomFileCount` の推移と原因が書かれている
- [x] `_comment` の記述と ADR の記述が矛盾しない（`_comment` は推移を要約し ADR を参照）
- [x] `npm run validate` が緑（`validate:json` を含む）
- [x] コードレビュー完了
- [x] 完了記録に、2 ファイルの同定方法と（特定できた場合は）そのファイル名を残す

## 完了記録（2026-10-19）

### なぜなぜ分析（原因 → 示唆 → 解）

**疑問**: なぜ `jsdomFileCount` の改定に「推移と原因」が残らなかったのか。

1. **なぜ残らなかったのか** ― 改定コミット（`65057bf0`）は `fileCount` の降格という**主題**を持っていた。jsdom の値はその決定に付随する変更で、メッセージの紙幅は降格の理由（総数は固定コストを誤って価格付けする）に使われた。
2. **なぜ「付随」と扱えたのか** ― 降格の決定は「今後 jsdom だけをゲートにする」なので、**新しいゲートの初期値を決める**必要があった。初期値の決定は「今の実測値を入れる」という機械的な操作に見える。
3. **なぜ機械的ではなかったのか** ― 362 は実測だが、**その実測値がどこから来たか**（360 から +2 ではなく、**359 から +3**）は自明でない。359 は「1 ファイルが jsdom をやめた」という**逆向きの変化**を含む。
4. **なぜ逆向きの変化が見えなかったのか** ― `jsdomFileCount` は**集計値**で増減の内訳を持たない。1 ファイル減ってもゲートが据え置きなら「余裕がある」状態になるだけで、**余裕は誰も報告しない**。
5. **なぜ規約が効かなかったのか** ― 規約は `_comment` と ADR の 2 箇所に宣言されていたが、**検査する仕組みが無かった**（人の注意力に依存）。

**原因**: 集計値のゲートは**増減の内訳を失う**のに、引き上げの判断を「現在値の実測」だけで済ませられる手続きにしたこと。規約は文章で宣言され、検査されなかった。

**示唆**:
- 集計値のゲートを引き上げる時は、**前回値からの差分をファイル単位で説明する**（増だけでなく減も）。
- 規約を 2 箇所に書くなら**同じ手順を指す**ようにし、手順そのものを 1 箇所にまとめる。
- 「余裕ができた」（ゲート未満）は誰も報告しないので、引き上げ時に**履歴を再構成する**。

**解**: git 履歴から推移を実測して ADR と `_comment` に記録し、引き上げ手順を ADR の 1 箇所にまとめた。

### 実測した推移（推測なし）と同定方法

測定は `git grep -lE '@(vitest|jest)-environment[[:space:]]+jsdom' <rev> -- '*test.ts' | wc -l` を各 rev で実行し、集合差分（`comm -23` / `comm -13`）で増減をファイル単位に落とした。分類規則は `scripts/test-perf/report.mjs` の `JSDOM_DOCBLOCK` と同じ。

| 時点 | 件数 | 何が動いたか |
|---|---:|---|
| `c2e28943`（2026-10-13、ゲート新設 `360`） | 360 | 当時の実測 = 360（新設値は正しかった） |
| `004b05c7` / `375f60a9` | 359 | `src/__tests__/manifest.test.ts` が `@jest-environment jsdom` を落とした。checked-in `manifest.json` ではなく `wxt.config.ts` を検証する形に書き換わり（旧ゲートは常に false で全 skip だった）、DOM が不要になった |
| `7a3a39e0`（2026-10-16） | +1 | `src/offscreen/__tests__/opfsWorker-loadShedRetry.test.ts` |
| `b9f9df3c`（2026-10-17） | +1 | `src/popup/__tests__/pausePanel.test.ts` |
| `ce410903`（2026-10-17） | +1 | `src/background/handlers/dashboardSqlite/__tests__/maintenanceBatchHandler-purge-plan.test.ts` |
| `65057bf0`（2026-10-18） | 362 | 359 + 3。CI の実測も `OVER jsdom files: 362 / 360 (101%)` で一致 |

**結論**: **362 という値自体は正しく、欠けていたのは「そこに至る履歴」だけ**だった。3 ファイルはいずれも DOM を直接使う（offscreen の OPFS worker 経路、popup の pause UI、dashboard の purge 計画 UI）。減った 1 ファイルも理由が特定できた（「減った」ことを見落とすと 360 → 362 が「2 増」に見え、実際は「1 減 + 3 増」）。

### 実装

- `dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md` ― 「`jsdomFileCount` の推移と 360 → 362 の内訳」と「次に引き上げるときの手順（6 ステップ、測定コマンド付き）」を追加。
- `bench/baselines/test-perf.budget.json` ― `_comment` に推移の要約を追記（ADR を参照）。**`gates.jsdomFileCount` は 362 のまま**。
- コード・ゲート値・判定ロジックは変更していない。

### テスト（回帰）

- `npm run test:perf` → `ok jsdom files: 362 / 362 (100%) [gated]`、`test-perf: within budget`、exit 0（シナリオ 3）。
- `npm run validate:json` 緑。`scripts/__tests__/` に予算構造を検証するテストは無い（確認済み）。
- `npm run validate` は CI で確認。

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md` ― 決定 3 と `2026-10-18` の追記（本 PBI の追記先）
- `bench/baselines/test-perf.budget.json` ― 予算と規約の宣言
- `dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md` / `...-08-fix-obsidian-redirect-bearer.md` ― 独立レビューで本件が指摘された元 PBI
- `dev-docs/PERFORMANCE_GUIDE.md` ― 予算の位置づけ
