# blog-6_8 — v6.6.0 → v6.7.116 のユーザー体験差分シリーズ

v6.8.0 stable リリースに合わせて、v6.6.0 から v6.7.116 までにユーザー体験へ影響した変更を紹介する記事群。

## 記事一覧

| ファイル | 主題 | 対象読者 | 公開先 | 状態 |
|---|---|---|---|---|
| `zenn/00-overview.md` | v6.6→v6.7 の4つの前進（概要） | ライトユーザー〜開発者 | Zenn | draft |
| `zenn/01-built-in-ai.md` | ブラウザ内蔵AI対応の実装ノート | 実装に興味がある人 | Zenn | draft |
| `zenn/02-cleansing.md` | クレンジング強化（プリセット・ドメイン別上書き・観測性） | 実装に興味がある人 | Zenn | draft |
| `zenn/03-archive.md` | 閲覧履歴アーカイブの2フェーズ設計 | 実装に興味がある人 | Zenn | draft |
| `zenn/04-ai-connection-test.md` | AI接続テストを実推論方式に作り替えた話 | 実装に興味がある人 | Zenn | draft |
| `note/00-overview.md` | 半年ぶりに触る人へ・4つの便利 | 復帰ユーザー | note | draft |
| `note/01-built-in-ai.md` | APIキーなしでAI要約が動く | 一般 | note | draft |
| `note/02-cleansing.md` | 要約が「本文だけ」に近づいた | 一般 | note | draft |
| `note/03-archive.md` | 古い履歴を「箱にしまう」 | 一般 | note | draft |
| `note/04-ai-connection-test.md` | 「接続テスト」が本物になった | 一般 | note | draft |
| `why-6-7-100-feels-faster.md` | パフォーマンス（`docs/blog-6_8/` からのコピー） | 一般 | note / Zenn | 公開済み（docs 側が正典） |

`why-6-7-100-feels-faster.md` は `docs/blog-6_8/why-6-7-100-feels-faster.md` のコピー。編集する場合は `docs/` 側を正典として同期すること。

## 書き分けルール

同じ主題を Zenn と note の両方で書く。本文レベルで書き分ける。

### Zenn（`zenn/`）

- frontmatter 付き（下記テンプレ）
- 実装・設計に踏み込む: `LanguageModel.availability()` の状態名、`chrome://flags` の具体的なフラグ名、2フェーズ設計の不変条件、内部メトリクスの持ち方など
- 過去シリーズ（`dev-docs/blogs/blog-5_0/` など）の続編として接続してよい

### note（`note/`）

- frontmatter なし。`# タイトル` から本文
- コード・API 名を極力出さない。「設定でこう選ぶ」「こう便利になった」に寄せる
- 速度など不利な点も正直に書く

## frontmatter テンプレ（Zenn）

```yaml
---
title: "記事タイトル"
emoji: "🗂️"
type: "tech"
topics: ["obsidian", "chrome拡張機能", "ai", "生産性", "pkm"]
published: false
---
```

## 用語の一致

各ディープダイブ記事は対応するガイドとボタン名・用語を一致させること。

| 記事 | 対応ガイド |
|---|---|
| 内蔵AI | `docs/BUILT_IN_AI_SETUP_GUIDE.md` |
| クレンジング | `docs/CLEANSING_CUSTOMIZATION_GUIDE.md` / `docs/CLEANSING_ORDER.md` |
| アーカイブ | `docs/SETUP_GUIDE.md`「その他の機能」の「閲覧履歴アーカイブ」節 |
| AI接続テスト | `docs/AI_SUMMARY_GUIDE.md` / `docs/SETUP_GUIDE.md` |

数値・プロバイダー ID（`built-in-ai`）・プリセット名（`minimal` / `balanced` / `aggressive` / `custom`）は実装を確認してから書くこと。
