# ADR: aiTestProgressClient 抽出 — 保留条件の一部を却下

**Date:** 2026-08-23
**Status:** Rejected（該当トリガーのみ）
**Scope:** `pbi/2026-08-22-04-backlog-ai-test-progress-client.md` の保留条件

---

## 背景

`pbi/2026-08-22-04-backlog-ai-test-progress-client.md` は、AI 接続テスト進捗の
protocol 処理（listener 登録・shape ガード・runId 相関）を `connectionTests.ts`
から `aiTestProgressClient` として抽出する backlog PBI であり、以下 3 条件の
いずれかが発生した時点で着手するとしていた。

1. popup に AI 接続クイックテストを追加する PBI が立つ
2. diagnosticsPanel 側に TEST_AI 再実行ボタンが要望される
3. `connectionTests.ts` が 450 行を超えてさらに膨張する

## 決定

条件 1・2 を却下する。

- **popup に AI 接続クイックテストを追加することはない。**
- **diagnosticsPanel に TEST_AI 再実行ボタンを追加することはない。**

条件 3（`connectionTests.ts` の行数膨張）のみを有効なトリガーとして残す。

## 理由

プロダクトオーナーの意思決定として、popup / diagnosticsPanel を AI 接続テストの
第2消費者とする計画がないことが確定した。第2消費者が現れる見込みがない条件を
トリガーとして残すことは、実際には発火しない条件で保留PBIを漂わせ続けるだけで
判断コストになる。

## 影響

- 第2消費者は現時点で存在せず、今後も popup / diagnosticsPanel からは生まれない
  ため、`aiTestProgressClient` 抽出の real seam 成立条件（PBI 内「第2消費者に
  よる real seam 成立の確認」）は、この2条件では満たされない。
- `connectionTests.ts` の行数のみが残存トリガーである。450行を超えない限り、
  本 PBI は着手しない。
- 将来的に別の第2消費者（例: 新規UI面）が具体化した場合は、新規 PBI として
  改めて起票し、本 ADR の対象外として扱う。

## Related Decisions

- `pbi/2026-08-22-04-backlog-ai-test-progress-client.md`（本決定の対象 PBI。
  保留条件セクションを本 ADR に合わせて更新）
