# PBI: aiClient.test.ts等をAIService/RemoteAIService経由に移行する

**作成日**: 2026-08-12
**優先度**: 🟡中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微
**種別**: 🔧非機能追加（refactor）

---

## 背景

PBI-08 AI で `AIClient` は `RemoteAIService` の薄い委譲ラッパー化したが、
既存テスト（`aiClient.test.ts`, `aiClient-priority-fallback.test.ts`）は
依然として `AIClient` を直接テストしている。

`RemoteAIService` が独立したことで、AIService経由のテストが可能になった。
テストを AIService/RemoteAIService 経由に移行し、`AIClient` のテストは
委譲の contract テストのみに絞る。

## 実装内容

1. `RemoteAIService.test.ts` のカバレッジを拡充（既に9テスト存在）
2. `aiClient.test.ts` を委譲 contract テストに縮小（generateSummary/testConnection が RemoteAIService に委譲されることの検証）
3. `aiClient-priority-fallback.test.ts` を `RemoteAIService` または `FallbackAIService` のテストに移行
4. `aiServiceFactory.test.ts` の更新（既に completed）

## 受け入れ基準

- [ ] `RemoteAIService` のテストカバレッジが維持されている
- [ ] `AIClient` のテストが委譲 contract に絞られている
- [ ] 全テストが通る

## テスト戦略

- `RemoteAIService` のスロットループ、フォールバック、重複排除をテスト
- `AIClient` の委譲をテスト（mock 不要、実際の RemoteAIService を使用）

## 非スコープ

- `AIClient` クラスの削除（高リスクのため保留）
