---
title: "Obsidian Weave v5.2 リリースノート"
emoji: "🚀"
type: "idea"
topics: ["obsidian", "chrome拡張機能", "リリース", "ai"]
published: false
---

# Obsidian Weave v5.2 をリリースしました

Obsidian Weave v5.2 を公開しました。

v5.1.x シリーズで積み重ねてきた改善を集約したリリースです。ユーザー向けの目に見える新機能よりも、**品質・信頼性・セキュリティの基盤を全面的に強化**しました。

---

## ハイライト

### Service Worker の信頼性が大幅に向上

Chrome の Service Worker はいつでも終了される可能性がある設計です。これまでは SW が突然終了した際に、記録中のデータが失われるリスクがありました。

v5.2 では `SessionStore` を導入し、`chrome.storage.session` を活用することで SW が再起動しても状態を復元できるようになりました。また、フラッシュ機構も改善し、書き込み失敗時のリトライ・キュー復元も実装しています。

### テストカバレッジが 45% → 91% に

v5.1.23 の時点で、テストカバレッジが大幅に向上しました。全 5,406 テストがパスし、0 failures を達成しています。TypeScript の strict モードも有効化済みで、型の安全性も確保されています。

### ローカル AI の Prompt Injection 脆弱性を修正

Ollama などのローカル AI に対して、悪意あるコンテンツが「Ignore all previous instructions...」のような形でプロンプトを乗っ取る脆弱性を修正しました。送信前・受信後の二重サニタイズで多層防御を実現しています。

### CI/CD パイプラインを整備

GitHub Actions による自動テスト・カバレッジレポート・リリースビルドのパイプラインを整備しました。PR ごとに自動でテストが走り、タグを打つだけで Chrome/Firefox/Edge 向けビルドが GitHub Release に自動公開されます。

---

## 変更一覧

| カテゴリ | 内容 |
|---------|------|
| 信頼性 | SessionStore による SW 状態永続化、フラッシュリトライ機構 |
| セキュリティ | Prompt Injection 修正、CSP 最小化、過剰パーミッション削除 |
| テスト | カバレッジ 45% → 91%、スキップテスト 10 件を修正 |
| CI/CD | GitHub Actions 3 ワークフロー整備 |
| コード品質 | service-worker.ts リファクタリング、コード簡素化 |
| i18n | LM Studio / Ollama メッセージを i18n 対応 |

---

## インストール・アップデート

Chrome ウェブストアからインストール・アップデートできます（審査中の場合はしばらくお待ちください）。

開発者向けには [obsidian-weave](https://github.com/armaniacs/obsidian-weave) の Releases ページからも入手可能です。

---

## 関連記事

- [v5.1.2 → v5.1.26 で何を変えたか](./01-v512-to-v5126.md)
- [v5.1.27 → v5.1.30 で何を変えたか](./02-v5127-to-v5130.md)
- [テストカバレッジ 45% から 91% への道](./03-test-quality.md)
- [Obsidian Weave v5.2 ユーザーガイド](./04-user-guide.md)
