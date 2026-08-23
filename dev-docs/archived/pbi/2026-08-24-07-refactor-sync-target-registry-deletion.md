---
name: 未使用 SyncTargetRegistry を削除（deletion test 合格）
type: refactor
priority: 7
rice:
  reach: 1
  impact: 0.5
  confidence: 1.0
  effort: 0.2
  score: 2.5
depends_on: []
---

## 現象
`src/background/syncTargetRegistry.ts` は shallow `Map` wrapper（register/getAll/syncAll）だが、プロダクション消費者が0件（grep で確認）。`isConfigured()` が3通りに乖離し、`syncBatch` が重複。deletion test に合格する（消しても複雑さは再出現しない）。

## なぜなぜ分析
1. なぜ未使用か → パイプラインの save-step に直接 targets を渡す設計に移行済み
2. なぜ deletion test が合格するのか → 本番コードが参照していない
3. なぜ今消すのか → 死んだ shallow module は drift の隠れ場所
→ 解: レジストリとそれのみを参照するテストを削除。targets は現状の直接注入を維持。

## 受け入れ基準
- `syncTargetRegistry.ts` と専用テストが削除されている
- 本番コードに dangling import が残らない
- `make clean test` が合格

## BDD シナリオ
```gherkin
Scenario: 削除後も sync は動作する
  Given  GistSyncTarget / ObsidianSyncService が直接注入されている
  When  記録保存を実行
  Then  各 target の sync が従来通り動く
```

## DoD
- [x] syncTargetRegistry.ts と専用テストを削除
- [x] dangling import なし
- [x] type-check / lint / test が PASS
