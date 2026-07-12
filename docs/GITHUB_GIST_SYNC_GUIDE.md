# GitHub Gist連携ガイド / GitHub Gist Sync Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、Obsidianの代わりに、または併用して、閲覧履歴を **GitHub Gist**（非公開のSecret Gist）に同期できます。Obsidianを使わないPC・端末からでも、GitHub経由で自分の閲覧履歴にアクセスしたい場合に便利です。

### 仕組み

- 履歴は1つの Secret Gist 内の `yasumaro-history.md` というMarkdownファイルに同期されます
- 初回同期時に Gist が自動作成され、以後は同じ Gist を更新（上書き）する形で同期されます
- 直近の未同期エントリを対象にバッチ処理で同期が行われます

### 設定方法

1. GitHubで **Personal Access Token（PAT）** を発行します（`gist` スコープが必要です）
2. ダッシュボードの「診断」パネルにある「GitHub Gist Sync」セクションを開きます
3. 「GitHub Gist 同期を有効にする」をONにし、発行したPATを入力します
4. 「保存」をクリックします
5. 「接続テスト」ボタンで、PATが正しく認証されるか確認します

PATはAPIキーと同様に暗号化されて保存されます。

### Obsidian連携との関係

GitHub Gist連携とObsidian連携は、それぞれ独立した同期先として並行動作します。どちらか一方が失敗しても、もう一方の同期には影響しません。両方を同時に有効にして、Obsidianをメインの記録先にしつつ、外出先からのアクセス用にGistも併用する、といった使い方ができます。

### トラブルシューティング

**Q. 接続テストで「Invalid GitHub PAT」と表示される**

PATの有効期限が切れているか、`gist` スコープが付与されていない可能性があります。GitHub側でPATを再発行し、`gist` スコープを付与してください。

**Q. 同期が反映されない**

PATが正しく設定され、「GitHub Gist 同期を有効にする」がONになっているか確認してください。同期はバッチ処理のため、記録直後ではなく多少の遅延を伴う場合があります。

---

## English

### Overview

Yasumaro can sync your browsing history to a **GitHub Gist** (a private Secret Gist), either instead of or alongside Obsidian. This is useful if you want to access your history via GitHub from a device where Obsidian isn't set up.

### How It Works

- History is synced to a single Markdown file, `yasumaro-history.md`, inside one Secret Gist
- On the first sync, the Gist is created automatically; subsequent syncs update (overwrite) the same Gist
- Sync runs in batches, targeting recently unsynced entries

### Setup

1. Generate a **Personal Access Token (PAT)** on GitHub (requires the `gist` scope)
2. Open the "GitHub Gist Sync" section in the dashboard's "Diagnostics" panel
3. Enable "Enable GitHub Gist Sync" and enter your PAT
4. Click "Save"
5. Use the "Test Connection" button to verify the PAT authenticates correctly

The PAT is encrypted before storage, just like other API keys.

### Relationship to Obsidian Sync

GitHub Gist sync and Obsidian sync run in parallel as independent sync targets. A failure in one does not affect the other. You can enable both simultaneously — for example, using Obsidian as your primary record while also keeping a Gist copy for access when you're away from your main machine.

### Troubleshooting

**Q. Test Connection shows "Invalid GitHub PAT"**

Your PAT may have expired or may not have the `gist` scope. Regenerate a PAT on GitHub with the `gist` scope granted.

**Q. Sync doesn't seem to update**

Verify the PAT is set correctly and "Enable GitHub Gist Sync" is ON. Sync runs as a batch process, so there may be a slight delay rather than an immediate update after recording.
