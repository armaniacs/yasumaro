# デフォルトポート移行ガイド (27123 → 27124)

## 概要

Obsidian Smart History バージョン 3.9.8 から、デフォルトの通信設定が変更されました。

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| プロトコル | HTTP | HTTPS |
| ポート | 27123 | 27124 |

この変更は、セキュリティ強化（HTTPS暗号化）のために行われたものです。

---

## 対象となるユーザー

以下の条件に該当するユーザーは、設定変更が必要です：

- ✅ **設定変更が必要**: デフォルト設定のまま使用しているユーザー
- ⚠️ **設定変更が必要**: 以前に一度設定してから変更していないユーザー
- ❌ **変更不要**: 既に HTTPS (ポート27124) を使用しているユーザー

---

## 移行手順

### ステップ1: Obsidian で HTTPS を有効にする

1. Obsidian を開く
2. `設定`（歯車アイコン）をクリック
3. `コア拡張機能 > Local REST API` を開く
4. 以下の設定を確認・変更

   | 項目 | 設定値 |
   |------|--------|
   | Local REST API を有効にする | ✅ ON |
   | プロトコル | HTTPS |
   | ポート | 27124 |

5. `設定を保存` をクリック

### ステップ2: 拡張機能の設定を変更する

1. Chrome 拡張機能のポップアップを開く（ツールバーのアイコンをクリック）
2. `設定` をクリック
3. 以下の設定を変更

   | 項目 | 変更前 | 変更後 |
   |------|--------|--------|
   | Obsidian Protocol | http | **https** |
   | Obsidian Port | 27123 | **27124** |

4. `保存` をクリック

### ステップ3: 接続確認

1. 適当なWebページを開く
2. 拡張機能ポップアップを開く
3. 「テスト接続」ボタンをクリック
4. 接続成功のメッセージが表示されれば完了 ✅

---

## 執筆者向けの HTTPS セットアップ方法

HTTPS を使用するには、SSL 証明書の設定が必要です。以下の手順で設定してください。

### 方法1: OpenSSL を使用する（macOS / Linux）

```bash
# 証明書と秘密鍵を作成
openssl req -x509 -newkey rsa:4096 -keyout obsidian_key.pem -out obsidian_cert.pem -days 365 -nodes -subj "/CN=localhost"

# 作成されたファイルを保存場所に移動（例：~/.config/obsidian/）
mv obsidian_cert.pem ~/.config/obsidian/
mv obsidian_key.pem ~/.config/obsidian/

# パーミッションを設定
chmod 600 ~/.config/obsidian/obsidian_key.pem
chmod 644 ~/.config/obsidian/obsidian_cert.pem
```

### 方法2: mkcert を使用する（推奨）

```bash
# mkcert をインストール
brew install mkcert  # macOS
# または: brew install nss  # macOS用の依存パッケージ

# CAのインストール（初回のみ）
mkcert -install

# 証明書を作成
mkdir -p ~/.config/obsidian
mkcert -cert-file ~/.config/obsidian/obsidian_cert.pem -key-file ~/.config/obsidian/obsidian_key.pem localhost 127.0.0.1
```

### Obsidian での証明書設定

1. Obsidian の `設定 > コア拡張機能 > Local REST API` を開く
2. 以下を設定

| 項目 | 設定値 |
|------|--------|
| プロトコル | HTTPS |
| ポート | 27124 |
| 証明書のパス | `~/.config/obsidian/obsidian_cert.pem` |
| 秘密鍵のパス | `~/.config/obsidian/obsidian_key.pem` |

---

## よくある質問

### Q: なぜ変更が必要なのですか？

A: HTTPS 暗号化通信により、セキュリティが強化されます。API キーやプライベートページの内容が暗号化され、中間者攻撃などのリスクを軽減できます。

### Q: 設定を変更しないとどうなりますか？

A: 接続エラーが発生し、Webページが記録できなくなります。

### Q: HTTP (ポート27123) のまま使い続けることはできますか？

A: 可能ですが、推奨しません。以下の設定を手動で変更することで従来の動作に戻せます：

| 項目 | 設定値 |
|------|--------|
| Obsidian Protocol | http |
| Obsidian Port | 27123 |

ただし、暗号化されていない通信を使用することになるため、セキュリティ上のリスクがあります。

### Q: HTTPS で証明書エラーが表示されます

A: 自己署名証明書（自己発行の証明書）を使用している場合、ブラウザから警告が表示されることがあります。これは正常な動作です。拡張機能はローカル接続のため、この警告を無視して接続できます。

### Q: Windows ではどうすればいいですか？

A: OpenSSL for Windows をインストールするか、PowerShell を使用して証明書を作成できます。詳細は以下のコマンドを参照してください：

```powershell
# PowerShell で証明書を作成する例
$cert = New-SelfSignedCertificate -DnsName localhost -CertStoreLocation Cert:\LocalMachine\My
Export-Certificate -Cert $cert -FilePath "C:\path\to\obsidian_cert.pem"
```

---

## トラブルシューティング

### 接続エラーが発生する

1. **Obsidian で Local REST API が有効になっているか確認**
   - `設定 > コア拡張機能 > Local REST API` をチェック

2. **ポート番号が正しいか確認**
   - Obsidian と拡張機能の両方で `27124` が設定されているか確認

3. **ファイアウォールを確認**
   - ポート 27124 が許可されているか確認

4. **URL を手動でテスト**
   ```bash
   # macOS / Linux
   curl -k https://localhost:27124/

   # Windows (PowerShell)
   curl -k https://localhost:27124/
   ```

   正常に設定されていれば、`{"message":"Hello from Local REST API"}` のような応答が返ります。

### 証明書エラーが続く

証明書のパスが正しいか確認してください：

```bash
# ファイルが存在するか確認
ls -l ~/.config/obsidian/obsidian_cert.pem
ls -l ~/.config/obsidian/obsidian_key.pem
```

---

## 技術詳細

この変更に関する技術的な背景は、以下の ADR を参照してください：

- [ADR-002: Default Port Migration to 27124 for HTTPS Support](./ADR/2026-02-22-port-migration-to-https.md)

---

## サポート

移行に関する問題が発生した場合は、以下の方法でサポートを受けてください：

1. [GitHub Issues](https://github.com/your-repo/obsidian-smart-history/issues)
2. [ドキュメント](https://your-repo.github.io/obsidian-smart-history/)

---

## リリース情報

- **バージョン**: 3.9.8
- **リリース日**: 2026年2月22日
- **ADR**: [2026-02-22-port-migration-to-https.md](./ADR/2026-02-22-port-migration-to-https.md)