# PBI: CI ワークフローの責務整理と統合

## ユーザーストーリー
開発者として、CI ワークフローが重複した検証を実行しないでほしい、なぜなら CI 分数の無駄と結果の混乱を防ぎ、迅速なフィードバックを得たいから。

## ビジネス価値
- GitHub Actions の billed minutes 削減（推定50%削減）
- PR 作成者の混乱防止（重複した CI 実行結果を整理する時間削減）
- メンテナンスコスト低減（3→2ファイルに整理）

## 現状分析

### 全6ワークフローのトリガーマトリックス

| ワークフロー | PR | push main | tag push (v*) |
|------------|:--:|:---------:|:------------:|
| **ci.yml** | ✅ validate+build | ✅ validate+build | — |
| **tests.yml** | ✅ type-check+test+E2E | — | — |
| **validate.yml** | ✅ type-check+test+PRコメント | ✅ type-check+test（←無駄） | — |
| release.yml | — | — | ✅ zip+リリース |
| coverage.yml | — | ✅ test:coverage | — |
| pages.yml | — | ✅ (docs/**変更時) | — |

### 重複の内訳

**PR作成時（3重実行）:**
```
ci.yml:     npm ci → npm run validate (= type-check + test) → build
tests.yml:  npm ci → type-check → test → E2E
validate.yml:npm ci → type-check → test → PRコメント
           ^^^^^                                    ^^^^
           同じ validate が3回                        build も ci + validate で重複
```

**main push 時（2重実行）:**
```
ci.yml:      npm ci → validate → build
validate.yml: npm ci → type-check → test → PRコメント（←条件でスキップされるがジョブは実行）
coverage.yml: npm ci → test:coverage
```

### 定量効果（予測）

| 指標 | 現状 | 改善後（案C） | 削減率 |
|------|:---:|:-----------:|:-----:|
| PR時のvalidate実行回数 | **3回** | **1回**（tests.ymlのみ） | 66% |
| PR時のbilled minutes目安 | 6-9分 | 3-4分 | 50% |
| ワークフローファイル数（CI系） | 3ファイル | **2ファイル** | 33% |
| main push時のvalidate実行回数 | 2回 | 1回（ci.ymlのみ） | 50% |

## BDD 受け入れシナリオ

```gherkin
Scenario: PR作成時に重複なく検証が実行される
  Given 開発者が feature ブランチで PR を作成した
  When  CI ワークフローが起動する
  Then  同一コミットに対して type-check と test が2回以上実行されない
  And   Playwright E2E テストが正しく実行される
  And   PR に検証結果コメントが投稿される

Scenario: main への push 時に必要十分な検証が実行される
  Given 開発者が main ブランチに直接 push した
  When  CI が起動する
  Then  ci.yml で type-check と test と build が実行される
  And   tests.yml は起動しない（PR がないため）
  And   coverage.yml でカバレッジが計測される

Scenario: PR コメントが正しく投稿される
  Given tests.yml が実行を完了した
  When  PR イベントが原因である
  Then  PR に結果テーブルがコメントとして投稿される
  And   既存の Bot コメントがあれば上書き更新される
```

## 受け入れ基準
- [ ] PR 作成時に type-check + test が3回実行されなくなっている
- [ ] ci.yml が merge gate として正常に機能している
- [ ] PR コメント機能が維持されている
- [ ] Playwright E2E テストが PR で実行されている
- [ ] main push 時に tests.yml が起動しない（PR トリガーのみ）
- [ ] validate.yml が削除されている
- [ ] CONTRIBUTING.md の CI パイプライン説明が更新されている

## 実装アプローチ

### 採用: 案C（ci.yml + tests.yml の2本立て）

```
ci.yml (PR to main / push to main):
  validate → build                        # merge gate

tests.yml (PR only):
  validate → E2E → PRコメント             # PR feedback（validate.yml から移植）

# validate.yml は削除
```

### 変更内容

1. **`tests.yml`**: PR トリガーのみ（現状維持）。既存の validate + E2E ステップはそのまま。
2. **`tests.yml`**: `validate.yml` から PR コメント機能を移植（`actions/github-script@v7` のスクリプトブロック）。
3. **`validate.yml`**: 削除。
4. **`ci.yml`**: 現状維持（変更不要）。
5. **`CONTRIBUTING.md`**: ワークフロー一覧を更新。

### なぜ案Cか

| 案 | 方式 | 判断 |
|---|------|:----:|
| A | ci.yml に全部統合 | ❌ 単一WFが長大化、E2Eがvalidateを待つ |
| B | 責務完全分離 | ❌ ci.yml→pr-comment の連携に改造コスト大 |
| **C** | **ci.yml + tests.yml の2本立て** | **✅ 最小変更、最大効果** |

## 見積もり
2ストーリーポイント（設定ファイルの移動＋削除のみ）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: GitHub Actions の構文チェック + 実動作確認
- リスク: PR コメント機能の移植時に `steps` コンテキスト参照が壊れていないか要確認
- main プロテクションルール: ci.yml が必須チェックとして設定されていることの確認

## 実装者向け注記

### 現状コードの確認
```bash
ls -la .github/workflows/
```

### 実装手順
1. `tests.yml` の steps 末尾に `validate.yml:40-87` の PR コメントブロックを移植
   - `steps['type-check'].outcome` は tests.yml にも同名の step ID があるのでそのまま使える
   - `steps['run-tests'].outcome` も同様
2. `validate.yml` を `git rm` で削除
3. `npm test` がパスすることを確認
4. `CONTRIBUTING.md` の CI パイプライン節を更新（validate.yml 削除、tests.yml に PR コメント機能を追記）

### 移植する PR コメントブロック（validate.yml から）
```yaml
      - name: Comment PR with results
        if: always() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            // ...（既存の validate.yml のコードをそのまま）
```

### 落とし穴
- **PR コメントの条件は `github.event_name == 'pull_request'` のまま維持**。push to main ではコメント投稿しない
- tests.yml は `on: pull_request:` のみなので、push to main ではそもそも起動しない → `if` 条件の `pull_request` チェックは冗長だが明示的に残す
- ci.yml のブランチ制限は `branches: [main]` なので、feature/ ブランチからの PR では ci.yml は起動しない。tests.yml にブランチ制限はないので全ての PR で動く。これで OK。

## Definition of Done
- [ ] PR 作成時に type-check + test が1回だけ実行される
- [ ] main への push 時に tests.yml が起動しない
- [ ] PR コメント機能が動作する
- [ ] validate.yml が削除されている
- [ ] npm test がパスする
- [ ] コードレビュー完了
- [ ] CONTRIBUTING.md の CI パイプライン説明が更新されている
