# PBI: AI プロバイダー最適化 & サプライチェーン健全化

## ユーザーストーリー
**運用者**として、**AI API呼び出しが効率的で、依存関係が健全**であることを望む、なぜなら**不要なトークン消費を避け、ライセンスリスクを排除したい**から

## ビジネス価値
- AI API コストの削減（リトライの冪等性確保）
- ライセンス違反リスクの排除
- 依存関係の推移的脆弱性の検出

## BDD受け入れシナリオ

```gherkin
Scenario: AI API タイムアウト時にリトライが1回に制限される
  Given OpenAIProviderのfetchWithRetry
  When タイムアウトエラーが発生する
  Then リトライは1回のみ実行される
  And 2回目のタイムアウト後はエラーが返される
  And トークン消費が最大2回分に制限される

Scenario: AI API レートリミット時はリトライが抑制される
  Given OpenAIProviderのfetchWithRetry
  When 429 (Rate Limit) エラーが発生する
  Then リトライは実行されない
  And ユーザーにレートリミット通知が表示される

Scenario: wa-sqliteのライセンスが記録されている
  Given package-lock.jsonのwa-sqliteエントリ
  When SBOM生成ツールがライセンスをチェックする
  Then MITライセンスが正しく記録されている
  And third-party-noticesにMITライセンス全文が含まれている

Scenario: htmlparser2のオーバーライドが不要になったら検出される
  Given .npmrcまたはCIスクリプト
  When Node.jsバージョンが25以上にアップデートされる
  Then overrides削除後のnpm testが自動実行される
  And テストがパスすればオーバーライド不要と通知される

Scenario: favicon権限がモバイルChromeで警告を出さない
  Given wxt.config.tsのpermissions
  When モバイルChromeで拡張機能をインストールする
  Then favicon権限がoptional_permissionsに移動されている
  And インストール警告が表示されない

Scenario: AI要約プロンプトが多言語に対応している
  Given ブラウザ言語が韓国語（ko）のユーザー
  When AI要約機能が呼ばれる
  Then 韓国語プロンプトが使用される
  And 英語フォールバックは発生しない
```

## 受け入れ基準
- [ ] `fetchWithRetry`のタイムアウト時リトライを1回に制限
- [ ] 429 (Rate Limit) 時はリトライしない
- [ ] wa-sqliteのライセンスをpackage-lock.jsonに記録
- [ ] third-party-noticesにMITライセンス全文を追加
- [ ] htmlparser2オーバーライドの存続可否をCIで自動チェック
- [ ] favicon権限をoptional_permissionsに移動
- [ ] AIプロンプトの言語フォールバックを多段階化（ko→en, zh→ja）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `fetchWithRetry`のリトライ制限テスト
- 429エラー時のリトライ抑制テスト
- 言語フォールバックの多段階テスト

### 統合テスト
- CIスクリプトのhtmlparser2オーバーライドチェック
- モバイルChromeでの権限安裝テスト

## 実装アプローチ
- **Outside-In**: 単体テスト（リトライ制限）→ 統合テスト（CI/権限）
- **Red-Green-Refactor**: 各テストが失敗することを確認してから実装

## 見積もり
5 ポイント（小規模）

## 技術的考慮事項
- 依存関係: なし（既存機能の改善）
- テスタビリティ: fetchモックでリトライ動作をテスト
- 非機能要件: コスト削減、ライセンス準拠

## 実装者向け注記

### 現状コードの確認
```bash
# fetchWithRetryの実装を確認
grep -n "fetchWithRetry\|maxRetryCount" src/background/ai/providers/OpenAIProvider.ts

# wa-sqliteのライセンス情報を確認
grep -A5 "wa-sqlite" package-lock.json | head -10

# favicon権限の場所を確認
grep -n "favicon" wxt.config.ts manifest.json 2>/dev/null

# AIプロンプトの言語判定を確認
grep -n "getBrowserLocale\|language" src/utils/customPromptUtils.ts
```

### 実装手順
1. `fetchWithRetry`のリトライ制限を実装（タイムアウト1回、429は0回）
2. `npm install`を再実行してwa-sqliteのライセンス情報を取得
3. third-party-noticesファイルを作成/更新
4. CIスクリプトにhtmlparser2オーバーライドチェックを追加
5. favicon権限をoptional_permissionsに移動
6. AIプロンプトの言語フォールバックを多段階化

### 落とし穴
- `fetchWithRetry`のリトライ制限はステータスコードごとに設定
- wa-sqliteのライセンスがpackage-lock.jsonにない場合、手動で確認・記録
- htmlparser2オーバーライド削除後はNode.js 24以下でテストが失敗する可能性
- favicon権限は`chrome.tabs.get()`の`favIconUrl`で代替可能

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ライセンス文書更新済み
