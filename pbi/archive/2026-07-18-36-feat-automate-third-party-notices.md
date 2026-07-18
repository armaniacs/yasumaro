# PBI: THIRD_PARTY_NOTICES.mdを推移的依存含め自動生成する仕組みをCIに導入

## ユーザーストーリー
OSSとして拡張機能を公開する立場として、全ての依存パッケージ（推移的依存を含む）のライセンス表記を正確に管理したい、なぜなら現状の `THIRD_PARTY_NOTICES.md` はランタイム依存3件のみを記載しており、`package.json` の70件超のdevDependencies・推移的依存が未記載で、GPL/AGPL混入リスクを見逃す可能性があるから

## ビジネス価値
- Chrome Web Store公開時の法的リスク低減（ライセンス表記の正確性）
- GPL/AGPL等の互換性に問題があるライセンスの混入を早期検出

## 実装者向け注記（フェーズ0の既実装確認結果）

Read・grep で確認済み:
- `THIRD_PARTY_NOTICES.md`（全75行）— `wa-sqlite` 等ランタイム依存のライセンス全文のみ記載
- `package.json:45` — `"license": "MIT"`（本プロジェクト自体のライセンス）
- `package.json` に `license-checker` や `generate-license-file` 等のライセンス集計ツールは現状導入されていない
- 対処案（親レポートより）: `license-checker` や `generate-license-file` などのツールで推移的依存を含む THIRD_PARTY_NOTICES を自動生成する仕組みをCIに組み込む

```bash
# 実装前の必須調査コマンド
cat THIRD_PARTY_NOTICES.md
grep -n "license-checker\|generate-license-file" package.json package-lock.json
ls .github/workflows/
```

## BDD受け入れシナリオ

```gherkin
Scenario: CIでライセンス一覧が自動生成される
  Given package.jsonに全依存関係（runtime + dev + 推移的依存）が定義されている
  When CIパイプラインでライセンスチェックツールを実行する
  Then 全依存パッケージのライセンス情報を含むレポートが生成される

Scenario: 問題のあるライセンス（GPL/AGPL等）が検出されたらCIが失敗する
  Given 依存関係の中にGPL系ライセンスのパッケージが混入している状況（テスト用に意図的に導入）
  When ライセンスチェックを実行する
  Then CIが失敗し、問題のあるパッケージ名とライセンス種別が明示される

Scenario: THIRD_PARTY_NOTICES.mdが自動更新される
  Given 依存関係に変更が加わった状態
  When ライセンス生成コマンドを実行する
  Then THIRD_PARTY_NOTICES.mdが最新の依存関係を反映して更新される
```

## 受け入れ基準
- [ ] `license-checker` または `generate-license-file` をdevDependenciesに追加
- [ ] npm scriptとして `npm run generate-notices`（仮称）を追加し、`THIRD_PARTY_NOTICES.md` を自動生成できるようにする
- [ ] CI（`.github/workflows/`）にライセンスチェックステップを追加し、許可されないライセンス（GPL, AGPL等）が検出された場合はビルドを失敗させる
- [ ] 現行の `THIRD_PARTY_NOTICES.md` を自動生成結果で置き換える

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- CI上でライセンスチェックスクリプトを実行し、正常終了すること・意図的な問題ライセンス混入時に失敗することをローカルで検証（CI設定のドライラン）

### 単体テスト
- 該当なし（既存ツールの設定作業が中心）

## 実装アプローチ
- ツール導入・設定作業が中心のため通常のTDDは適用しないが、「許可されないライセンスでCIが失敗する」という受け入れ条件については、意図的に問題パッケージをテスト的に追加して失敗を確認する検証ステップを踏む

## 見積もり
3pt（半日〜1日。ツール選定、許可ライセンスリストの設計、CI組み込みを含む）

## 技術的考慮事項
- 依存関係: `license-checker` 系ツールの新規導入
- テスタビリティ: CI設定のためローカルでのドライラン確認が中心
- 非機能要件: 法的コンプライアンス

## 落とし穴
- 許可するライセンスのホワイトリスト（MIT, ISC, BSD, Apache-2.0等）を決める際、既存の依存関係を実際にスキャンして「現状使用されているライセンス」を把握してからリストを確定すること。厳しすぎるホワイトリストにすると既存の正当な依存でCIが失敗し続ける
- devDependenciesまで含めると生成される`THIRD_PARTY_NOTICES.md`が非常に長大になる可能性がある。配布物（Chrome拡張機能自体）に実際にバンドルされる依存（runtime dependencies + バンドルされるツールチェーン成果物）のみに絞るか、devDependenciesも含めた完全版にするかは、Chrome Web Store公開要件を確認した上で判断する

## Definition of Done
- [x] ライセンスチェックツールが導入されている
- [x] `THIRD_PARTY_NOTICES.md` 自動生成コマンドが動作する
- [x] CIにライセンスチェックが組み込まれている
- [x] 意図的な問題ライセンス混入でCI失敗を確認済み
- [ ] コードレビュー完了
