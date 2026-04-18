# ADR-00X: Vite Plugin crxjs から WXT への移行

## Status

**Accepted**

Priority: **High** (喫緊の課題)

## Context

当プロジェクトは現在、`@crxjs/vite-plugin` を使用して Chrome Extension をビルドしています。このプラグインは Vite の魔法を拡張機能に持ち込んだ功労者ですが、現在の「Vite 8 / Rolldown」という新しい波を前に、その足枷が顕著になっています。

## Decision

**WXT を導入し、ビルドツールを移行する。**

## Consequences

### Positive

1. **「依存関係の呪縛」からの解放**
   - crxjs は Rollup 2.79.2 にハード依存している
   - Vite 6 は Rollup 4 をベースにし、Vite 8 では Rust 製の新エンジン「Rolldown」へ進化
   - WXT は最新の Vite 8 環境で動作することを前提に設計
   - package.json の overrides で無理やり動かす「綱渡りの運用」から解放

2. **Vite 8 (Rolldown) の恩恵を最大化**
   - Rolldown による圧倒的なビルド速度
   - 開発・本番環境での挙動の不一致解消
   - crxjs のレガシーな構造によるバグの温床を排除
   - 快適なテスト環境（Vitest 4）を安定して構築可能

3. **「フレームワーク」がもたらす開発効率の飛躍**
   - **マニフェストの自動生成**: 手書きの manifest.json 管理から解放され、ファイル構成に基づいた型安全な開発
   - **堅牢な HMR (ホットリロード)**: crxjs で発生していた「Content Scripts の更新が反映されない」問題の解消
   - **マルチブラウザ対応**: Chrome だけでなく Firefox や Safari 向けビルドも標準サポート

### Negative

- 移行期間中の一時的な開発生産性の低下
- 既存ビルド設定の再調整が必要
- チームメンバーの学習コスト

## Impact Analysis

### 影響を受ける範囲

| 対象 | 影響 | 対応要否 |
|------|------|---------|
| `vite.config.ts` | 完全置き換え | 要 |
| `manifest.json` | WXT が自動生成 | 削除可 |
| `src/` ディレクトリ構造 | WXT規約に準拠へ移行 | 要（部分的） |
| npm scripts (`build`, `dev`) | WXT コマンドに変更 | 要 |
| GitHub Actions workflows | ビルドコマンド変更 | 要 |

### 移行後のディレクトリ構造（予定）

```
project-root/
├── src/
│   ├── entrypoints/          # WXT規約: entrypoints ディレクトリ
│   │   ├── background.ts     # service worker
│   │   ├── content.ts        # content script
│   │   └── popup/
│   │       ├── index.html
│   │       └── index.ts
│   └── utils/                # 既存のユーティリティ
├── wxt.config.ts             # WXT 設定ファイル
└── package.json              # scripts 更新
```

## Risk Analysis

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| 移行期間中の機能実装遅延 | 中 | 中 | 移行を独立したブランチで実施、完了まで新機能は最小限に |
| Content Script の動作変更 | 低 | 高 | 包括的な手動テスト、重要サイトでの動作確認 |
| プラグイン互換性の問題 | 低 | 中 | 事前に WXT のドキュメント・Issue を調査 |
| チームの学習コスト | 中 | 低 | ペアプロでの移行、ドキュメント整備 |

## Migration Path

1. **準備フェーズ**
   - WXT ドキュメントの熟読
   - テスト環境でのPOC実施

2. **移行フェーズ**
   - `wxt.config.ts` の作成
   - `src/` 構造の WXT 規約への移行
   - npm scripts の更新

3. **検証フェーズ**
   - 全機能の手動テスト
   - CI/CD パイプラインの更新・検証

4. **完了フェーズ**
   - `@crxjs/vite-plugin` の削除
   - 旧設定ファイルのクリーンアップ

## Related

- [WXT Documentation](https://wxt.dev/)
- ADR-00X: Vitest Migration (関連: テスト環境)
