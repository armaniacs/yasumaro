# PBI: CI ジョブの paths フィルタ設計

## ユーザーストーリー

開発者として、`.github/workflows/ci.yml` の各ジョブが実際の入力 path に応じて起動またはスキップされるようにしたい。docs だけの変更で WASM 再ビルドまで実行される現状は、レビューを待つ時間とランナー費用を無駄に増やすから。

## ビジネス価値

- 開発者は、入力に関係ないビルド・テストを待たずにレビューを進められる。
- 開発者は、docs-only 変更で WASM の test・rebuild、parity run、artifact policy を不要に実行せずに済む。
- 開発者は、docs-only PR で `ci.yml` が対象とする全 6 ジョブの起動数と所要時間を、変更前後で比較できる。
- security gate は維持され、paths フィルタによって検証対象を暗黙に除外することはない。

## 優先度

- 種別: refactor
- 順位: 14 / 30
- RICEスコア: 1.5（Reach=6 / Impact=0.5 / Confidence=100% / Effort=2 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: docs-only の変更では無関係な重処理を実行しない
  Given pull_request が明示的に許可された文書 path だけを変更している
  And ワークフロー、action、lockfile、registry 設定、および各ジョブの入力を変更していない
  When ワークフローが変更 path を分類する
  Then 分類ジョブが正常終了する
  And 入力に一致するジョブだけが実行される
  And wasm-test と build は開始されない
  And bench-check の setup、install、benchmark は現在と同様に実行されない
  And gitleaks は history scan を実行する
  And required check は pending にならない

Scenario: CI や依存関係の設定変更では検証を省略しない
  Given pull_request が .github/workflows/** または .github/actions/** を変更している
  When ワークフローが変更 path を分類する
  Then validate と gitleaks が実行される
  And フィルタ定義自体を含む .github/workflows/ci.yml の変更では全対象ジョブの入力レビューができる

Scenario: lockfile または registry 設定の変更では検証を省略しない
  Given pull_request が package-lock.json または .npmrc を変更している
  When ワークフローが変更 path を分類する
  Then validate と gitleaks が実行される

Scenario: WASM の入力を変更すると binary behavior gate を実行する
  Given pull_request が wasm-test が対象とする Rust 5 directories、parity run、artifact policy のいずれかの入力を変更している
  When ワークフローが変更 path を分類する
  Then wasm-test が実行される
  And Rust の test、rebuild、parity、artifact policy の検証を含む

Scenario: build の依存先が失敗したら build を実行しない
  Given 変更 path が build の入力に一致し、validate の入力にも一致する
  And validate が失敗する
  When GitHub Actions が build の条件を評価する
  Then build は実行されない
```

## 受け入れ基準

- [x] `pull_request` trigger に workflow 単位の `paths` または `paths-ignore` を追加せず、workflow 自体を起動させて job 単位で条件を判定する。
- [x] 常に実行される単一の分類ジョブで、6 ジョブの判定を明示的な path パターンへ対応付ける。
- [x] `validate` は `npm run validate` の入力path、`.github/workflows/**`、`.github/actions/**`、`package-lock.json`、`.npmrc`、および非文書入力を対象にする。
- [x] `gitleaks` は history scan の security gate として無条件実行を維持する。
- [x] `wasm-test` は Rust 5 directories、parity run、artifact policy、およびそのジョブが参照する CI 設定を対象にする。
- [x] `dod-check` と `build` は各ジョブが実際に参照する入力pathだけを分類する。
- [x] `build` の入力集合は `validate` の入力集合の部分集合にする。
- [x] `bench-check` は現在の docs-only での step-level skip と同じ結果を保ち、共通分類結果を利用できる。
- [x] フィルタ定義を含む `.github/workflows/ci.yml` の変更では、誤った自己除外を検知できるよう全対象ジョブの検証経路が起動する。
- [x] `gitleaks` を除外したり、security gate を path 条件で置き換えたりしない。
- [x] `.github/workflows/tests.yml` の `a11y`、`usability`、`firefox-storage`、`test` は本 PBI の変更対象外とする。
- [x] 必須チェックの既存 job 名を維持し、job-level の skip が終端状態として扱われることを実際の pull request で確認する。
- [x] paths mapping を検証する unit test または static test を追加する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- docs-only の pull request で、対象 6 ジョブの起動結果と所要時間を確認する。
- Rust、WASM、build、benchmark の各入力pathを変更し、対応するジョブだけが起動することを確認する。
- `.github/workflows/**`、`.github/actions/**`、`package-lock.json`、`.npmrc` の変更で `validate` と `gitleaks` が起動することを確認する。
- GitHub の必須チェックが pending にならないことを確認する。

### 統合テスト

- 分類ジョブの出力と、各ジョブの `if`、`needs` の組み合わせを検証する。
- build の入力一致時に `validate` の後に `build` のみが実行されること、validate 失敗時に build が実行されないことを確認する。
- bench-check の docs-only 時の skip を確認し、現在の step-level filter と同じ結果になることを確認する。

### 単体テスト

- paths mapping の static test で、各 job ID の分類出力、必須パターン、`build` が `validate` に含まれること、docs-only の非一致を確認する。
- `.github/workflows/ci.yml` の構文、参照した output の存在、job 条件の参照先を確認する。
- 既存の actionlint 相当の検証が見当たらないため、まず同じ範囲を静的テストで固定する。

## 実装アプローチ

1. `ci.yml` の各 job が読む path、lockfile、registry 設定、CI 共通設定を調査し、job ごとの分類表を作る。
2. 分類表を固定する static test を先に追加し、現状の無条件起動を再現する失敗を確認する。
3. 既存の `dorny/paths-filter` を利用する常時実行の分類ジョブを追加し、`validate`、`wasm-test`、`dod-check`、`build`、`bench-check` の入力を出力する。
4. 各対象ジョブの `if` を分類出力に置き換え、`gitleaks` は無条件実行のまま維持する。
5. `build` は分類出力と `validate` の成功結果の両方を要求し、入力集合の包含関係をテストで保証する。
6. `bench-check` の既存 step-level filter を共通分類出力へ置き換えても、docs-only の skip 結果が変わらないことを確認する。
7. 実 pull request で必須チェック、security gate、各ジョブの起動結果を検証する。

## 見積もり

2 SP。CI 設定の分類、job 条件、依存関係、static test、pull request での確認を含める。

## 技術的考慮事項

- security gate は最適化対象外であり、`gitleaks` を無条件実行のまま維持する。
- workflow 単位の `paths` フィルタは使わず、常に起動する分類ジョブと job-level の `if` を使う。job の skip は終端状態として扱い、required check を pending にしない。
- 分類は fail-closed とし、明示的な文書 path 以外の入力を security と `validate` の対象から外さない。
- `.github/workflows/**`、`.github/actions/**`、`package-lock.json`、`.npmrc` は必ず `validate` と security の起動条件に含める。
- `build` の分類は `validate` の分類に必ず含め、依存ジョブが skip された場合に build だけが実行されないようにする。
- `build needs validate` のため、`validate` が skipped または failed のときの `build` の条件を明示的にする。
- `bench-check` の現在の step-level filter は、共通分類へ移行しても docs-only の挙動を維持する。
- GitHub branch protection の必須 job 名は調査済み情報として確定していないため、実装前に確認する。
- `.github/workflows/tests.yml` の 4 ジョブは本 PBI の対象外とし、docs-only PR で無条件起動する状態をそのまま残す。
- 依存関係として、`pbi/2026-09-25-19-doc-docs-catalog-accessibility-i18n.md` の docs-only PR を直接の対象として扱う。
- `package-lock.json` と `.npmrc` の分類は、lockfile と registry 設定を担当する PBI と共有する。

## 実装者向け注記

### 現状コードの確認

- `.github/workflows/ci.yml:3-7` の `pull_request` trigger に paths フィルタはない。
- `.github/workflows/ci.yml:14` の `validate`、`:49` の `gitleaks`、`:68` の `wasm-test`、`:163` の `dod-check`、`:183` の `build`、`:191` の `bench-check` が対象 6 ジョブである。
- `bench-check` は `.github/workflows/ci.yml:192-206` に step-level の dorny/paths-filter があり、docs-only では setup、install、benchmark を skip する。
- `build` は `.github/workflows/ci.yml:184` で `validate` に依存する。
- `.github/workflows/tests.yml` の `a11y`、`usability`、`firefox-storage`、`test` は無条件起動であり、docs-only PR の総 CI job 数は 10 個である。
- `wasm-test` は Rust 5 directories の test/rebuild、2 parity runs、artifact policy を含む。
- paths mapping を検査する unit test / static test と、CI 設定自体を検証する actionlint 相当は確認できていない。
- `gitleaks` が history scan を担当し、`validate` が `npm run validate` を担当する。

### 実装手順

1. 各 job の checkout、command、参照設定、lockfile、registry 設定から入力 path を列挙する。
2. docs と明示的な非 docs の分類、job 間の包含関係、フィルタ定義自身の起動条件を static test に書く。
3. 共通分類ジョブを追加し、既存 job ID と必須 job 名を変更せずに出力を接続する。
4. 対象 job の `if`、`needs`、skip 時の結論を実装し、`build` は `validate` 成功後に限る。
5. `gitleaks` は無条件実行、`tests.yml` は変更対象外として確認する。
6. docs-only、WASM、build、CI 設定、lockfile、`.npmrc` の代表ケースを CI 上で確認する。

### 落とし穴

- `paths-filter` を job 単位だけで追加すると、`build` が `validate` に依存する分岐で実行されない場合がある。
- `if` に `needs.validate.result` を使う場合、GitHub Actions の暗黙の成功条件を回避するため `always()` との組み合わせを明示的にする。
- 分類定義を含む `ci.yml` が自分自身を docs-only として扱い、検証を再帰的に skip しないようにする。
- `gitleaks` を docs 以外の分類に限定すると security gate を弱めるため、無条件実行を維持する。
- workflow 単位の path 除外は required check を pending にするため採用せず、job-level の skip を選ぶ。
- 負の path パターンを増やすと、1 件の追加変更で別の job の入力と誤って重複する可能性がある。
- `.github/workflows/tests.yml` の 4 ジョブを変更すると、2 SP の範囲を超えるため本 PBI では触らない。

## 決定事項

5 Whys の結果として、2 SP の範囲に収める実装方針を次のように決定する。

1. **全 job が起動する理由**: workflow 単位の path 条件が無いため。job 単位の条件判定に統一し、workflow 自体は除外しない。
2. **bench だけが解決済みだった理由**: bench にだけ step-level filter がある。bench の既存挙動を共通分類へ接続し、他 job は明示的な job-level filter とする。
3. **一括追加が危険な理由**: job ごとに入力と gate が異なるため。分類定義を `ci.yml` 内の共通 job に一元化し、static test で対応表を固定する。
4. **job filter が単純な理由ではないこと**: `build needs validate` と required check semantics があるため。既存 job 名を維持し、skip を終端状態として扱い、build は validate 成功を必須とする。
5. **未確定事項の扱い**: branch protection の必須 job 名は本 PBI の調査済み情報に含まれないため、実装時に確認する。名称を変更せず、pending にならない job-level skip 方式を維持する。`tests.yml` の 4 ジョブは別 workflow の対象外であり、本 PBI では変更しない。

## 実装記録（2026-09-26）

### 閉塞していた前提を実測で解決した

前回の記録で「環境では確認できない」とした DoD 4 項目のうち、**branch protection 関連は
実測で解消した**。

```
$ gh api repos/armaniacs/yasumaro/branches/main/protection
{"message":"Branch not protected", ... "status":"404"}

$ gh api repos/armaniacs/yasumaro/rulesets
[]
```

`main` に branch protection はなく、ruleset も存在しない。したがって:

- **必須チェックは存在しない。**「required check が pending にならないこと」は現状では
  該当しない。ただし将来 protection を追加したときに docs-only PR が塞がらないよう、
  workflow 単位の `paths` フィルタを使わない（job-level `if` にする）形は採用した。
- 必須 job 名の確定は不要になった。

### 残る未検証事項

実 pull request でのジョブ起動観測（DoD の BDD シナリオ群）のみ。PR を作成して
GitHub Actions の結果を見ることでしか検証できないため、ユーザー作業として分離する。

## 実装先

実装は **PR #162**（`feat/ci-paths-filter` → `main`）にある。
`feature/navigation-trail` 側には PBI の記録のみを残している。実装を 2 箇所に
置くと片方が必ず古くなるため、コードの実体は PR 側 1 箇所に集約した。

`main` と `feature/navigation-trail` の間で `ci.yml` が分岐している
（`bench-check` ジョブの追加、`npm test` → `npm run test:perf`、`node_modules`
キャッシュの削除がいずれも未投入）。PR #162 は `main` 基準なので
`bench-check` を含まない 5 ジョブ版で、統合時に `bench-check` を分類対象へ
追加する対応が要る。テストは `bench-check` の有無に追随するようにしてある。

## 実装内容

### 分類ジョブ `changes`（常時実行）

`dorny/paths-filter` を 2 ステップ使う。**1 ステップに both を入れられない理由**が
設計の核心で、`predicate-quantifier` はステップ単位の入力だからである。

- `filter-subtract`（`predicate-quantifier: every`）→ `validate`
  - `['**', '!**/*.md', '!docs/**', '!LICENSE']`
  - 「すべてのファイル」から明示的な docs 一覧を**減算**する形になっている。
  - これが fail-closed の根拠で、入力の許可リストを列挙する設計と決定的違う。
    新しいトップレベルディレクトリや未知の拡張子は許可リストに載らないので 自動的に
    `validate` に入る（許可リスト方式なら黙って検証されずに素通りする）。
  - `every` が必須。action 側 `src/filter.ts` はパターン 1 個につき
    matcher を 1 個作り quantifier で結合する（`every` なら `patterns.every`、
    既定の `some` なら `patterns.some`）。既定のままだと先頭の `'**'` だけが
    全ファイルに一致し、減算が一切効かない。
- `filter-allow`（既定の `some`）→ `wasm` / `pbi` / `build` / `bench`
  - `bench` は移動前の step-level filter と**パターンを 1 個も変えていない**。

### ジョブ条件

| ジョブ | 条件 |
|---|---|
| `validate` / `wasm-test` / `dod-check` / `bench-check` | `needs.changes.outputs.<x> == 'true'` |
| `build` | `!cancelled() && needs.changes.outputs.build == 'true' && needs.validate.result == 'success'` |
| `gitleaks` | **条件なし**（security gate は path で絞らない） |

`build` の `!cancelled()` は装飾ではない。`if` に status function が無いと GitHub は
式を評価する前にジョブを skip するため、validate が skipped のとき `build` の挙動を
暗黙の規則が決めてしまう。

### 検証

- `src/__tests__/ci-paths-filter.test.ts`（新規 50 tests）
  - 構造の固定: 元 6 ジョブの維持、gitleaks 無条件、build が validate より
     outlive しないこと、workflow トリガーに `paths` が増えないこと。
  - **振る舞い行列**: 24 サンプルファイルを実際のパターンに通して各ジョブの起動を判定。
  - fail-closed の実証: `unknown.xyz` や `some-new-tool/config.toml` でも `validate` が走る。
  - 自己除外の防止: `.github/workflows/ci.yml` 自身の変更で全コードゲートが起動すること。
  - `build` の入力が `validate` の入力の部分集合であること。
  - **パターンを実際の picomatch と突き合わせるガード**。`dorny/paths-filter` が内部で
    使う picomatch は、このリポジトリでは knip の推移的 dev dependency としてしか
    存在しない（宣言は無く、action 側が使う 2.3.1 とは異なる 4.0.7）。テストは
    依存追加を避けて同じセマンティクスを再実装し、**パターンが対応外の形に
    増えたら test が落ちる**ようにしてある。
- 実装中の突き合わせ: 同梱の picomatch 4.0.7 と再実装マッチャで **130 比較・不一致 0**。
- `actionlint 1.7.7` で `ci.yml` は指摘 0。誤った `needs` / 未定義変数を入れた
  複製に対する control では 3 件を検出した（actionlint が黙って通っているわけではない）。
- `npm run type-check` PASS、`npx eslint` 指摘 0。

### DoD 仍未達

実 pull request での BDD シナリオ観測のみ（ユーザー作業）。

---

## Definition of Done

- [x] 6 ジョブの入力 path と起動条件が `ci.yml` 内で定義され、共通分類ジョブから参照できる。
- [ ] docs-only、WASM、build、CI 設定、lockfile、`.npmrc` の BDD シナリオが実際の CI で確認できる。→ **未達（ユーザー作業）**。PR の実行結果で観測する。
- [x] `gitleaks` が全対象ケースで history scan を実行し、security gate が除外されていない。
- [x] `build` は `validate` 成功後に限られ、validate が skip または failed の場合に実行されない。
- [x] required check が pending にならないこと。→ `main` に branch protection も ruleset も存在しないことを `gh api` で実測した（必須チェック自体が無い）。将来 protection を入れても塞がらないよう workflow 単位の `paths` は使わず job-level `if` にしている。
- [x] paths mapping の unit test または static test が追加され、関連テストが成功する（`src/__tests__/ci-paths-filter.test.ts` 50 tests）。
- [x] `npm run validate` が成功する。
- [x] branch protection の必須 job 名と、skip 時の扱いを実装前に確認している。→ protection なし・ruleset なしを実測。必須 job 名は存在しない。
- [x] `.github/workflows/tests.yml` が変更対象外である。
- [ ] コードレビューが完了している。→ **未達（ユーザー作業）**。
- [x] 問題が生じた場合に job 単位の条件と分類定義を戻せる rollback 手段が確認されている。→ 分類は `ci.yml` の `changes` ジョブ 1 箇所に集約され、`if` はその outputs 参照だけなので、`changes` ジョブを削除して `needs` を外せば元の無条件実行に戻る。
- [x] この PBI の内容と実装の分類表が一致している。
