---
title: "Yasumaro v6.3.7 — Obsidian REST API のプロトコル設定を正しく反映するようになりました"
emoji: "🔐"
type: "tech"
topics: ["yasumaro", "chrome拡張機能", "obsidian", "リリースノート"]
published: false
---

Yasumaro v6.3.7 をリリースしました。今回の変更は小さなものですが、HTTP 環境で Obsidian Local REST API を使っている方には重要な修正です。

## HTTP が強制的に HTTPS に書き換わっていた問題

Yasumaro は Obsidian と通信する際、プロトコルを `http` または `https` から選べるようになっています。ダッシュボードの「詳細設定」にあるプロトコル欄です。

ところが、ここで `http` を選んでも、内部的にはすべてのリクエストが強制的に `https` にアップグレードされていました。このアップグレード処理自体は古いバージョンでセキュリティ強化のために追加されたものですが、結果として HTTP しか受け付けていない Obsidian Local REST API 環境では接続できない問題を引き起こしていました。

```
ユーザーの設定: http
  → Yasumaro 内部: enforceHttps() が https に書き換え
    → Obsidian が HTTP のみの場合 → 接続失敗
```

## 何を変えたか

v6.3.7 では、この強制アップグレードを削除し、ユーザーが選択したプロトコルをそのまま尊重するようになりました。

### 設定値の検証を追加

`enforceHttps()` を削除する代わりに、`_validateProtocol()` という検証メソッドを導入しました。

- `https` → そのまま使用
- `http` → そのまま使用（ただし警告を表示）
- 未設定 / 空文字 → `https` をデフォルトとして使用
- `ftp` などの不正な値 → エラーとして拒否

コードで見ると、次のようなシンプルな検証です。

```typescript
_validateProtocol(protocol: string | undefined | null): 'http' | 'https' {
  if (protocol === undefined || protocol === null || protocol === '') {
    return 'https';
  }
  const normalized = String(protocol).trim().toLowerCase();
  if (normalized !== 'http' && normalized !== 'https') {
    throw new Error('Protocol must be "http" or "https".');
  }
  if (normalized === 'http') {
    addLog(LogType.WARN, 'HTTP protocol selected — API key and data will be sent in plaintext...');
  }
  return normalized;
}
```

### HTTP 選択時の警告表示

`http` を選んだ場合、設定画面にアンバー色のインライン警告が表示されるようになりました。

- **ダッシュボード**（オプション画面）の「詳細設定」内
- **ポップアップ**の設定パネル内

![HTTP 警告のイメージ: プロトコル欄に http と入力すると、注意喚起のバナーが表示される]

警告メッセージは日本語と英語の両方に対応しています。

**日本語:** 「注意: HTTPを使用するとAPIキーとデータが平文で送信されます。ローカルネットワークが信頼できない場合はHTTPSを推奨します。」

**English:** "Warning: HTTP sends API key and data in plaintext. Use HTTPS for encrypted communication, especially on untrusted networks."

### バックグラウンドでもログ出力

UI の警告に加えて、Service Worker でも `LogType.WARN` レベルのログを出力するようにしました。HTTP が選択された状態でリクエストが発生するたびに記録されます。

## 影響を受けるケース

| あなたの設定 | v6.3.6 までの動作 | v6.3.7 での動作 |
|------------|------------------|----------------|
| `https`（デフォルト） | HTTPS で接続 | 変更なし |
| `http` を選択していて Obsidian が HTTP で Listen | 強制的に HTTPS にアップグレードされて接続失敗 | HTTP のまま接続成功 + 警告表示 |
| `http` を選択していて Obsidian が HTTPS で Listen | 強制的に HTTPS にアップグレードされて接続成功 | 接続失敗（設定と実態の不一致） |
| 空欄 / 未設定 | HTTPS で接続 | 変更なし（デフォルトは HTTPS） |

3行目のケースが気になるかもしれません。従来は「HTTP 設定なのに HTTPS で接続できていた」という隠れた救済がなくなります。もし接続できなくなった場合は、プロトコル設定を `https` に変更してください。

## 技術的な補足

今回の修正で削除した `enforceHttps()` は、`_fetchWithTimeout` という内部の fetch ラッパー関数の中で呼ばれていました。

```typescript
// Before: 強制アップグレード
async function _fetchWithTimeout(url: string, options) {
  const secureUrl = enforceHttps(url); // HTTP → HTTPS に書き換え
  const response = await fetch(secureUrl, options);
}

// After: URL をそのまま使用
async function _fetchWithTimeout(url: string, options) {
  const response = await fetch(url, options); // プロトコルを変更しない
}
```

ただし、`_fetchWithTimeout` に渡される URL は常に `_getConfig()` または `testConnection()` で構築されたものです。どちらも `_validateProtocol()` を経由しているため、不正なプロトコルが reach することはありません。URL 構築とプロトコル検証を分離することで、関心の分離を明確にしました。

## まとめ

v6.3.7 は次のような方におすすめのアップデートです。

- Obsidian Local REST API を HTTP で運用している（または検討している）
- 設定したプロトコルが正しく反映されないことに気づいていた
- HTTP 使用時のリスクを把握した上で使いたい

HTTP と HTTPS の選択は、ローカルネットワークの信頼性と運用のしやすさのトレードオフです。今回の変更により、その判断をユーザー自身が行えるようになりました。

Yasumaro は [GitHub](https://github.com/armaniacs/yasumaro) で開発しています。Issue や Pull Request をお待ちしています。
