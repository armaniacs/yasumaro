# PBI: Stryker vitest-runner の Vitest 5 対応版採用（ミューテーションスコアの実効値化）

**状態: 着手トリガー待ち。上流のリリースまで実装しない。**

## ユーザーストーリー

保守者として、Stryker vitest-runner の Vitest 5 対応版がリリースされたら速やかに採用し、`npm run test:mutate` のミューテーションスコアを実効値化したい。なぜなら、現在はスコアが常に 0.00% で信頼できず、Red/Green 手動検証に依存してテストの実効性を担保しているため。スコアが実効値になれば、テストの網羅性の穴を自動で検出できる。

## 背景（既知の制約の正体）

- `@stryker-mutator/vitest-runner` 10.0.0 は Vitest 5 に未対応。`npm run test:mutate` はミュータントごとのテスト実行が 0 件のまま完走し、スコアが常に 0.00% になる
- 根本原因（上流 issue stryker-mutator/stryker-js#6210、2026-09-04 起・独立再現 3 件）: Vitest 5 で `testNamePattern` がスイートチェーンとテスト名を `' > '` で結合してマッチする breaking change が入ったが、ランナーはスペース結合のパターンを渡すため名前フィルタに一致するテストが 0 件になり、被覆ミュータントがすべて Survived 扱いになる
- 修正 PR: #6220「fix(vitest-runner): match Vitest 5 full test names」（2026-09-26 時点で未マージ）。#6210 議論内では #6214 も修正候補として言及
- 上流の `peerDependencies` は `"vitest": ">=2.0.0"` を宣言しており、壊れた組合せが警告なしにインストールされる。かつ失敗が exit 0 で完走するため「コマンド成功 = 正常」ではない
- #6210 のコメントには、名前フィルタ問題とは別に Vitest 5 で静的ミュータントが誤判定される報告（`coverageAnalysis: off/perTest` でも再現）もある。採用時は名前フィルタ修正だけでなくこの指摘も解消済みかを確認する
- 現行の代替運用: `dev-docs/TEST_RULE.md`「ミューテーションテスト（Stryker）」節の Red/Green 手動検証

## トリガー（着手条件）

いずれかが成立したら着手する:

1. **上流リリース**: npm の `@stryker-mutator/vitest-runner` に #6210 の修正を含む新バージョン（10.0.1 以降、または core を同梱した新メジャー）がリリースされた
2. **方針転換**: 本リポジトリで Vitest を 4.x 系へダウングレードする判断がユーザー裁定された（その場合は本 PBI は不要になり、判断を記録してクローズする）

監視方法（発火判断の手順）:

```bash
npm view @stryker-mutator/vitest-runner version
gh issue view 6210 --repo stryker-mutator/stryker-js --comments
gh pr view 6220 --repo stryker-mutator/stryker-js
```

2026-09-26 時点: latest は 10.0.0、#6210 は open・メンテナ反応なし、#6220 未マージ。着手は不要。

## BDD受け入れシナリオ

```gherkin
Scenario: 上流で Vitest 5 対応版がリリースされた
  Given 本リポジトリは vitest 5.x を使用している
  And vitest-runner 10.0.0 は Vitest 5 でスコア 0.00% になる既知制約がある
  When 上流で #6210 の修正を含む新バージョンが npm にリリースされる
  Then 着手トリガーが発火したと判断できる
  And 依存を新バージョンへ更新して採用検証を開始する

Scenario: 採用検証でスコアが実効値になる
  Given vitest-runner を Vitest 5 対応版へ更新した
  And stryker.config.json の mutate 対象と thresholds は現状のままである
  When 部分実行で vitest run が 1 件以上実行されることを確認してから npm run test:mutate を実行する
  Then ミュータントごとのテスト実行が 0 件でなくなる（testsCompleted > 0）
  And ミューテーションスコアが 0.00% の固定値でなく実効値として変動する
  And 出力の「Ran N tests per mutant」の平均が 0 でない

Scenario: 生残ミュータントを理由分類する
  Given 採用検証の結果、スコアが実効値になり生残ミュータントが報告された
  When 保守者が各生残を確認する
  Then 生残の理由を「テスト不足 / 等価ミュータント / ランナー不具合」に分類して記録する
  And テスト不足のものは後続タスクとして切り出し、起こり得ない失敗を隠すための固定待ちは追加しない

Scenario: 制約解除後に TEST_RULE.md を更新する
  Given 採用検証が完了しスコアが実効値になった
  When dev-docs/TEST_RULE.md「ミューテーションテスト（Stryker）」節を更新する
  Then 既知の制約の記述を解除または現状に合わせて書き換える
  And Red/Green 手動検証がスコア確認の代替として残るかどうかを明記する
```

## 受け入れ基準

- [ ] トリガー待ちである旨と、上流リリースまで実装しない旨が本 PBI に明記されている（起票済み）
- [ ] `@stryker-mutator/core` と `@stryker-mutator/vitest-runner` を #6210 の修正を含むバージョンへ更新している（package.json / package-lock.json）
- [ ] 採用検証で `npm run test:mutate` がミュータントごとにテストを実行している（testsCompleted > 0、Ran N tests per mutant > 0）ことを出力付きで記録している
- [ ] ミューテーションスコアが実効値として変動し、0.00% 固定でないことを記録している
- [ ] 生残ミュータントの理由分類（テスト不足 / 等価ミュータント / ランナー不具合）を記録している
- [ ] `dev-docs/TEST_RULE.md` の既知制約節（「既知の制約」段落）を実効スコアの実測に合わせて更新している
- [ ] `stryker.config.json` の thresholds と mutate が意図せず変わっていない（実効スコアが判明した後の妥当性再評価は別途行う）
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 新規 E2E テストは追加しない。`npm run test:mutate` の全量実行が受け入れ境界であり、外部パッケージの挙動検証はモックではなく実行で行う

### 統合テスト

- 依存更新後、`npm run validate`（type-check + 全テスト）が通ることを確認する
- 小さい対象での部分実行（`npx stryker run --mutate 'src/utils/htmlEscape.ts' --reporters clear-text` 等）で、名前フィルタ経路の修正が効いているかを先に確認する

### 単体テスト

- Stryker 設定に対する単体テストは新設しない（ミューテーション実行自体が検証）

## 実装手順（トリガー発火後）

1. `npm view @stryker-mutator/vitest-runner versions --json` と上流 CHANGELOG で、新バージョンが #6210 の修正（testNamePattern の `' > '` 結合対応）を含むか確認する。バージョンが vitest-runner 単体でなく core 同梱の新メジャー（例: 11.x）なら core も同時に更新する
2. `npm install -D @stryker-mutator/core@<new> @stryker-mutator/vitest-runner@<new>`
3. 小さい対象で部分実行し、`testsCompleted > 0` になることを先に確認する（全量実行は時間がかかるため）
4. `npm run test:mutate` を全量実行し、スコアと生残ミュータントを記録する（html レポーターで詳細確認）
5. 生残ミュータントを理由分類し、テスト不足があれば後続タスクを切り出す
6. `dev-docs/TEST_RULE.md` の既知制約節を更新する
7. `npm run validate` を実行する

## 実装者向け注記

### 現状コードの確認（2026-09-26 起票時点の実施済み確認）

- `package.json`: `test:mutate` スクリプトと `@stryker-mutator/core` / `@stryker-mutator/vitest-runner` ^10.0.0 が存在する
- `stryker.config.json`: testRunner `vitest`、`coverageAnalysis: "all"`、mutate `src/**/*.ts`（テスト除外）、thresholds break 50 / low 60 / high 80
- `dev-docs/TEST_RULE.md`: 「ミューテーションテスト（Stryker）」節に既知制約と Red/Green 手動検証の代替運用を記載済み
- `pbi/` 配下に Stryker 関連の PBI は本件以外に存在しない（重複なし）
- `src/`・`testDir/`・`eslint/` に TEST_RULE.md の本文を参照して壊れるテストはない（`eslint/rules/no-tautology-expect.mjs` 等はエラーメッセージ内の参照のみ）

### 落とし穴

- `peerDependencies` が `">=2.0.0"` のため、「インストールできた = Vitest 5 対応」ではない。#6210 の修正を含むバージョンかを必ず確認する
- 失敗が exit 0 で完走するため、「コマンド成功 = 正常」ではない。`Ran N tests per mutant` が 0 でないことを必ず確認する
- 名前フィルタ問題とは別に静的ミュータント誤判定の報告がある。`coverageAnalysis` を `perTest` や `off` に変えても直らない可能性があり、その場合は上流に別 issue として起票する
- 初回の実効スコアが thresholds.break（50%）を下回ると `npm run test:mutate` は失敗する。この場合、テストを補強するか break を調整するかの裁定が必要であり、安易に break を下げて「固定待ちを追加して緑にする」のと同じ隠蔽をしないこと
- 全量ミューテーション実行は長時間を要する（テスト 14,000+）。CI への組込みは既存の実行時間契約（dev-docs/ADR test-suite-execution-time-contract）との整合を確認してからにする
- `npm run test:mutate` を実行する前に `npm run build` の要否を TEST_RULE.md の現行記述と突き合わせる

## 技術的考慮事項

- 依存関係: 上流 stryker-mutator/stryker-js のリリース（外部依存）。本リポジトリ内の他タスクとの依存なし
- テスタビリティ: 検証は実行ベース（部分実行 → 全量実行の 2 段階）
- ロールバック: 依存バージョンを 10.0.0 に戻す git revert のみで可。storage・manifest・ユーザー向け挙動への影響はない（devDependency のみの変更）
- Vitest ダウングレード（4.x）は採用しない方針。本リポジトリは Vitest 5 / Vite 8 前提に統一済みで、ダウングレードは他ツールへ波及する

## 見積もり

1 SP（依存更新 + 検証 + docs 更新。生残ミュータントへのテスト追加は含まない）

トリガー発火まで着手しない。トリガー未発火での作業は上流の状況確認（バージョン・issue チェック）のみで、その結果を本 PBI のステータスに追記する。

## 決定事項

1. **なぜスコアが信頼できないのか**: vitest-runner 10.0.0 が Vitest 5 の `testNamePattern` 変更（`' > '` 結合）に未対応だから
2. **なぜ今すぐ直せないのか**: 修正は上流コードにあり、ローカル回避（config 変更・coverageAnalysis 変更）ではスコアの信頼性が回復しないから。現行の正当な代替は Red/Green 手動検証
3. **なぜ Vitest を 4.x に下げないのか**: Vitest 5 / Vite 8 前提への統一が済んでおり、ダウングレードの波及コストが 1 SP の採用待ちより大きいから
4. **なぜ監視でよいのか**: 上流は活発で修正 PR (#6220) が存在し、複数ユーザーが同じシグネチャを報告しているため放置される可能性が低く、リリース後の採用は小タスクだから
5. **トリガーは何か**: npm 上で #6210 修正を含む vitest-runner 新版がリリースされた時、または Vitest 4.x へのダウングレードがユーザー裁定された時

## Definition of Done

- [ ] 依存更新後、`npm run test:mutate` が実効スコアを出す（出力の記録あり）
- [ ] 生残ミュータントの理由分類が記録され、テスト不足分の後続タスクが切り出されている
- [ ] `dev-docs/TEST_RULE.md` が更新されている
- [ ] `npm run validate` が通る
- [ ] `pbi/00-INDEX.md` の当該行が「完了」に更新され、アーカイブ手順に従って `git mv` されている
