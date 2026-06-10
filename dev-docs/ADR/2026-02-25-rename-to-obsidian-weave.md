# ADR-003: 拡張機能名を "Obsidian Weave" に変更

## Status

**Accepted** (2026-02-25)

## Context（背景・経緯）

### 名称衝突の発見

本プロジェクトは "Obsidian Smart History" という名称で開発を続けていたが、同名の Chrome 拡張機能がすでに Chrome Web Store に登録されていることが判明した。

オリジナル作者との混同を避けるため、独自の名称への変更が必要と判断した。

### 候補の検討

以下の候補を比較検討した：

| 候補 | 概要 | 評価 |
|------|------|------|
| `obsidian-weave` | 閲覧履歴・AI要約・リンクを「織り込む」 | ◎ 将来ビジョンへの拡張余地が大きい |
| `obsidian-beacon` | 訪れたページに灯台を立てるイメージ | ○ 「見守る」機能群とマッチ |
| `obsidian-chronicle` | 時系列の記録・年代記 | △ 同種Obsidianプラグインと被りやすい |
| `obsidian-atlas` | 知識の地図 | ○ 将来のマップ機能に合うが抽象的 |
| `obsidian-flow` | タブを閉じるだけで流れるように記録 | ○ UXの価値を表現できる |

## Decision（決定事項）

**`obsidian-weave`** を採用する。

- リポジトリ名: `obsidian-weave`
- 拡張機能表示名: `Obsidian Weave`
- manifest.json `name`: `Obsidian Weave`
- package.json `name`: `obsidian-weave`

## Rationale（根拠・理由）

### "weave"（織る）を選んだ理由

**現在の機能との対応**

- ブラウジング履歴・AI要約・Obsidianノートを「織り合わせる」動作を的確に表現する
- タブを閉じると自動的に記録が「紡がれていく」UXのイメージと一致する

**将来の拡張性**

- ノート統合、タグ生成、リンクマップ、クラスタリングなど、知識を「織る」行為に帰着する機能群に意味が広がりやすい
- 「weave」は動詞としても名詞としても使いやすく、UI文言・ドキュメント・マーケティングに応用しやすい

**ユニーク性**

- Chrome Web Store で競合が少なく、検索流入の面で有利
- "Smart History" と比べてプロダクト独自のアイデンティティを確立できる

## Consequences（影響）

### 変更が必要なファイル・箇所

#### 設定ファイル
- `manifest.json` — `name` フィールド
- `package.json` — `name` フィールド

#### i18n
- `_locales/en/messages.json` — `extensionName`, `extensionDescription` 内の名称参照
- `_locales/ja/messages.json` — 同上

#### ドキュメント
- `README.md`
- `SETUP_GUIDE.md`
- `PRIVACY.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md` — 過去エントリのヘッダー記述（任意）

#### コード内文字列
- `src/` 以下のコメント・ログ出力に残る "Obsidian Smart History" の参照

#### Gitリポジトリ・GitHub
- リポジトリ名の変更（GitHub Settings から実施）
- ブランチ保護ルール・GitHub Actions の URL 更新（必要に応じて）

### Positive（良い影響）

1. **Chrome Web Store 登録時の混乱を回避** — オリジナル作者との競合がなくなる
2. **独自ブランドの確立** — 将来の機能拡張を見据えたアイデンティティを持てる
3. **検索での差別化** — "Smart History" 系の類似拡張機能と区別されやすくなる

### Negative（考慮すべき点）

1. **既存ユーザーへの影響** — 拡張機能名が変わるため、インストール済みユーザーに通知が必要な場合がある
2. **ドキュメント・スクリーンショットの更新コスト** — ブログ記事・ドキュメント内の旧名称を一括置換する作業が発生する
3. **"Obsidian Smart History" で認知しているユーザーの混乱** — リリースノートで経緯を明記することで対処する

## References（参照）

### プロジェクト内ドキュメント

- [CHANGELOG.md](../../CHANGELOG.md) — v4.0.1 リリースノート
- [ADR-001](./2026-02-21-privacy-detection-logic-refinement.md) — プライバシー検出ロジック
- [ADR-002](./2026-02-22-port-migration-to-https.md) — HTTPS移行

### 実装ブランチ

- `weave-initial` — 本ADRに対応した名称変更作業ブランチ
