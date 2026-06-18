# PBI: Chrome Web Store 公開準備（manifest 更新・プライバシーポリシー・ストア掲載情報）

> **🔄 着手ガード更新（2026-06-17 更新）**
>
> **本 PBI は v6.0.0 リリース直前に着手することを原則とする**ガードは **2026-06-17 にユーザーから「実施していきたい」との明示的指示**があったため、**準備フェーズ（P1: ドキュメント・素材準備）に限り即時着手可能**とした。
> ただし、**審査提出（P5）は v6.0.0 タグ打ち後**とし、それまでは ZIP アップロード・Developer Dashboard への登録は行わない。
>
> | フェーズ | 内容 | 着手可否 |
> |---------|------|---------|
> | P1 | ドキュメント整備（PRIVACY.md 更新、ストア説明文、PERMISSIONS.md、ZIP 化スクリプト） | ✅ **即時着手可** |
> | P2 | ストア用素材（128x128 ストアアイコン、1280x800 スクリーンショット）作成 | ✅ **即時着手可** |
> | P3 | `wxt.config.ts` 最終調整（`homepage_url` 追加、permission 最適化） | ✅ **即時着手可** |
> | P4 | GitHub Pages 用 HTML ラッパー作成・公開確認 | ✅ **即時着手可** |
> | P5 | Developer Dashboard 登録・審査提出 | ⛔ **v6.0.0 リリースタグ打設後** |
>
> 理由: Chrome Web Store への初回公開は「公式リリース発表」であり、v5.9.x のプレリリース番号で公開するとブランド毀損・アップデート運用の複雑化リスクがあるため。

---

## 📅 更新履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-06-09 | PBI 初版作成（version 5.9.1 想定） |
| 2026-06-11 | 着手ガード設定（v6.0.0 リリース直前のみ） |
| 2026-06-17 | **現状調査反映**: version 5.9.9 へ更新、WXT 環境反映、完了済み項目（DONE）/未着手項目（TODO）マーク、ストア素材準備を P1〜P2 に分割 |
| 2026-06-18 | **P1/P2/P3/P4 実施**: 完了済み項目を更新、手動対応項目を明記 |

---

## ユーザーストーリー

**yasumaro の開発者として**、Chrome Web Store に拡張機能を登録・公開できる状態にしたい、なぜなら世界中の Chrome ユーザーが簡単にインストールできるようにして、プロジェクトを公式リリースとして発表したいから。

## ビジネス価値

- Chrome Web Store への公開でユーザー獲得の摩擦が大幅減少する
- 公式ストア掲載により信頼性とリーチが向上する
- 「v6.0.0 リリース」と合わせて正式発表することでブランド毀損を防ぐ

---

## 🔍 現状調査結果（2026-06-18 更新）

### ✅ DONE（2026-06-18 時点で完了済み）

| 項目 | 状態 | 備考 |
|------|------|------|
| Manifest V3 構成 | ✅ | WXT (`wxt.config.ts`) で `manifest_version: 3` 設定済み |
| バージョン番号 `5.9.16` | ✅ | `package.json` と `wxt.config.ts` で一致 |
| `name` / `short_name` / `description` i18n | ✅ | `__MSG_extensionName__` で `_locales/{en,ja}/messages.json` 参照 |
| 拡張機能アイコン 16/48/128 px | ✅ | `public/icons/icon{16,48,128}.png` 実在確認済 |
| プライバシーポリシー（MD） | ✅ | `public/PRIVACY.md` / `docs/PRIVACY.md` バイリンガル |
| GitHub Pages デプロイ WF | ✅ | `.github/workflows/pages.yml` で `docs/` を自動デプロイ |
| バージョン整合性チェック | ✅ | `scripts/check-version-consistency.js` が `npm run build` 内で自動実行 |
| ビルド成功 | ✅ | `dist/chromium-mv3/` 生成済み（`manifest.json` 含む） |
| パーミッション実装確認 | ✅ | 全パーミッションが `src/` 配下の実装で実際に使用 |
| **`homepage_url` 追加** | ✅ | `wxt.config.ts` に `https://github.com/armaniacs/yasumaro` 追加済み（P3 完了） |
| **CHANGELOG.md v6.0.0 エントリ** | ✅ | `[Unreleased]` 直下に `[6.0.0] - TBD (Chrome Web Store 初回公開)` 追加済み（P1 完了） |
| **`docs/privacy.html` 作成** | ✅ | `docs/PRIVACY.md` を fetch して表示する SPA、ダークテーマ対応済み（P4 完了） |
| **`docs/index.html` フッター更新** | ✅ | プライバシーリンクを `privacy.html` へ変更済み（P4 完了） |
| **スクリーンショット撮影スクリプト** | ✅ | `dev-docs/store-assets/playwright/` に Playwright スクリプト作成済み（P2 完了） |
| **スクリーンショット（英語版 5 枚）** | ✅ | `dev-docs/store-assets/screenshots/en/` に保存済み |
| **スクリーンショット（日本語版 5 枚）** | ✅ | `dev-docs/store-assets/screenshots/ja/` に保存済み |

### 🖐 手動作業が必要な項目

以下の項目はツール制約またはアカウント権限の都合上、**あなたが手動で実施してください**。

| # | 項目 | タイミング | 手順 |
|---|------|-----------|------|
| 1 | **`git commit` → `git push`** | 今すぐ | ローカルの変更（`wxt.config.ts`, `CHANGELOG.md`, `docs/privacy.html`, `docs/index.html`, `dev-docs/store-assets/`）をコミットして `main` へマージ |
| 2 | **`privacy.html` の HTTP 200 確認** | push 後 | ブラウザで `https://armaniacs.github.io/yasumaro/privacy.html` を開いて正常表示を確認（GitHub Actions 完了後） |
| 3 | **スクリーンショット内容確認・選定** | 今すぐ | `dev-docs/store-assets/screenshots/en/` と `ja/` の各 5 枚を確認し、Store に掲載する枚数・組み合わせを決定 |
| 4 | **PERMISSIONS.md 新規作成** | v6.0.0 前 | 後述のパーミッション正当化表を元に `PERMISSIONS.md` を作成。審査申告用 |
| 5 | **PRIVACY.md「最終更新日」更新** | v6.0.0 時点 | `public/PRIVACY.md` と `docs/PRIVACY.md` の最終更新日を v6.0.0 リリース日に変更 |
| 6 | **ZIP パッケージ生成** | v6.0.0 後 | `cd dist/chromium-mv3 && zip -r ../../yasumaro-6.0.0.zip .` または `build:store` スクリプト整備 |
| 7 | **Developer Dashboard 登録** | v6.0.0 後 | $5 登録料支払い、「新規アイテム」作成、ZIP アップロード、審査提出 |

### ⚠️ まだ着手していない項目（v6.0.0 前に完了）

| # | 項目 | 優先度 |
|---|------|--------|
| 1 | `PERMISSIONS.md` 新規作成（9 パーミッション全正当化） | 必須 |
| 2 | `PRIVACY.md` 最終更新日更新（v6.0.0 リリース日） | 必須 |
| 3 | ZIP 生成スクリプト（`package.json` に `build:store` 追加） | 必須 |
| 4 | `.gitignore` に `*.zip` 追記（未確認） | 推奨 |

### 🟡 補足

- **GitHub リポジトリ**: `https://github.com/armaniacs/yasumaro`
- **GitHub Pages Privacy URL**: `https://armaniacs.github.io/yasumaro/privacy.html`（push 後に HTTP 200 要確認）
- **スクリーンショット撮影シーン**: 01_dashboard_calendar / 02_entry_detail / 03_popup_recording / 04_ai_provider_settings / 05_fts_search
- **審査期間**: 新規審査に 3〜8 週かかる場合あり。公開予定日の **4 週間前** には ZIP アップロードを完了させること

---

## BDD 受け入れシナリオ

```gherkin
Feature: Chrome Web Store 公開準備

Scenario: manifest.json が審査要件を満たしている
  Given yasumaro のソースコードが完成している
  When manifest.json を Chrome Web Store の自動チェッカーにかける
  Then エラーや警告が 0 件である
  And name が "Yasumaro - AI Browsing Logger" になっている（en ロケール）
  And version が "6.0.0" になっている（v6.0.0 リリース時）
  And 全パーミッションの正当化理由が PERMISSIONS.md に記載されている

Scenario: プライバシーポリシーページが公開されている
  Given GitHub Pages 等でプライバシーポリシーの URL が有効である
  When Chrome Web Store の申請フォームに URL を入力して検証する
  Then ページが正常にアクセスできる（HTTP 200）
  And "データをサーバーに送信しない" "ローカル SQLite に保存する" 旨が記載されている

Scenario: ストア掲載用スクリーンショットが準備されている
  Given yasumaro の全機能が動作している状態
  When ストア申請画面でスクリーンショットをアップロードする
  Then 1280x800 または 640x400 ピクセルの画像が最低 1 枚ある
  And ダッシュボード・ポップアップ・設定画面それぞれのスクリーンショットがある

Scenario: ZIP パッケージが正しく構成されている
  Given npm run build:store が完了している
  When dist/chromium-mv3/ を ZIP 圧縮する
  Then ZIP のルートに manifest.json が存在する
  And dist/ ソースマップ・テストファイルが含まれていない（不要ファイルの除外）
  And ZIP サイズが Chrome Web Store の上限（500MB）以下である
  And ZIP サイズが現実的な範囲（10〜20MB）である

Scenario: Developer Dashboard への登録準備が完了している
  Given プライバシーポリシー URL、ストア説明文、アイコン、スクリーンショットがすべて揃っている
  When v6.0.0 リリースタグが打たれる
  Then 同日中に Developer Dashboard に ZIP をアップロードできる
```

---

## 受け入れ基準（2026-06-18 時点の状態）

凡例: ✅ 完了済み（自動）｜🖐 手動作業が必要｜⬜ 未着手

### P1: ドキュメント整備

- ✅ CHANGELOG.md の `[Unreleased]` に v6.0.0 エントリを追加
- ⬜ `PERMISSIONS.md` を新規作成し、9 種類のパーミッションすべての正当化理由を記載
- ⬜ `PRIVACY.md` の「最終更新日」を v6.0.0 リリース日に更新
- ⬜ `docs/PRIVACY.md` も同期
- ⬜ ストア掲載用の説明文（英・日）を確定（後述の「ストア掲載テキスト」セクション参照）
- ⬜ `package.json` に `build:store` スクリプト追加（`wxt build` → ZIP 化）
- ⬜ `.gitignore` に `*.zip` が含まれているか確認（無ければ追加）
- ⬜ `scripts/build-store-zip.mjs`（または `.js`）を新規作成

### P2: ストア用素材

- ✅ ストアアイコン 128x128 PNG 確認（`public/icons/icon128.png` を流用）
- ✅ Playwright スクリーンショット撮影スクリプト作成（`dev-docs/store-assets/playwright/`）
- ✅ スクリーンショット英語版 5 枚（`dev-docs/store-assets/screenshots/en/`）
- ✅ スクリーンショット日本語版 5 枚（`dev-docs/store-assets/screenshots/ja/`）
- 🖐 **スクリーンショット内容確認・使用枚数の選定**（あなたが手動で確認）

### P3: `wxt.config.ts` 最終調整

- ✅ `homepage_url: "https://github.com/armaniacs/yasumaro"` 追加済み
- ⬜ パーミッション正当化コメントを `wxt.config.ts` 内にインラインで記載（任意）
- ⬜ `webRequest` / `unlimitedStorage` の要否最終確認（任意）

### P4: GitHub Pages 用 HTML ラッパー

- ✅ `docs/privacy.html` 新規作成（PRIVACY.md を fetch して表示する SPA、ダークテーマ）
- ✅ `docs/index.html` フッターのプライバシーリンクを `privacy.html` に変更
- 🖐 **`git commit` → `git push` → `main` へマージ**（あなたが手動で実施）
- 🖐 **`https://armaniacs.github.io/yasumaro/privacy.html` の HTTP 200 確認**（push 後にブラウザで確認）

### P5: 審査提出（v6.0.0 後）—すべて手動

- 🖐 v6.0.0 リリースタグ打設（GitHub Release / CHANGELOG 同期）
- 🖐 Chrome Web Store Developer Dashboard（$5 登録料）で「新規アイテム」を作成
- 🖐 ZIP ファイル（`yasumaro-6.0.0.zip`）を生成してアップロード
- 🖐 プライバシーポリシー URL（`https://armaniacs.github.io/yasumaro/privacy.html`）を入力
- 🖐 アイコン・スクリーンショットをアップロード
- 🖐 カテゴリ・言語・公開範囲を設定
- 🖐 「審査のために送信」をクリック
- 🖐 審査結果通知（3〜8 週待ち）を待つ

---

## テスト戦略（t_wada スタイル）

### E2E テスト（手動確認）

- ZIP を Chrome の「Load unpacked」でなく Chrome 実環境へインストールし、起動・主要機能が動作することを確認
- Chrome Web Store Developer Dashboard の「プレビュー」機能でストア掲載情報を確認
- GitHub Pages のプライバシーポリシー URL をシークレットウィンドウで開いて HTTP 200 を確認

### 統合テスト（自動化可能な範囲）

- `npm run build:store` がエラーなく完了し、`dist/yasumaro-6.0.0.zip`（または同等のファイル名）が生成される
- `node scripts/check-store-zip.mjs` で ZIP 内容を検証:
  - ルートに `manifest.json` がある
  - `manifest.json` の `version` が package.json と一致
  - `manifest.json` の `name` / `description` / `default_locale` が `_locales/` 配下のメッセージと整合
  - ZIP サイズが 500MB 以下
  - ソースマップ（`.map`）、`node_modules`、`test/`、`dev-docs/` が含まれていない

### 単体テスト

- パーミッション一覧が必要最小限であること（PERMISSIONS.md と比較）
- `_locales/{en,ja}/messages.json` に `extensionName` / `extensionShortName` / `extensionDescription` の 3 キーが存在
- 全アイコンファイルが実在し、ピクセル寸法が仕様通り

---

## 実装アプローチ

### 依存関係

- Phase 1〜7（PBI-01〜07）+ PBI-09〜15 + PBI-100〜108 がすべて完了済み（README.md 参照）
- 公開直前の v6.0.0 リリースタグが P5 の前提

### 推奨スケジュール

| 週 | 作業 | 備考 |
|----|------|------|
| v6.0.0 - 6 週 | P1（ドキュメント）+ P3（wxt.config.ts） | 並行実施可 |
| v6.0.0 - 5 週 | P2（ストア素材スクリーンショット） | Playwright での自動撮影スクリプト作成が効率的 |
| v6.0.0 - 4 週 | P4（GitHub Pages HTML ラッパー） | 公開後、URL の HTTP 200 を確認 |
| v6.0.0 - 3 週 | v6.0.0 タグ打設 + P5（Developer Dashboard アップロード） | ここから審査期間 |
| v6.0.0 リリース日 | 審査通過後、ストアで公開 | お知らせブログも同時公開 |

---

## 見積もり

**5 ストーリーポイント**（P1〜P5 合計）

P1〜P4 の即時着手可能部分のみ切り出すと 3 SP 程度。P5（アップロード作業・審査対応）は 1〜2 SP。

---

## 技術的考慮事項

### 審査期間

- 2026 年時点で Chrome Web Store は新規審査に 3〜8 週かかる場合あり
- 公開予定日の **4 週間前** には ZIP アップロードを完了させること
- 初回は `Why these permissions?` の追加質問が来る可能性が高い → PERMISSIONS.md を整然と用意しておく

### 登録料

- $5 one-time（初回のみ）
- 支払い後、Developer Dashboard にアクセス可能

### GitHub Pages ホスティング戦略

**Option A（現状維持）**: `docs/PRIVACY.md` をそのまま配信
- URL: `https://armaniacs.github.io/yasumaro/PRIVACY.md`
- メリット: 追加作業なし、すでに `pages.yml` で自動デプロイ
- デメリット: text/plain 配信のためレンダリングされない（Chrome Web Store は HTTP 200 なら許容）

**Option B（推奨）**: `docs/privacy.html` を新規作成（マークダウンを装飾 HTML に変換）
- URL: `https://armaniacs.github.io/yasumaro/privacy.html`
- メリット: ストア閲覧者にとって可読性が高い
- デメリット: マークダウン → HTML 変換スクリプト or 手動コピーが必要
- 実装案: `docs/PRIVACY.md` を `marked` 等の軽量ライブラリで HTML 化、`<script>` で markdown ファイルを fetch して動的レンダリング（`docs/index.html` の既存パターンに合わせる）

### `unlimitedStorage` の要否

- 現状 OPFS で SQLite を保持しているため、`chrome.storage.local` の quota（10MB）制限に縛られない
- しかし、API キー・設定値・SQLite メタ情報の一部は `chrome.storage.local` を使用する可能性あり
- **要再評価**: `grep -r "chrome.storage.local" src/` で使用状況を確認し、本当に必要か判断する
- もし不要な場合、審査での「Why do you need unlimited storage?」への回答が楽になる

### `webRequest` の要否

- `src/background/headerDetector.ts` で Set-Cookie / Cache-Control: private / Authorization ヘッダーの検出に使用
- MV3 では `webRequest` は「ブロック専用」ではなく「読み取り専用」なら許可される
- **確認**: ブロック（`blocking`）ではなく `onHeadersReceived` のオブザーバーパターンで実装されている → 問題なし
- ただし、Chrome 2024 以降は `chrome.declarativeNetRequest` への移行を推奨する場合あり → 将来課題として記録

---

## 実装者向け注記

### 現状確認コマンド（即時実行可）

```bash
# バージョン整合性
cat package.json | jq '.version'
grep "version" wxt.config.ts

# アイコン
file public/icons/*.png

# ロケール
ls public/_locales/{en,ja}/messages.json
grep -E '"extensionName"|"extensionShortName"|"extensionDescription"' public/_locales/en/messages.json

# プライバシーポリシー
head -10 public/PRIVACY.md
head -10 docs/PRIVACY.md

# ビルド検証
npm run build
ls -la dist/chromium-mv3/manifest.json

# パーミッション使用箇所の確認
grep -r "chrome.webRequest" src/ --include="*.ts" -l
grep -r "chrome.alarms" src/ --include="*.ts" -l
grep -r "chrome.notifications" src/ --include="*.ts" -l
```

### ストア掲載テキスト（下書き・2026-06-17 版）

#### 概要（132 文字以内・日本語）

```
ブラウジング履歴を AI で要約しローカル SQLite に永久保存。Obsidian 連携も可能なプライバシー重視の閲覧記録ツール。
```

#### 概要（132 文字以内・English）

```
Log your browsing history with AI summaries, stored permanently in local SQLite. Privacy-first with optional Obsidian sync.
```

#### 詳細説明（日本語）

```
Yasumaro - AI Browsing Logger は、あなたの日々の Web ブラウジングを AI が要約し、ローカルの SQLite データベースに永続保存する Chrome 拡張機能です。

【主な機能】
・ブラウジング履歴の AI 自動要約（Gemini、OpenAI、Groq、Anthropic、Ollama、LM Studio ほか OpenAI 互換 70+ プロバイダー対応）
・ローカル SQLite + OPFS による無制限の記録蓄積
・カレンダー + タイムラインのダッシュボードで過去を振り返り
・SQLite FTS5（trigram トークナイザ）による高速全文検索（日本語対応）
・Obsidian Local REST API 連携（オプション）
・データエクスポート: .db / Markdown / CSV / JSON
・PII（個人情報）マスキングによるプライバシー保護
・uBlock Origin 形式フィルタインポート
・ドメイン信頼度スコアリング（Tranco List 連携）
・全データ・マスターパスワード暗号化対応

【プライバシー】
すべてのデータはあなたのデバイス上にのみ保存されます。開発者のサーバーへの送信は一切ありません。
AI 要約のため、ユーザーが選択した AI プロバイダー（Gemini、OpenAI など）のみにページ内容が送信されます。
拡張機能をアンインストールすれば、すべてのデータが消去されます。
```

#### 詳細説明（English）

```
Yasumaro - AI Browsing Logger is a Chrome extension that uses AI to summarize your daily web browsing and stores everything permanently in a local SQLite database.

【Key Features】
・AI-powered automatic summarization (Gemini, OpenAI, Groq, Anthropic, Ollama, LM Studio, and 70+ OpenAI-compatible providers)
・Unlimited local storage with SQLite + OPFS (Origin Private File System)
・Calendar + Timeline dashboard to review your past activity
・High-speed full-text search with SQLite FTS5 (trigram tokenizer, Japanese-friendly)
・Optional Obsidian Local REST API integration
・Data export: .db / Markdown / CSV / JSON
・PII (Personally Identifiable Information) masking for privacy
・uBlock Origin filter list import
・Domain trust scoring (Tranco List integration)
・Master password encryption for all data

【Privacy】
All your data is stored exclusively on your device. No data is sent to the developer's servers.
Page content is sent only to the AI provider you choose (e.g., Gemini, OpenAI) for summarization.
Uninstalling the extension removes all your data.
```

### パーミッション正当化（PERMISSIONS.md への記載内容）

| パーミッション | 分類 | 理由 |
|--------------|------|------|
| `tabs` | required | アクティブタブの URL・タイトルを取得して AI 要約の対象とするため |
| `storage` | required | ユーザー設定と API キー（PBKDF2 + AES-GCM 暗号化）を `chrome.storage.local` に保存するため |
| `scripting` | required | コンテンツスクリプトを注入し、ページ本文を抽出するため（`contentScripts/content.ts`） |
| `notifications` | required | SQLite 障害・プライバシー警告・保存確認の通知を表示するため |
| `offscreen` | required | Manifest V3 の Service Worker 制約下では DOM API が利用できないため、wa-sqlite を実行する offscreen document を維持するため |
| `unlimitedStorage` | required | ユーザー設定・API キー（暗号化済）・SQLite メタ情報のため（OPFS と併用） |
| `webRequest` | required | `Cache-Control: private` / `Set-Cookie` / `Authorization` ヘッダーを読み取り、プライベートページの自動スキップ判定に使用するため（読み取り専用、`blocking` は使用しない） |
| `alarms` | required | セッションタイムアウト（`sessionAlarmsManager`）と日次ログパージ（`yasumaro-daily-purge`）のスケジュール実行に使用するため |
| `favicon` | optional | ユーザー設定で有効化した場合、アクセス中サイトの favicon を取得してログ表示をリッチ化するため |

### 落とし穴

- `manifest.json` はリポジトリ直下には存在しない（WXT が `wxt.config.ts` から自動生成する）。設定変更は必ず `wxt.config.ts` 経由で行うこと
- `_locales/ja/messages.json` には `extensionName` の日本語訳（`"やすまろ"` 等）を設定すると、よりローカライズされるが、現状は `__MSG_extensionName__` → 英語と同じ `"Yasumaro - AI Browsing Logger"` を出力している → Chrome Web Store のロケール表示に支障はない
- パーミッションが多い（`webRequest` を含む）拡張機能は審査で追加質問が来る可能性が高い。PERMISSIONS.md を整然と用意しておくこと
- ZIP のルートに `manifest.json` が来るようにすること。`dist/chromium-mv3/manifest.json` を ZIP のルートに配置する（`cd dist/chromium-mv3 && zip -r ../../yasumaro-6.0.0.zip .`）
- GitHub Pages は `.nojekyll` ファイルで Jekyll を無効化しているため、`_` 始まりのディレクトリ（`_locales`）もそのまま配信される
- `wxt build` 後の `dist/chromium-mv3/` には `*.map` ソースマップが含まれる。ZIP から除外すること（プロダクションビルドでは通常問題ないが、念のため）

---

## Definition of Done

凡例: ✅ 完了済み｜🖐 手動作業（あなたが実施）｜⬜ 未着手

- ✅ CHANGELOG.md に v6.0.0 エントリが記載
- ✅ `wxt.config.ts` に `homepage_url` 追加済み
- ✅ `docs/privacy.html` 作成済み
- ✅ スクリーンショット（英語版・日本語版 各 5 枚）が `dev-docs/store-assets/screenshots/` に揃っている
- 🖐 **`git commit` → `git push` → `main` マージ**（P1〜P4 変更を反映）
- 🖐 **`https://armaniacs.github.io/yasumaro/privacy.html` が HTTP 200 を返す**（push 後確認）
- 🖐 **スクリーンショット内容確認・選定完了**
- ⬜ `PERMISSIONS.md` が 9 パーミッションすべてを網羅
- ⬜ `PRIVACY.md` 最終更新日が v6.0.0 リリース日に更新済み
- ⬜ `npm run build:store` が正常終了し、`yasumaro-X.Y.Z.zip` が生成される
- ⬜ v6.0.0 リリースタグ打設後（P5）:
  - 🖐 Chrome Web Store Developer Dashboard でアイテムを「下書き保存」できた
  - 🖐 審査提出完了
  - 🖐 審査通過後、ストアで公開
