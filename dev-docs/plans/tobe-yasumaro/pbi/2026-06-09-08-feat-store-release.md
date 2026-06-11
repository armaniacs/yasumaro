# PBI: Chrome Web Store公開準備（manifest更新・プライバシーポリシー・ストア掲載情報）

> **⛔ 着手ガード（2026-06-11 設定）**
>
> 本 PBI は **yasumaro v6.0.0 リリース直前にのみ** 着手する。
> それ以外のタイミング（v5.x 開発中、機能追加のついでの実施等）では着手しないこと。
> 着手するには、ユーザーからの **明示的な指示** を必要とする。
> 理由: Chrome Web Store への初回公開は「公式リリース発表」であり、v5.9.x のプレリリース番号で公開するとブランド毀損・アップデート運用の複雑化リスクがあるため。

## ユーザーストーリー
**yasumaroの開発者として**、Chrome Web Storeに拡張機能を登録・公開できる状態にしたい、なぜなら世界中のChromeユーザーが簡単にインストールできるようにして、プロジェクトを公式リリースとして発表したいから。

## ビジネス価値
- Chrome Web Storeへの公開でユーザー獲得の摩擦が大幅減少する
- 公式ストア掲載により信頼性とリーチが向上する

---

## BDD受け入れシナリオ

```gherkin
Feature: Chrome Web Store公開準備

Scenario: manifest.jsonが審査要件を満たしている
  Given yasumaroのソースコードが完成している
  When manifest.json を Chrome Web Storeの自動チェッカーにかける
  Then エラーや警告が0件である
  And name が "Yasumaro - AI Browsing Logger" になっている
  And 全パーミッションに正当化理由コメントが記載されている

Scenario: プライバシーポリシーページが公開されている
  Given GitHub Pages等でプライバシーポリシーのURLが有効である
  When Chrome Web Storeの申請フォームにURLを入力して検証する
  Then ページが正常にアクセスできる（HTTP 200）
  And "データをサーバーに送信しない" "ローカルSQLiteに保存する" 旨が記載されている

Scenario: ストア掲載用スクリーンショットが準備されている
  Given yasumaroの全機能が動作している状態
  When ストア申請画面でスクリーンショットをアップロードする
  Then 1280x800 または 640x400 ピクセルの画像が最低1枚ある
  And ダッシュボード・ポップアップ・設定画面それぞれのスクリーンショットがある

Scenario: ZIPパッケージが正しく構成されている
  Given npm build が完了している
  When dist/chromium-mv3/ をZIP圧縮する
  Then ZIPのルートに manifest.json が存在する
  And dist/ やソースマップが含まれていない（不要ファイルの除外）
  And ZIPサイズが Chrome Web Storeの上限（500MB）以下である
```

---

## 受け入れ基準
- [ ] `manifest.json` の更新:
  - `name`: "Yasumaro - AI Browsing Logger"
  - `version`: **現行の `5.9.1` のまま維持**（初回公開でも `1.0.0` にする必要はない。Chrome Web Store はバージョン番号に制限なし）
  - バージョン番号の形式確認: 各数値が `0`〜`65535` の範囲内、先頭ゼロなし（`5.9.1` は問題なし）
  - `"manifest_version": 3` であることを確認（MV2 は新規受け付け終了済み）
  - `description`: 英語・日本語両方（`default_locale` 設定）
  - パーミッション確認: `"unlimitedStorage"`, `"offscreen"`（既に manifest.json に含まれていることを確認）
  - パーミッション正当化コメント（manifest内またはREADME）
- [ ] プライバシーポリシーを GitHub Pages で公開する（`PRIVACY.md` を流用）
- [ ] ストア用アイコン 128x128 PNG を用意する
- [ ] ストア用スクリーンショット（最低1枚 1280x800）を用意する
- [ ] ストア掲載テキスト（概要・説明文）を日本語・英語で用意する
- [ ] `npm run build` でZIPパッケージを生成するスクリプトを追加する
- [ ] CHANGELOG.md に v5.9.1（Chrome Web Store 初回公開）エントリを追加する
- [ ] `package.json` と `manifest.json` のバージョンを同期する（どちらも `5.9.1`）

---

## テスト戦略（t_wadaスタイル）

### E2Eテスト（手動確認）
- ZIPを Chrome の「Load unpacked」でなく「Pack extension」でパッケージして動作確認
- Chrome Web Store Developer Dashboard の「プレビュー」機能でストア掲載情報を確認

### 統合テスト（自動化可能な範囲）
- `npm run build` がエラーなく完了し、`dist/chromium-mv3/manifest.json` が存在する
- manifest.json の JSON スキーマバリデーション

### 単体テスト
- パーミッション一覧が必要最小限であること（不要なパーミッションが含まれていない）
- ZIPサイズチェック（CI での自動確認）

---

## 実装アプローチ
- **依存関係**: Phase 1〜7 全て完了が前提
- 審査提出の2〜4週間前から準備を開始する（審査期間が数週間かかる可能性があるため）

---

## 見積もり
**5ストーリーポイント**

> **⛔ 再ガード**: 見積もり適用タイミング = v6.0.0 リリース直前。上記「着手ガード」を必ず確認すること。

---

## 技術的考慮事項
- **審査期間の注意**: 2026年時点でChrome Web Storeはサージ中のため審査に数週間かかる可能性がある。公開予定日の4週間前には申請すること
- 登録料: $5 one-time（初回のみ）
- 既存 `PRIVACY.md` を GitHub Pages でホスティングする方法: `docs/` フォルダに移動して GitHub Pages の `docs/` 公開設定にする

---

## 実装者向け注記

### 現状コードの確認
```bash
cat manifest.json | jq '.name, .version, .permissions'
cat package.json | jq '.version'
cat PRIVACY.md | head -20
ls dist/chromium-mv3/ 2>/dev/null || echo "build先を確認"
```

### ストア掲載テキスト（下書き）

**概要（132文字以内）:**
```
ブラウジング履歴をAIで要約・ローカルSQLiteに永久保存。Obsidianとの連携も可能なプライバシー重視の閲覧記録ツール。
```

**説明文（詳細）:**
```
Yasumaro - AI Browsing Loggerは、あなたの日々のWebブラウジングを
AIが要約し、ローカルのSQLiteデータベースに永続保存するChrome拡張機能です。

主な機能:
・ブラウジング履歴のAI自動要約（Gemini, OpenAI, Groq, Ollama対応）
・ローカルSQLite + OPFSによる無制限の記録蓄積
・カレンダー＋タイムラインのダッシュボードで過去を振り返り
・SQLite FTS5による高速全文検索
・Obsidian Local REST API連携（オプション）
・データエクスポート: .db / Markdown / CSV
・PIIマスキングによるプライバシー保護

※ データは全てローカルに保存されます。外部サーバーへの送信はありません
  （AI要約のためのAPIコールを除く）。
```

### パーミッション正当化（審査申告用）
| パーミッション | 理由 |
|---|---|
| `tabs` | タブのURLとタイトルを取得してAI要約の対象とするため |
| `storage` | ユーザー設定とAPIキー（暗号化）を保存するため |
| `unlimitedStorage` | SQLite OPFSへの無制限のブラウジングログ蓄積のため |
| `offscreen` | Manifest V3制約下でwa-sqlite Wasmをバックグラウンドで動作させるため |
| `scripting` | ページのコンテンツを抽出するためコンテンツスクリプトを注入するため |

### 落とし穴
- manifest.json の `name` フィールドは `_locales/*/messages.json` で国際化できる（`__MSG_appName__` 形式）。`_locales/` ディレクトリは未作成のため、`_locales/en/messages.json`（`default_locale: "en"` に対応）と `_locales/ja/messages.json` を新規作成し、`extensionName`・`extensionShortName`・`extensionDescription` のメッセージを定義すること
- パーミッションが多い拡張機能は審査で追加質問が来ることがある。正当化理由を明確に記載しておくこと

---

## Definition of Done
- [ ] Chrome Web Store Developer Dashboard でアイテムを「下書き保存」できた
- [ ] プライバシーポリシーURLが有効（HTTP 200）
- [ ] `npm run build` がエラーなく完了し、ZIPが生成される
- [ ] CHANGELOG.md に v5.9.1（Chrome Web Store 初回公開）エントリが追加されている
- [ ] コードレビュー完了
- [ ] 審査提出完了（または提出準備完了の確認）
