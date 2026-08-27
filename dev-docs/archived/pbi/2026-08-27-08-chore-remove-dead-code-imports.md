# PBI: 未使用 import / 死んだ変数の削除

## ユーザーストーリー
開発者として、包括テストに追加された未使用 import と死んだ変数を削除したい、なぜなら `type-check` は通るが `knip` や将来の `no-unused-vars` でノイズになり可読性を下げるから。

## 優先度
- 順位: 8 / 8
- RICEスコア: 100（Reach=10 / Impact=0.5 / Confidence=100% / Effort=0.05）
- 根拠: 開発者体験のみ (Impact=0.5)。削除のみでリスクなし (Confidence=100%, Effort=0.05)。他 PBI の修正と同時に片付けると効率的。

## なぜなぜ分析
- なぜ残ったか: テスト作成時に `vi` や `StorageQuery` を import したが使わずに残った、`shouldThrow`/`origExec` は `engine.exec` 置換で不要になった
- なぜ気づかないか: `type-check` が未使用 import をエラーにしない設定のため
- 解: 単純削除で `validate` に影響なし

## BDD受け入れシナリオ
Scenario: ハッピーパス — 未使用 import が削除される
  Given `migrations-comprehensive.test.ts:7` の `vi` import がある
  When ファイルを保存する
  Then `grep "vi\."` が 0 件で `type-check` がパスする

Scenario: エッジケース — 死んだ変数が削除される
  Given `migrations-comprehensive.test.ts:95-115` の `shouldThrow.set`/`origExec`/`queryCallCount` がある
  When 該当 3 行を削除する
  Then テストは依然パスし `knip` や `eslint` の未使用警告が消える

## 受け入れ基準
- [x] `src/offscreen/__tests__/migrations-comprehensive.test.ts:7` の `vi` import が削除されている
- [x] `src/offscreen/__tests__/migrations-comprehensive.test.ts:95-101,115` の `shouldThrow.set`/`origExec`/`queryCallCount` が削除されている
- [x] `src/offscreen/__tests__/storageFallback-comprehensive.test.ts:8,10` の `vi` / `StorageQuery` import が削除されている
- [x] `src/offscreen/__tests__/sqliteQueryBuilder-comprehensive.test.ts:20` の `StorageQuery` import が削除されている
- [x] `npx tsc --noEmit` と `npx vitest run` がパスする

## テスト戦略
- 単体: 不要 (削除のみ)
- 統合: `npm run validate` (type-check + lint + test) がパスすることを確認
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
