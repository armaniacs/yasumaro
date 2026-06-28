# 定期メンテナンス計画 / Routine Maintenance Plan

**作成**: 2026-06-29
**対象**: v6.3.7 以降の安定稼働維持

---

## 1. npm 脆弱性モニタリング

**状況**: 8件の脆弱性が残存。すべて `wxt → web-ext-run → ...` の推移的依存が原因。

| 脆弱性 | 深刻度 | 原因パッケージ | 状況 |
|--------|:------:|--------------|:----:|
| shell-quote | CRITICAL | fx-runner → web-ext-run | wxt のアップデート待ち |
| tmp | HIGH | web-ext-run | 同上 |
| uuid | MODERATE | node-notifier → web-ext-run | 同上 |
| esbuild | LOW | vite（Windows only） | 影響なし |

**対応**: 週1回 `npm audit` を実行し、`wxt` のアップデートがリリースされたら即時対応する。

```bash
# 確認コマンド
npm audit
npm view wxt version
```

**トリガー**: `wxt` が `web-ext-run` の依存を更新したバージョンをリリースしたとき。

---

## 2. CI パイプラインモニタリング

**変更履歴**:
- validate.yml 削除（tests.yml に統合）
- SHA ピン留め適用
- axe-core a11y ジョブ追加

**確認項目**:
- [ ] PR 作成時に重複 CI が発生していないか
- [ ] PR コメント機能（tests.yml → github-script）が動作しているか
- [ ] a11y ジョブが正しく並列実行されているか
- [ ] SHA ピン留め後に Dependabot が PR を作成しているか

**次回の CI ワークフロー更新時**:
- Dependabot が自動生成した PR のマージ
- アクションの SHA が自動更新されていることの確認

---

## 3. 依存関係の定期アップデート

**方針**: 月1回程度、`npm outdated` で主要パッケージの状況を確認する。

```bash
npm outdated | grep -v '# maybe'
```

特に注視するパッケージ:

| パッケージ | 理由 |
|-----------|------|
| `wxt` | 脆弱性修正を含む可能性が高い |
| `@axe-core/playwright` | 新ルール・改善が入る可能性 |
| `svelte` / `tailwindcss` | offscreen で使用中 |
| `playwright` | E2E テスト基盤 |

---

## 4. 次期バージョン開発への備え

現在 v6.3.7。（バージョニングポリシー: v6.偶数.x = bug fix only、v6.奇数.x = 新機能）

- **次期パッチ**: v6.4.x（bug fix のみ）
- **次期機能**: v6.5.x（新機能）

バージョン開発を始める際は、このメンテナンス計画を確認し、最新の脆弱性状況・CI 状態をベースラインとしてから着手すること。
