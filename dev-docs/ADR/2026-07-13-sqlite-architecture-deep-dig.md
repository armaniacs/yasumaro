# Deep Dig Findings — SQLite Architecture Deepening

**Date:** 2026-07-13
**Scope:** 5 PBIs for SQLite layer architecture improvement

---

## 挑戦した仮定

| # | 仮定 | リスク | 発見 | 決定 |
|---|------|--------|------|------|
| A | StorageBackend インターフェース1つで全20操作をカバーできる | 高 | 非対応操作（backupDb on IDB VFS）は既存コードでもエラーを返している。アダプタ化後も同じ挙動。ただし UI が事前にケイパビリティを知る必要がある | 単一インターフェース + `getStatus().supportsBinaryBackup` 追加 |
| B | OPFS Worker の postMessage モデルと IDB VFS の直接SQL モデルが同一インターフェースに収まる | 高 | 収まる。アダプタ内部の実装非対称は GoF アダプタパターンの本質であり欠陥ではない。Worker を生SQL受付に統一するのは型安全性・セキュリティ境界の後退 | 非対称を許容 + Worker に `SQL_EXEC`/`SQL_QUERY` 裏口追加（マイグレーション専用） |
| C | init時にバックエンドを1回選択して固定すれば運用上問題ない | 高 | OPFS Worker の初期化失敗要因（WASM URL, OPFS未サポート, DB非互換）は環境要因でありセッション中に変化しない。切り替え機構を作ると別DBへの移行が必要でデータ不整合を引き起こす | 一度選択したら変えない。offscreen 再作成時に再選択。これは欠陥ではなくデータ一貫性の必然的制約 |
| D | PBI #1 → #2/#5 → #3/#4 の順序が最適 | 中 | #4 は完全独立（エラー伝播のみ、バックエンドに触らない）。#3 がファイル分割不要で極小化（1pt） | **#4 を最優先に繰り上げ**: #4 → #1 → #2 + #5（並列）→ #3 |
| E | 分岐除去後も既存のエラーハンドリング・遅延init・フォールバック挙動を完全維持できる | 高 | 遅延init のトリガーがリポジトリ関数から `getBackend()` に移動。NoopBackend（Null Object Pattern）で全バックエンド失敗時に throw せずエラーを返す。記述量は 30行 → 5行に削減 | `getBackend()` で遅延init + NoopBackend |
| F | 1087行のPanelを4モジュールに分割した後、DOMイベントと状態同期が壊れない | 中 | ファイル分割だけではテスト不能なまま（関数がグローバルDOM/stateに依存）。本質的な解決策は関数シグネチャの引数化であり、ファイル移動は付随的な整理に過ぎない。イベント配線はHTMLを生成するモジュールが所有すべき | ファイル分割は**行わない**。関数シグネチャの引数化のみ。PBI #3 の見積もり 3pt → 1pt |
| G | SqliteClient.call() のエラー分類ロジックが十分なカバレッジを持つ | 中 | Chrome Extension API のエラーは型付き例外ではなく文字列メッセージ。文字列マッチは fragile だが唯一の現実的手段 | テストで timeout / offscreen lost / quota / SQLite error の4パターンをカバー |

---

## 新たに発見したリスク

- **NoopBackend の無限ループ**: 全バックエンド失敗 + NoopBackend 選択時にリポジトリ関数が再び `getBackend()` を呼ばないよう、キャッシュ後の再試行ロジックを明示的に禁止する必要がある
- **Worker SQL_EXEC のセキュリティ**: マイグレーション専用だが、誤用すると SQL インジェクション経路になる。アダプタ内で `SQL_EXEC` を直接露出させない
- **Panel の refresh() 競合**: `loadData()` 中にユーザーが操作すると `refresh()` が二重呼び出しされ、state と DOM が不整合になる可能性。既存コードと同じく `state.loading` フラグでガードする

## 決定事項

1. StorageBackend: 単一インターフェース + `getStatus().supportsBinaryBackup` 追加
2. Worker: 操作タイプメッセージは維持。`SQL_EXEC`/`SQL_QUERY` をマイグレーション専用に追加
3. バックエンド選択: one-shot, one-time。切り替え機構は作らない（データ一貫性のため）
4. Null Object: NoopBackend で全バックエンド失敗時に throw しない
5. Panel: ファイル分割なし。関数シグネチャの引数化のみ
6. PBI順序: #4（エラー伝播）→ #1（アダプタ）→ #2 + #5（並列）→ #3（引数化）

## 未解決の疑問

- なし（全仮定に回答済み）
