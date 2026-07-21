# PBI: CI/CD と Makefile の開発フィードバック改善

元指摘: Checking Team (Medium: DX Advocate)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

## ユーザーストーリー

開発チームとして、CI の `validate` ジョブを type-check と test の別ステップに分割し、`Makefile` に高速なテストターゲットを追加したい。なぜなら、現在は `npm run validate`（type-check + test）が単一ステップで実行されており、type エラーがあるとテスト結果が一切表示されず、また `make test` はビルド + validate + E2E を直列実行して開発フィードバックループが長いから。

## ビジネス価値

- 開発者のフィードバックループ短縮
- CI 失敗時の情報量増加
- ローカル開発の効率化

## 前提・制約

- `.github/workflows/ci.yml:35-36` で `Validate (type-check + tests)` ステップが単一
- `dev-docs/Makefile:19-20` で `test: build; npm run validate && npm run test:e2e`
- `npm run validate` は内部で `npm run type-check && npm test`
- E2E テストは時間がかかるため、デフォルト `make test` からは外すことを検討

## BDD受け入れシナリオ

```gherkin
Feature: CI/DX improvements

  Scenario: CI shows type errors and test results separately
    Given a PR has both type errors and test failures
    When CI runs
    Then the Type Check step fails
    And the Run Tests step also runs and shows test failures

  Scenario: Quick test target skips build and E2E
    Given a developer runs `make test-quick`
    When it completes
    Then it runs only `npm run validate`
    And it does not run E2E tests

  Scenario: Unit test target runs quickly
    Given a developer runs `make test-unit`
    When it completes
    Then it runs only unit tests without full build
```

## 受け入れ基準

- [ ] `.github/workflows/ci.yml` の `validate` ジョブを `type-check` と `test` の別ステップに分割（並列実行可、または同一ジョブ内の連続ステップ）
- [ ] `dev-docs/Makefile` に `test-quick` ターゲットを追加（`npm run validate` のみ、ビルド不要）
- [ ] `dev-docs/Makefile` に `test-unit` ターゲットを追加（`npm test` のみ、ビルド不要）
- [ ] 既存の `make test` は `test-all` または変更なしのまま残す（後方互換性）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- なし

### 統合テスト
- `make test-quick` / `make test-unit` が期待通りのコマンドを実行することを確認
- CI ワークフローの YAML 構文検証（`act` または GitHub Actions 上で）

## 実装アプローチ

- **CI**: `.github/workflows/ci.yml` の `Validate` ステップを2つに分ける
  - `name: Type Check` → `run: npm run type-check`
  - `name: Run Tests` → `run: npm test`
- **Makefile**: `dev-docs/Makefile` に追加
  - `test-quick: npm run validate`
  - `test-unit: npm test`

## 見積もり
1pt（CI ステップ分割 + Makefile 追加）

## 副作用
🟢 なし — 開発/CI フローの改善のみ。

## 落とし穴
- CI ステップを並列化すると、type-check と test が同時に走りリソースを消費する。同一ジョブ内の連続ステップにしても情報分離の効果は得られる。
- `make test-quick` がビルドをスキップする場合、WASM コピーが不足しているとテストが失敗する可能性がある。`copy-wasm` との関係を明確にする。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] CI ワークフローが正常に動作することを確認
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
