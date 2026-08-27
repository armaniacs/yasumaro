# PBI: payloadGuard 100MB+1 配列生成による CI OOM の解消

## ユーザーストーリー
開発者として、payloadGuard の restore 境界テストが CI で OOM Kill せずに実行できるようにしたい、なぜなら `Array.from({length: 104857601})` が 800MB-1.6GB を確保し `npm run validate` を不安定にするから。

## 優先度
- 順位: 1 / 8
- RICEスコア: 3000（Reach=100 / Impact=3 / Confidence=100% / Effort=0.1）
- 根拠: CI 全体をブロックする唯一の CRITICAL。Effort 極小で全開発者 (Reach=100) に即効。依存なしで最優先。

## なぜなぜ分析
- なぜ OOM するか: `MAX_RESTORE_BYTES=100*1024*1024` の +1 要素を実体化するため
- なぜ実体化したか: `data.length` だけを見る分岐を配列でテストする発想だった
- なぜ気づかなかったか: ローカルではメモリ余裕で通過、CI の worker メモリ制限で初めて顕在化
- 解: 長さプロパティだけを持つスタブか `customLimits` で境界を検証すれば十分

## BDD受け入れシナリオ
Scenario: restore サイズ超過を軽量スタブで検出する
  Given payloadGuard が `data.length > maxRestoreBytes` で判定する
  When 長さ `MAX_RESTORE_BYTES + 1` を持つスタブを渡す
  Then `Payload too large` を返し、実際の 100M 要素配列は生成されない

Scenario: 既存の customLimits パスが維持される
  Given テストが `customLimits: {maxRestoreBytes: 10}` を渡す
  When `data.length === 11` の小配列を渡す
  Then 同じエラーを返し、既存テストは緑のままである

## 受け入れ基準
- [x] `src/offscreen/__tests__/payloadGuard-comprehensive.test.ts:268` の `Array.from({length: MAX_RESTORE_BYTES+1})` が削除されている
- [x] 代わりに `length` スタブまたは `customLimits` 小値での境界テストに置換されている
- [x] `npx vitest run src/offscreen/__tests__/payloadGuard-comprehensive.test.ts` が 2GB 未満のヒープで 5 秒以内に完了する
- [x] 既存の 35 ケースが全てパスする

## テスト戦略
- 単体: payloadGuard の 4 メッセージ種別 (INSERT/BATCH/UPDATE/RESTORE) の境界値テストを `customLimits` で再検証
- 統合: offscreen 経由の restore メッセージがスタブでも拒否されることを `offscreen-security` と連携して確認
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] `pbi/00-INDEX.md` を更新
