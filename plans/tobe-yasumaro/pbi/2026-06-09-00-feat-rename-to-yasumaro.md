# PBI: リポジトリ・パッケージ名を yasumaro にリネーム

## ユーザーストーリー
**開発者として**、リポジトリ名とパッケージ名を `yasumaro` に統一したい、なぜなら Chrome Web Store公開に向けて「obsidian-weave」との名称混在を解消し、ブランドを確立したいから。

## ビジネス価値
- 既存ツール（Minecraft Mod「Obsidian Weave」・Obsidian公式プラグイン「Weave」）との名前衝突を回避
- Chrome Web Storeでの検索・発見性の向上

---

## BDD受け入れシナリオ

```gherkin
Scenario: パッケージ名とマニフェスト名がyasumaroに更新されている
  Given リネーム作業が完了している
  When package.json と manifest.json を確認する
  Then package.json の name が "yasumaro" である
  And manifest.json の name が "Yasumaro - AI Browsing Logger" である
  And npm run build がエラーなく完了する

Scenario: GitHubリポジトリのURLがリダイレクトされる
  Given GitHub上でリポジトリを obsidian-smart-history → yasumaro にリネームした
  When 旧URL https://github.com/armaniacs/obsidian-smart-history にアクセスする
  Then 新URL https://github.com/armaniacs/yasumaro に自動リダイレクトされる
```

---

## 受け入れ基準
- [ ] **【手動】** GitHub Settings でリポジトリ名を `yasumaro` に変更する
- [ ] `package.json` の `name` を `"yasumaro"` に変更する
- [ ] `manifest.json` の `name` を `"Yasumaro - AI Browsing Logger"` に変更する
- [ ] `manifest.json` の `description` を yasumaro として書き直す
- [ ] `README.md` のタイトル・説明文を yasumaro 向けに更新する
- [ ] `AGENTS.md` の "Project Naming Guidelines" に `yasumaro` を追記する（`CLAUDE.md` から名称変更済み。現状反映済みのため確認のみ）
- [ ] `git remote set-url origin` で新URLに更新する（リポジトリリネーム後）
- [ ] `npm run build` と `npm validate` がパスする

---

## 実装者向け注記

### 手順

1. **GitHub Web UIでリネーム（手動）**
   - Settings → General → Repository name → `yasumaro` → Rename

2. **ローカルのremote URLを更新**
   ```bash
   git remote set-url origin https://github.com/armaniacs/yasumaro.git
   git remote -v  # 確認
   ```

3. **package.json 更新**
   ```json
   "name": "yasumaro"
   ```

4. **manifest.json 更新**
   ```json
   "name": "Yasumaro - AI Browsing Logger",
   "description": "AI-powered browsing logger with local SQLite storage"
   ```

5. **ドキュメント更新**
   - README.md のタイトル・GitHub リンク（`# Obsidian Weave` → `# Yasumaro` に変更）
   - AGENTS.md の Project Naming Guidelines（確認のみ、すでに yasumaro 記載済み）
   - AGENTS.md 内の `Obsidian Weave Chrome extension` → `Yasumaro Chrome extension` に変更

### 落とし穴
- GitHub リポジトリリネーム後、ローカルの `git remote` URLを忘れずに更新すること
- `obsidian-smart-history` や `obsidian-weave` という旧名称がコード内にハードコードされていないか確認すること:
  ```bash
  grep -rn "obsidian-smart-history\|obsidian-weave" --include="*.ts" --include="*.json" --include="*.md" .
  ```
- `README.md` のタイトル行が `# Obsidian Weave` のまま残っていないか確認すること
- `AGENTS.md` の冒頭説明に `Obsidian Weave Chrome extension` という旧名称が残っていないか確認すること
- `_locales/` ディレクトリは未作成。新規作成が必要。PBI #03, #08 の i18n 作業で作成すること

---

## 見積もり
**2ストーリーポイント**

## Definition of Done
- [x] GitHub リポジトリ名が `yasumaro` になっている
- [x] `git remote -v` が新URLを示している
- [x] `npm validate` がパスする（type-check 通過確認済み）
- [x] コードレビュー完了（2026-06-09）
- [ ] `README.md` のタイトルを `# Obsidian Weave` から `# Yasumaro` に更新する（未完了）
- [ ] `AGENTS.md` 内の `Obsidian Weave Chrome extension` → `Yasumaro Chrome extension` に更新する（未完了）
- [ ] `_locales/` ディレクトリが未作成であることを確認し、i18n移行タスクとして記録する
