# PBI: GitHub Actions の immutable SHA ピン留め

## ユーザーストーリー
セキュリティエンジニアとして、CI パイプラインで使用するサードパーティアクションを immutable SHA でピン留めしたい、なぜなら mutable tag（`@v4`）が悪意あるコードに差し替えられるサプライチェーン攻撃を防ぎたいから。

## ビジネス価値
- サプライチェーン攻撃のリスク低減（mutable tag 差し替え対策）
- 決定論的な CI 実行の保証（同じコミットハッシュで常に同じアクションが実行される）
- Dependabot による SHA 更新の自動管理が可能

## 現状

以下のアクションが major-version tag（可変参照）で使用されている：

| ファイル | アクション | 現状 | リスク |
|---------|-----------|------|-------|
| `ci.yml` | `actions/checkout@v4` | mutable tag | タグ差し替えで任意コード実行 |
| `ci.yml` | `actions/setup-node@v4` | mutable tag | 同上 |
| `ci.yml` | `actions/cache@v4` | mutable tag | 同上 |
| `ci.yml` | `actions/upload-artifact@v4` | mutable tag | 同上 |
| `tests.yml` | `actions/checkout@v4` | mutable tag | 同上 |
| `tests.yml` | `actions/setup-node@v4` | mutable tag | 同上 |
| `tests.yml` | `actions/cache@v4` | mutable tag | 同上 |
| `tests.yml` | `actions/upload-artifact@v4` | mutable tag | 同上 |
| `validate.yml` | `actions/checkout@v4` | mutable tag | 同上 |
| `validate.yml` | `actions/setup-node@v4` | mutable tag | 同上 |
| `validate.yml` | `actions/github-script@v7` | mutable tag | 同上 |

## BDD 受け入れシナリオ

```gherkin
Scenario: 全ワークフローのアクションが SHA でピン留めされている
  Given CI ワークフローファイルが N 個存在する
  When  各ファイルの uses: 行を検査する
  Then  すべての uses: が <owner>/<repo>@<40桁のSHA> 形式である
  And   major-version tag（@v4, @v7 等）が1つも残っていない

Scenario: Dependabot が SHA 更新を自動管理する
  Given Dependabot が actions の更新を監視している
  When  公式アクションにパッチバージョンの更新があった
  Then  Dependabot が SHA を更新した PR を自動生成する
  And   更新後の SHA もピン留め形式が維持される
```

## 受け入れ基準
- [ ] `.github/workflows/` 内の全 `uses:` 行が SHA ハッシュで指定されている
- [ ] `actions/*` のcurrent SHA ハッシュが調査・記録されている
- [ ] Dependabot の actions 更新設定が有効化されている
- [ ] 既存の CI 実行に影響がないこと
- [ ] 各アクションの SHA が現在の major-version tag が指すコミットと一致していること

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 修正後のワークフローで実際に CI を実行し全ステップが成功することを確認（手動）

### 統合テスト
- 各 YAML の `uses:` 行を正規表現で全件抽出し、SHA 形式を満たすことを自動検証するスクリプトを作成

### 単体テスト
- N/A（設定ファイルのみの変更）

## 実装アプローチ
- **Outside-In**: GitHub Actions の immutable SHA を調査 → YAML ファイルを修正 → Dependabot 設定追加 → CI 実行確認
- 各アクションの現在の SHA は GitHub のリリースページから取得するか、以下の方法で特定：
  ```bash
  # 例: actions/checkout の v4 タグが指す SHA を取得
  git ls-remote https://github.com/actions/checkout.git refs/tags/v4
  ```

## 見積もり
2〜3ストーリーポイント（単純な置換作業だが SHA 調査に時間がかかる）

## 技術的考慮事項
- 依存関係: なし（設定ファイルのみ）
- テスタビリティ: CI 実行による動作確認が必須
- 非機能要件: セキュリティ（サプライチェーン攻撃対策）

## 実装者向け注記

### SHA 取得方法
```bash
# 各アクションの最新 SHA を取得
gh api repos/actions/checkout/git/refs/tags/v4 --jq '.object.sha'
gh api repos/actions/setup-node/git/refs/tags/v4 --jq '.object.sha'
gh api repos/actions/cache/git/refs/tags/v4 --jq '.object.sha'
gh api repos/actions/upload-artifact/git/refs/tags/v4 --jq '.object.sha'
gh api repos/actions/github-script/git/refs/tags/v7 --jq '.object.sha'
```

### 実装手順
1. 全アクションの SHA ハッシュを取得する
2. 全ワークフローファイルの `uses:` 行を SHA に置換する
3. コメントで元のバージョンを明記する（例: `# actions/checkout@v4`）
4. `.github/dependabot.yml` に actions 更新設定を追加する
5. 各ワークフローが正常に動作することを CI 実行で確認する

### Dependabot 設定例
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### 落とし穴
- SHA はリベースや force push で変更される可能性がある。GitHub 公式アクションのタグは不変だが、SHA 取得後にタグが更新されていないことを確認すること
- すべてのアクションで SHA 形式に統一すること（一部だけ SHA、一部は tag の混在を避ける）

## Definition of Done
- [ ] 全ワークフローの全アクションが SHA でピン留めされている
- [ ] `.github/dependabot.yml` が actions 更新を監視するよう設定されている
- [ ] CI が正常にパスすること
- [ ] コードレビュー完了
