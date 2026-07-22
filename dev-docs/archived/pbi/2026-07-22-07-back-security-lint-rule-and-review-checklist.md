# PBI: back-01-security-lint-rule-and-review-checklist

## ユーザーストーリー
Yasumaro開発者として、markdown出力経路でのサニタイズ漏れや危険なパターンを
コードレビュー前に自動検出したい。なぜなら、VulnHunter監査で発見された脆弱性の
多くが「明文化されたルールがない」ことに起因し、人間のレビューだけでは
検出が不安定だからだ。

## ビジネス価値
- セキュリティ脆弱性の再発防止
- コードレビューの負荷軽減（自動検出で人手を補完）
- プロジェクトのセキュリティ品質基準の定着

## 対象Finding（5 Whys分析より）
| 根本原因 | 対策 |
|---------|------|
| 全markdown出力経路へのサニタイズ適用ルール不在 | lint rule + レビューチェックリスト |
| `fetchWithTimeout` にレスポンスサイズ上限が設計時に定義されなかった | lint rule + テンプレート |
| 共通検証ロジックのDRY破綻 | レビューチェックリスト |
| 横断的アーキテクチャ標準化を担保する仕組みの不在 | レビューチェックリスト |

## BDD受け入れシナリオ

```gherkin
Scenario: markdownテンプレートに未サニタイズの変数があるとCIが失敗する
  Given 開発者が `${summary}` を markdown テンプレートに追加した
  And `sanitizeForObsidian()` を隣接する行に記述していない
  When `npm run lint` を実行する
  Then  lint エラーが報告され、CI が失敗する
  And 開発者はどの変数が不足しているかを特定できる

Scenario: fetch呼び出しにサイズ上限がないとCIが失敗する
  Given 開発者が `response.text()` を追加した
  And その前に `Content-Length` チェックまたはストリーミング上限を記述していない
  When `npm run lint` を実行する
  Then lint エラーが報告され、CI が失敗する

Scenario: レビューチェックリストが必須項目をカバーしている
  Given 開発者がPRを作成した
  When レビュワーがセキュリティチェックリストを確認する
  Then markdown出力経路・fetchサイズ上限・localhost検証の3観点が checklist に含まれている
```

## 受け入れ基準
- [ ] ESLint カスタムルール（または tslint/ biome 等プロジェクトの linter）にて、markdown テンプレート文字列内の `${...}` 変数が `sanitizeForObsidian()` で囲まれていない場合にエラーを出す
- [ ] `response.text()` 呼び出しの前にサイズ上限チェックまたは Content-Length 検証があることを検証するルール
- [ ] `.github/pull_request_template.md` または CODEOWNERS にセキュリティレビューチェックリストを追加
- [ ] 既存の Violation パターン（テストファイルでのgrepping）に対する誤検出（false positive）を抑制
- [ ] 新規 lint ルールが CI パイプラインに統合されている
- [ ] **5 Whys対策**: 3層対策（lint rule + チェックリスト + ADR）が実装され、セキュリティレビューの標準プロセスとして浸透している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] 実際の markdown テンプレートファイルを作成/変更 → lint が検出することを手動で確認

### 統合テスト
- [ ] テスト用の markdown ファイル（サニタイズあり/なし）を用意し、lint が正しく検出/非検出することを確認

### 単体テスト
- [ ] lint rule のロジック自体のユニットテスト（正常系/境界/誤検出ケース）

## 実装アプローチ
- **Outside-In**: 手動で脆弱性を作ったファイルで lint が検出することを確認 → ルール実装
- **Red-Green-Refactor**: 誤検出ケースを追加しながらルールを改良

## 見積もり
2pt（lint rule 実装 + チェックリスト作成）

## 技術的考慮事項
- **依存関係**: プロジェクトの既存 linter（ESLint/biome）を確認し、そのエコシステムに合わせる
- **テスタビリティ**: lint rule は AST レベルでテスト可能
- **非機能要件**: CI 実行時間への影響を監視。必要に応じて差分実行を検討

## 実装者向け注記

### graphify依存関係分析（2026-07-22）
```
「Security Architecture (CSP + API Keys + Notifications + Permissions)」ハイパーエッジ
「Concurrency Control Infrastructure」ハイパーエッジ
「VulnHunter 2026-07-21 Fix Batch」ハイパーエッジ
```
**重要な発見**: プロジェクトには複数のセキュリティ関連ハイパーエッジが存在し、セキュリティ強化の継続的な取り組みが確認できる。lint rule はこの強化の自動化レイヤーとして位置付けられる。

### なぜなぜ分析（2026-07-22）
**仮定**: 「lint rule を導入すれば再発防止できる」
- Why 1: なぜ再発防止が必要か → 人間のレビューだけではセキュリティパターンの漏れが発生するため
- Why 2: なぜ漏れが発生するか → レビュワーがセキュリティ要件を常に意識していないため
- Why 3: なぜ意識できないか → セキュリティ要件が暗黙的で、チェックリストとして明文化されていないため
- Why 4: なぜ明文化されていないか → セキュリティレビューの観点が個人の経験に依存しているため
- Why 5: なぜ個人依存か → プロジェクトにセキュリティレビューの標準プロセスが存在しないため
- **根本原因**: セキュリティレビューの標準プロセスの不在 → **対策**: lint rule + チェックリスト + ADR の3層で対策

### 現状コードの確認
```bash
# プロジェクトの linter を確認
cat package.json | grep -E '"eslint"|"biome"|"tslint"'
ls .eslintrc* .biomerc* tsconfig.json 2>/dev/null
```

### 実装手順
1. プロジェクトの linter を特定（ESLint  presumed）
2. markdown テンプレート検出ルールを実装:
   - テンプレートリテラル (backtick) 内の `${variable}` を検出
   - 直近の行に `sanitizeForObsidian(...)` があるか確認
3. `response.text()` 検出ルールを実装:
   - `response.text()` 呼び出しの前に size check があるか確認
4. `.github/pull_request_template.md` にセキュリティチェックリストを追加
5. CI ワークフローに lint ステップを追加（既存あれば統合）

### 落とし穴
- markdown テンプレートが複数行にわたる場合、`sanitizeForObsidian` の呼び出しが同じブロック内にないと誤検出
- `response.text()` の误検出を防ぐため、テストファイルは除外
- lint ルールのメンテナンスコストを考慮し、過度に厳しいルールは避ける

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 新規 lint ルールが CI で有効化されている
- [ ] セキュリティレビューチェックリストがドキュメント化されている
- [ ] `npm run lint` が既存コードで誤検出なく実行される
- [ ] コードレビュー完了
