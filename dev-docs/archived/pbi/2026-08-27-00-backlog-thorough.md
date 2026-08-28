# Backlog: 2026-08-27 Thorough Scan 7件

## 概要
追加の徹底探索で発見された 7件の深掘り機会を RICE で優先度付け。`Messaging Transport` と `Content Visit Pipeline` が新規で高レバレッジ。

## RICE スコア表
| 順位 | PBI | RICE | Reach | Impact | Conf | Effort | 強度 | 根拠 |
|------|-----|------|-------|--------|------|--------|------|------|
| 1 | 22-messaging-transport | 420 | 90 | 2 | 70% | 0.30 | Strong | 全記録パスが通過、2系統の Message 型が並存 |
| 2 | 23-sync-batch-runner | 180 | 60 | 2 | 60% | 0.40 | Worth exploring | Gist の5000件ループが E2E でのみ顕在化 |
| 3 | 24-rate-limiter-session | 135 | 20 | 3 | 60% | 0.27 | Worth exploring | セキュリティ境界が flat 関数でテスト不能 |
| 4 | 25-text-similarity | 200 | 40 | 1.5 | 70% | 0.20 | Medium | 重複ロジックのコピペで二重保守 |
| 5 | 26-storage-fields | 180 | 30 | 1.5 | 70% | 0.20 | Medium | 40 field の any キャストで 0 潰しバグ |
| 6 | 27-multi-key-optimistic-lock | 160 | 40 | 1.5 | 60% | 0.30 | Medium | 二重key原子性の再発明で行順序に脆 |
| 7 | 28-queue-policy | 140 | 30 | 1.5 | 60% | 0.25 | Medium | 3 queue で TTL 二重管理 |

## 依存関係
- 22 と 24 は `StoragePort` を共有し並列可能
- 23 は `SettingsReader` 注入で 22 と並列可能
- 25 と 26 は `text` 層で独立
- 27 は `optimisticLock` 層で独立
- 28 は `PersistentRetryQueue` 層で独立

## 推奨着手順
- Wave1 (2並列): 22,23
- Wave2 (2並列): 24,25
- Wave3 (2並列): 26,27
- Wave4 (1): 28

## 出力ファイル
- `pbi/2026-08-27-22-feat-unify-messaging-transport.md`
- `pbi/2026-08-27-23-feat-extract-sync-batch-runner.md`
- `pbi/2026-08-27-24-feat-service-rate-limiter-session.md`
- `pbi/2026-08-27-25-feat-extract-text-similarity.md`
- `pbi/2026-08-27-26-feat-extract-storage-fields.md`
- `pbi/2026-08-27-27-feat-multi-key-optimistic-lock.md`
- `pbi/2026-08-27-28-feat-unify-queue-policy.md`
