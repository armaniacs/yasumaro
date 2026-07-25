# PBI: OAuth 認証失敗時の CI ログ漏洩を防止

## ユーザーストーリー

リリースメンテナーとして、Chrome Web Store API への OAuth 認証が失敗したときに、ログに機密情報（access token など）が出力されないようにしたい。なぜなら、CI ログはリポジトリ read 権限を持つ全ユーザーが閲覧でき、流出したトークンは悪用される可能性があるから。

## ビジネス価値

- リリースCIログからの認証トークン漏洩リスクを低減
- インシデント発生時の影響範囲を限定

## BDD受け入れシナリオ

```gherkin
Scenario: OAuth 認証失敗時に機密情報を含まないログを出力する
  Given Chrome Web Store API の OAuth 認証が失敗する
  When release.yml の "Publish to Chrome Web Store" ステップが実行される
  Then ログに access_token や refresh_token が含まれていない
  And エラー原因を特定できる最小限の情報（error フィールドなど）が出力される

Scenario: 認証レスポンスに access_token が含まれていてもマスクされる
  Given OAuth レスポンスに access_token が含まれている
  When レスポンスをログ出力する処理が走る
  Then access_token の値がマスクまたは削除されて出力される
```

## 受け入れ基準

- [ ] 認証失敗時の `FULL_RESP` ダンプが削除または機密フィールドをマスクした上で出力される
- [ ] ログに `access_token`, `refresh_token`, `client_secret` が含まれない
- [ ] 認証失敗を人間が診断できる最低限の情報は残る（error / error_description 等）

## テスト戦略（t_wadaスタイル）

### 統合テスト
- `act` または CI dry-run で OAuth エラーレスポンスを返すモックを立て、ログ出力を検証
- 標準エラー / 標準出力に機密文字列が含まれないことをアサート

### 単体テスト
- Python / bash レベルで JSON レスポンスから機密フィールドを削除する関数のテスト
- 正規表現や jq を使ったマスク処理のテスト

## 実装アプローチ

- **Outside-In**: リリースログの出力形式を確認し、安全な出力に置き換え
- **Red-Green-Refactor**: 機密レスポンスを模したテストを先に作成し、マスク処理を実装

## 見積もり

🟢低（1pt）

## 技術的考慮事項

- 修正対象: `.github/workflows/release.yml` の "Publish to Chrome Web Store" ステップ
- 現状 `python3 -m json.tool` で full response を整形出力している
- `jq` がない環境を想定し、python3 ベースのマスク処理とする

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "FULL_RESP" .github/workflows/release.yml
```

### 実装手順
1. 認証失敗時の full response ダンプを削除するか、機密フィールドを削除してから出力
2. Python スクリプト例:
   ```python
   import sys, json
   d = json.load(sys.stdin)
   for k in ('access_token', 'refresh_token', 'client_secret'):
       d.pop(k, None)
   print(json.dumps(d, indent=2))
   ```
3. 人間が読めるエラー概要（`error`, `error_description`）を明示的に出力

### 落とし穴
- `python3 -m json.tool` はすべてのフィールドをそのまま出力する
- レスポンスに `id_token` や `scope` など、追加の機密・準機密フィールドが含まれる可能性がある
- ログの「機密情報を含まない」ことを完全に証明するのは難しいため、マスク対象フィールドをリスト化して保守する

## Definition of Done

- [ ] 認証失敗時のログが機密情報を含まないことを検証するテストが追加されている
- [ ] コードレビュー完了
- [ ] 正常系の認証フローが影響を受けていないことの確認
