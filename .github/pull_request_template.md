## 概要

<!-- 変更内容の簡潔な説明 -->

## セキュリティチェックリスト

変更の種類に応じて該当項目を確認してください:

- [ ] **markdown出力**: 新規/変更したmarkdownテンプレートには `sanitizeForObsidian()` または `sanitizeUrlForMarkdownTarget()` が適用されている
- [ ] **fetch呼び出し**: 新規/変更した `response.text()` には Content-Length チェックまたはサイズ上限が先行している
- [ ] **localhost検証**: 新規/変更したループバック接続は ALLOWED_LOCALHOST_PORTS でポート検証されている
- [ ] **非推奨パターン**: `skipCspValidation: true, allowedUrls: null` のパターンをコピーしていない（代わりに明示的な許可リストを使用）
- [ ] **レート制限**: 新規/変更したパスワード認証経路には `checkRateLimit()`/`recordFailedAttempt()` が適用されている
- [ ] **鍵キャッシュ**: キャッシュされた暗号鍵を返す前に `IS_LOCKED` を確認している

## CI/CD Security

`docs/CI_SECURITY_CHECKLIST.md` も参照してください。

`.github/workflows/` を変更する場合:

- [ ] `run:` ブロックで `${{ }}` を直接展開していない（代わりに `env:` で変数化）
- [ ] シークレットやトークンがログに出力されていない
- [ ] ネットワーク呼び出し（curl 等）にタイムアウトが設定されている

## テスト結果

- [ ] `npm run type-check` がパス
- [ ] `npm test` がパス（または新規テスト追加済み）
- [ ] `npm run lint` がパス

## テスト品質チェック（[dev-docs/TEST_RULE.md](../dev-docs/TEST_RULE.md)）

新規/変更したテストがある場合に確認:

- [ ] **Red/Green検証**: 実装コードを一時的に壊した際、追加したテストが正しく失敗（Red）することを確認した
- [ ] **無意味なアサーションの不在**: `expect(true).toBe(true)` やモックの戻り値をそのまま比較するだけのテストが含まれていない
- [ ] **ミューテーションスコア**: 主要ロジックを変更した場合、`npm run test:mutate` のスコアが悪化していない

## チェンジログ

<!-- 変更内容を箇条書きで -->
- 
