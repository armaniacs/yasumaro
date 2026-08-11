# PBI: Handler registryをcomposition rootへ移設する

**作成日**: 2026-08-12
**優先度**: 🟡中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微
**種別**: 🔧非機能追加（refactor）

---

## 背景

2026-08-11 アーキテクチャ深深化Epic（PBI-01）の完了時に、「handler registry移設」は
スコープ外として残存した。現在の構成は以下の通り：

- `service-worker.ts:290-318` で `createMessageHandlerRegistry` が構築されている
- `createMessageHandlerRegistry.ts` は `src/background/handlers/` にある
- `createBackgroundServices.ts` は services のcomposition rootだが、handler registryは含まない

これにより、service-worker.ts がハンドラの構築という関心を直接持っており、
composition rootの責務が分散している。

## 実装内容

1. `createMessageHandlerRegistry` の呼び出しを `service-worker.ts` から `createBackgroundServices` または専用のcomposition moduleへ移動
2. 必要な依存（settings, clients, services）をregistry構築関数に注入
3. `service-worker.ts` は registry を受け取って `chrome.runtime.onMessage.addListener` に登録するのみにする

## 受け入れ基準

- [ ] `createMessageHandlerRegistry` の構築が `service-worker.ts` から排除されている
- [ ] 既存のメッセージハンドラの動作が変わらない
- [ ] 関連するテストが通る

## テスト戦略

- 既存のmessage handlerテストが通ることを確認
- `service-worker.ts` のテストで registry が正しく登録されることを確認

## 非スコープ

- ハンドラの実装ロジックの変更
- メッセージプロトコルの変更
- 新規ハンドラの追加
