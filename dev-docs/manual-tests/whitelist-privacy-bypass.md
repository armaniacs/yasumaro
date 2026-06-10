# ホワイトリストプライバシーバイパス機能 手動テスト

## テスト環境
- Chrome拡張機能をビルド済み (`npm run build`)
- Chromeにロード済み

## テスト1: ホワイトリストドメインでの自動保存

### 前提条件
- ホワイトリストに `httpbin.org` を追加
  1. 拡張機能ポップアップを開く
  2. 「ドメインフィルター」タブをクリック
  3. ホワイトリストに `httpbin.org` を追加

### 手順
1. `https://httpbin.org/response-headers?Cache-Control=private` にアクセス
   - このURLは `Cache-Control: private` ヘッダーを返すため、プライベートページとして検出される
2. 拡張機能ポップアップを開く
3. 「📝 今すぐ記録」ボタンをクリック

### 期待結果
- ❌ プライバシー警告ダイアログが表示されない
- ✅ 「Saved to Obsidian」通知が表示される
- ✅ Obsidianに保存される

### デバッグログ確認
拡張機能のバックグラウンドページのコンソールで以下のログが記録されていることを確認:
```
[DEBUG] Whitelisted domain, bypassing privacy check
```

---

## テスト2: 非ホワイトリストドメインでの警告表示

### 前提条件
- ホワイトリストから `httpbin.org` を削除（または別のドメインでテスト）

### 手順
1. `https://httpbin.org/response-headers?Cache-Control=private` にアクセス
2. 拡張機能ポップアップを開く
3. 「📝 今すぐ記録」ボタンをクリック

### 期待結果
- ✅ プライバシー警告ダイアログが表示される
- ✅ 「このページはプライベートページである可能性があります」というメッセージが表示される
- ✅ 理由: `Cache-Control: private` が表示される

---

## テスト3: ワイルドカードパターンのマッチング

### 前提条件
- ホワイトリストに `*.httpbin.org` を追加

### 手順
1. `https://www.httpbin.org/response-headers?Cache-Control=private` にアクセス
   - サブドメイン `www.httpbin.org` を使用
2. 拡張機能ポップアップを開く
3. 「📝 今すぐ記録」ボタンをクリック

### 期待結果
- ❌ プライバシー警告ダイアログが表示されない（ワイルドカードマッチ）
- ✅ 「Saved to Obsidian」通知が表示される

---

## テスト4: PIIマスキングの確認

### 前提条件
- ホワイトリストに適当なドメインを追加
- Privacy Mode: `Masked Cloud` に設定

### 手順
1. ローカルにHTMLテストページを作成:
```html
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Cache-Control" content="private">
  <title>PII Test Page</title>
</head>
<body>
  <h1>個人情報テストページ</h1>
  <p>マイナンバー: 1234-5678-9012</p>
  <p>クレジットカード: 4111-1111-1111-1111</p>
  <p>メールアドレス: test@example.com</p>
</body>
</html>
```

2. このHTMLファイルをChromeで開く
3. ファイルのドメイン（`file://`）をホワイトリストに追加（または適当なローカルサーバーで公開）
4. 拡張機能ポップアップを開く
5. 「📝 今すぐ記録」ボタンをクリック

### 期待結果
- ❌ プライバシー警告ダイアログが表示されない（ホワイトリスト）
- ✅ Obsidianに保存されたMarkdownで、以下のようにマスクされている:
  - マイナンバー: `[MASKED:MYNUMBER]`
  - クレジットカード: `[MASKED:CREDITCARD]`
  - メールアドレス: `[MASKED:EMAIL]`

---

## テスト結果記録

| テスト | 結果 | 備考 |
|--------|------|------|
| テスト1: ホワイトリストドメインでの自動保存 | ⬜ PASS / ⬜ FAIL | |
| テスト2: 非ホワイトリストドメインでの警告表示 | ⬜ PASS / ⬜ FAIL | |
| テスト3: ワイルドカードパターンのマッチング | ⬜ PASS / ⬜ FAIL | |
| テスト4: PIIマスキングの確認 | ⬜ PASS / ⬜ FAIL | |

テスト実施日: __________
テスト実施者: __________