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

- [ ] `pull_request` trigger に workflow 単位の `paths` または `paths-ignore` を追加せず、workflow 自体を起動させて job 単位で条件を判定する。
- [ ] 常に実行される単一の分類ジョブで、6 ジョブの判定を明示的な path パターンへ対応付ける。
- [ ] `validate` は `npm run validate` の入力path、`.github/workflows/**`、`.github/actions/**`、`package-lock.json`、`.npmrc`、および非文書入力を対象にする。
- [ ] `gitleaks` は history scan の security gate として無条件実行を維持する。
- [ ] `wasm-test` は Rust 5 directories、parity run、artifact policy、およびそのジョブが参照する CI 設定を対象にする。
- [ ] `dod-check` と `build` は各ジョブが実際に参照する入力pathだけを分類する。
- [ ] `build` の入力集合は `validate` の入力集合の部分集合にする。
- [ ] `bench-check` は現在の docs-only での step-level skip と同じ結果を保ち、共通分類結果を利用できる。
- [ ] フィルタ定義を含む `.github/workflows/ci.yml` の変更では、誤った自己除外を検知できるよう全対象ジョブの検証経路が起動する。
- [ ] `gitleaks` を除外したり、security gate を path 条件で置き換えたりしない。
- [ ] `.github/workflows/tests.yml` の `a11y`、`usability`、`firefox-storage`、`test` は本 PBI の変更対象外とする。
- [ ] 必須チェックの既存 job 名を維持し、job-level の skip が終端状態として扱われることを実際の pull request で確認する。
- [ ] paths mapping を検証する unit test または static test を追加する。

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

## 前提条件の記録（2026-09-26 autonomous-task-closer）

本 PBI は**自律作業では閉じられない**。理由を先に記録し、検証できないものを実装しない。

### 環境では確認できない DoD

DoD 12 項目のうち 4 項目が、この作業環境では検証できない:

| DoD | 理由 |
|---|---|
| 「docs-only、WASM、build、CI 設定、lockfile、`.npmrc` の BDD シナリオが**実際の CI** で確認できる」 | pull request を push し、GitHub Actions の実行結果を観測する必要がある |
| 「required check が **pending にならない**ことを**実際の pull request** で確認する」 | 同上。job-level skip が終端状態として扱われるかは実際の PR でしか確認できない |
| 「**branch protection の必須 job 名**と skip 時の扱いを実装前に確認している」 | リポジトリ設定（Settings → Branches）へのアクセスが必要 |
| 「docs-only、WASM、…の BDD シナリオが実際の CI で確認できる」（E2E テスト 3 項目） | 同上 |

### なぜ「static test だけ先に実装する」で済ませないのか

`ci.yml` の job 条件（subject の path パターン）は、**パターンを誤っても CI は緑のまま**になる。
つまり paths mapping の誤りは pull request を観測するまで検出されず、検出時には既に
「本来は検証すべき変更が検証されていない」状態ができている。
これは本 PBI が最適化しようとしている「検証対象を暗黙に除外することはない」という
要件そのものへの反転である。`gitleaks` を無条件実行のまま保つことで security gate だけを
守っても、**`validate`（`npm run validate`）が対象入力に対して動かなくなるリスクは残る**。

「static test で mapping を pin する」ことも、そのマッピング定義と CI 実行時のパターンが
ずれた場合にしか効かない。マッピング定義そのものは pull request で初めて検証できる。

### 推奨する着手手順（ユーザー作業が前置）

1. リポジトリ設定で branch protection の必須 job 名を確定する。
2. 本 PBI の実装に入る。
3. **docs-only の使い捨て pull request** を 1 件作り、6 ジョブの起動結果と
   required check が pending にならないことを観測する。
4. 続けて Rust / WASM / build / CI 設定 / lockfile / `.npmrc` の代表 path を含む
   pull request で、対応するジョブが起動することを確認する。

手順 3 と 4 の観測が本 PBI の DoD の中心であり、**これを代替する検証手段は無い**。
autonomous-task-closer は手順 2（コードと static test の実装）までを完了扱いにしてよいが、
手順 1・3・4 はユーザー作業として分離する。

---

## Definition of Done

- [ ] 6 ジョブの入力 path と起動条件が `ci.yml` 内で定義され、共通分類ジョブから参照できる。
- [ ] docs-only、WASM、build、CI 設定、lockfile、`.npmrc` の BDD シナリオが実際の CI で確認できる。
- [ ] `gitleaks` が全対象ケースで history scan を実行し、security gate が除外されていない。
- [ ] `build` は `validate` 成功後に限られ、validate が skip または failed の場合に実行されない。
- [ ] required check が pending にならないことを実際の pull request で確認する。
- [ ] paths mapping の unit test または static test が追加され、関連テストが成功する。
- [ ] `npm run validate` が成功する。
- [ ] branch protection の必須 job 名と、skip 時の扱いを実装前に確認している。
- [ ] `.github/workflows/tests.yml` が変更対象外である。
- [ ] コードレビューが完了している。
- [ ] 問題が生じた場合に job 単位の条件と分類定義を戻せる rollback 手段が確認されている。
- [ ] この PBI の内容と実装の分類表が一致している。
