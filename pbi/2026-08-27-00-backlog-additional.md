# Backlog: 2026-08-27 Additional Deepening 3件

## 概要
追加探索で発見された 3件の深掘り機会を RICE で優先度付け。`SanitizePreview` と `Content Visit Pipeline` が新規で高レバレッジ。

## RICE スコア表
| 順位 | PBI | RICE | Reach | Impact | Conf | Effort | 強度 | 根拠 |
|------|-----|------|-------|--------|------|--------|------|------|
| 1 | 19-sanitize-preview-presenter | 213 | 40 | 2 | 80% | 0.30 | Strong | プライバシーゲートで focus/ESC リグレッション多発、MaskNavigator で jsdom 不要化 |
| 2 | 20-content-visit-pipeline | 336 | 80 | 3 | 70% | 0.50 | Strong | 全ページロードで実行、isTrusted バイパスと E2E flaky を同時解消 |
| 3 | 21-offline-queue-facade | 157 | 30 | 1.5 | 70% | 0.20 | Worth exploring | facade 二重実装と継承によるテスト用 null 化 |

*注: 20 は Reach 80 でスコア 336 と高く、実質的には 19 より優先度が高いが、依存関係で 19 を先にすることで Presenter の抽出パターンを ContentKernel に転用できるため 19→20 の順が有利。

## 依存関係
- 19 と 20 は独立して実装可能、20 は 19 の `MaskNavigator` パターンを `ScrollMonitor` に転用可能
- 21 は `PersistentRetryQueue` の汎用化が前提で、20 の `ContentKernel` とは独立

## 推奨着手順
- Wave1 (2並列): 19,20
- Wave2 (1): 21

## 出力ファイル
- `pbi/2026-08-27-19-feat-extract-sanitize-preview-presenter.md`
- `pbi/2026-08-27-20-feat-unify-content-visit-pipeline.md`
- `pbi/2026-08-27-21-feat-collapse-offline-queue-facade.md`
