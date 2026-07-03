# Verified CRX Upload 対応計画

Chrome Web Store の「検証済みCRXアップロード」を有効化し、CI/CD で署名済み CRX をアップロードする手順。

## 背景

- 2025年5月から提供開始されたオプトイン機能
- 開発者の RSA 秘密鍵で署名したパッケージのみ受け付けるようになり、アカウント乗っ取り時の不正公開を防止
- **有効化後は未署名の ZIP を API でアップロードしても拒否される**（既存 CI が壊れる）
- そのため、有効化前に CI の署名対応を完了させること

## 現状（2026-07-01 時点）

- RSA 鍵ペアを生成済み（ローカルに `yasumaro-private.pem` / `yasumaro-public.pem`）
- Chrome Web Store ダッシュボードの「有効にする」ボタンは審査中のためグレーアウト中
- 審査完了待ち（contextMenus パーミッションの正当な理由を提出済み）

## 審査完了後にやること

### 1. ダッシュボードで公開鍵を登録・有効化

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → Yasumaro → パッケージタブ
2. 「検証済みCRXアップロード」→「有効にする」をクリック
3. `cat yasumaro-public.pem` の出力を公開鍵欄に貼り付けて保存

### 2. GitHub Secrets に秘密鍵を登録

リポジトリの Settings → Secrets and variables → Actions で追加：

| Secret 名 | 値 |
|-----------|-----|
| `CRX_PRIVATE_KEY` | `yasumaro-private.pem` の全内容（`-----BEGIN PRIVATE KEY-----` から末尾まで） |

### 3. release.yml に署名ステップを追加

`npx wxt zip -b chrome` でZIPを生成した後、`dist/chrome-mv3/` ディレクトリを `crx3` で署名する：

```yaml
      - name: Sign CRX with private key
        env:
          CRX_PRIVATE_KEY: ${{ secrets.CRX_PRIVATE_KEY }}
        run: |
          echo "${CRX_PRIVATE_KEY}" > /tmp/private.pem
          npx crx3 dist/chrome-mv3/ \
            --key /tmp/private.pem \
            --crx dist/yasumaro-\${{ steps.version.outputs.version }}-chrome.crx
          rm /tmp/private.pem
```

> **備考**: `crx3` npm パッケージ（v2.0.0）を使用。`crx`（v5.0.1）は deprecated のため非推奨。WXT に CRX 署名機能は組み込まれていない。

そして Chrome Web Store API へのアップロードを ZIP → CRX に変更：

```yaml
ZIP_FILE: dist/yasumaro-${{ steps.version.outputs.version }}-chrome.crx  # .zip → .crx
```

### 4. 動作確認

- タグを切って CI を実行
- `Upload status: SUCCESS` かつ `Publish result: OK` または `IN_REVIEW` になることを確認

## 鍵の管理

- `yasumaro-private.pem` / `yasumaro-public.pem` は `.gitignore` に追加済み（`*.pem`）
- 秘密鍵はローカルと GitHub Secrets のみに保管。漏洩した場合は新しい鍵ペアを生成し直してダッシュボードで公開鍵を更新する

## 参考

- [Verified uploads in the Chrome Web Store | Chrome for Developers](https://developer.chrome.com/blog/verified-uploads-cws)
- [Chromium Extensions Group: Request to Revert Verified CRX Uploads Opt-In](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/Ea8sgxd0Afs)
