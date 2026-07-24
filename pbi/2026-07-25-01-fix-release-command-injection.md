# PBI: release.yml のコマンドインジェクション脆弱性を修正

## ユーザーストーリー

リリースメンテナーとして、CIワークフロー内のシェル変数展開が安全に行われるようにしたい。なぜなら、`package.json` の version フィールドが改変された場合に、 secrets （CRX_PRIVATE_KEY など）が流出したり、任意コードが実行されたりするリスクを排除する必要があるから。

## ビジネス価値

- 悪意ある PR や侵害されたアカウントからの CI パイプライン攻撃を防止
- リリースプロセスの信頼性を維持し、ユーザーの拡張機能の安全性を担保

## BDD受け入れシナリオ

```gherkin
Scenario: version フィールドにシェルメタ文字が含まれていても安全に展開される
  Given package.json の version が "1.0.0\"; echo pwned #" になっている
  When release.yml の "Sign CRX with private key" ステップが実行される
  Then シェルは node コマンドのみを実行する
  And echo pwned などの注入コマンドは実行されない

Scenario: 通常の semver version が正しく展開される
  Given package.json の version が "6.6.2" である
  When release.yml のビルドステップが実行される
  Then dist/yasumaro-6.6.2-chrome.zip のような正しいパスが生成される
```

## 受け入れ基準

- [ ] `${{ steps.version.outputs.version }}` の展開が env 変数経由 + 二重引用符で囲まれた変数展開に置き換わっている
- [ ] 同様の `${{ }}` 展開を含むすべての shell `run:` ブロックが env 変数化されている
- [ ] `version` に `"; ... #` などの文字列を設定した場合でも、CIステップがコマンドを実行しない
- [ ] 通常の semver version （例: `6.6.2`）でもパスが正しく構築される

## テスト戦略（t_wadaスタイル）

### 統合テスト
- `act` または GitHub Actions の dry-run で、malicious version 時に `node` のみが呼ばれることを検証
- 通常 version 時に期待されるファイルパスが生成されることを検証

### 単体テスト
- シェル変数展開の挙動を検証する最小スクリプト（bash 単体）
- `version` にメタ文字を含めた場合のトークン化テスト

## 実装アプローチ

- **Outside-In**: ワークフロー全体のシェル展開を確認し、注入点を特定してから修正
- **Red-Green-Refactor**: 悪意ある version を想定したテストを先に書き、修正後にパスを確認

## 見積もり

🟡中（2pt）

## 技術的考慮事項

- 修正対象: `.github/workflows/release.yml` の `run:` ブロック
- `secrets.CRX_PRIVATE_KEY` を含む環境変数が同じステップで使用されているため、注入が成功すると即座に漏洩
- `node:` プロトコル等の変更は本PBIのスコープ外

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "steps.version.outputs.version" .github/workflows/release.yml
```

### 実装手順
1. `release.yml` の各 `run:` ステップで `${{ steps.version.outputs.version }}` を使っている箇所を列挙
2. `env:` セクションで `VERSION: ${{ steps.version.outputs.version }}` を定義
3. shell スクリプト内では `"dist/yasumaro-${VERSION}-chrome.zip"` のように二重引用符で囲んで展開
4. 同様に他の `${{ }}` 展開（`github.ref_name` 等）も env 変数化する

### 落とし穴
- GitHub Actions の `${{ }}` 展開はシェルパースの前に行われるため、変数値のメタ文字は生きたシェル構文として解釈される
- 単にシングルクォートで囲んでも `${{ }}` 展開は起こるので、env 変数化が必要

## Definition of Done

- [ ] 全BDDシナリオが検証可能な形で実装・パスしている
- [ ] コードレビュー完了
- [ ] 既存の正常系リリースフローが壊れていないことの確認
